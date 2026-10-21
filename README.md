# 钓鱼指南 · 微信小程序

一个给钓鱼人用的工具：按实时天气算「适钓指数」，带鱼种图鉴、钓法、饵料、钓点地图和渔获日志。

- AppID：`wx8c1919d5d5760dde`
- 页面 16 个，tabBar 5 个：出钓指数 / 鱼种图鉴 / 钓法 / 饵料 / 我的
- 云函数：`weather`、`sync`、`wxacode`、`recFish`

## 一、导入到微信开发者工具

1. 开发者工具 → 导入项目
2. 目录选**这一层**（即 `app.json` 所在的目录），不是外层
3. AppID 填自己的，或用测试号

## 二、两台机器怎么同步

这个项目就是靠 Git 在「公司 / 家里」两头同步的。

```bash
# 开工前先拉
git pull --rebase

# 收工前先提交再推
git add -A
git commit -m "说明改了什么"
git push
```

建议用 `--rebase` 拉，避免每次都多一个 merge 提交。

### 两台机器会打架的文件

`project.private.config.json` 也进了版本库（方便同步部分设置），但它记的是**本机路径**，两台机器上很可能不一样。如果每次 pull 都报它冲突：

```bash
git checkout --theirs project.private.config.json   # 用对方的版本
# 或
git checkout --ours project.private.config.json     # 用自己的版本
```

实在烦就把它移出版本库：`git rm --cached project.private.config.json`，再写进 `.gitignore`。

## 三、上线前必须自己配的东西

| 项 | 在哪配 | 说明 |
|---|---|---|
| 云环境 ID | `utils/config.js` 的 `CLOUD_ENV` | 留空则 `app.js` 不会初始化云开发 |
| 智谱 Key | 云开发控制台 → 云函数 `recFish` → 环境变量 `ZHIPU_KEY` | **不要写进代码**（已从代码里移除，靠环境变量注入） |
| 云函数部署 | 开发者工具右键各云函数目录 → 上传并部署 | `sync`/`wxacode` 要先「云端安装依赖」；`weather` 超时改 20 秒 |
| 位置接口 | 公众平台 → 开发管理 → 接口设置 | 已开通 `getFuzzyLocation` 和 `chooseLocation` |

## 四、几个实现上的坑

- `page` 的 `background` 取不到 `.wrap.light` 上的 CSS 变量，背景色要挂在 `.wrap` 上
- JS 里算出来的颜色不会跟随 CSS 变量切主题，主题变了要在 `onShow` 重算
- NOAA 日出日落公式里 zenith 是 90.833°，`cos(zenith) ≡ sin(alt)`；日落时角要取反：`720 − 4×(lng − ha)`
- WXML 内联 `style` 里用 8 位 hex 透明度不生效，用 `rgba()` 或 CSS 变量
- 小程序不能请求 IP 地址，图片域名要配 `downloadFile` 合法域名（云开发存储的 `cloud://` 不用配）
- 定位：`wx.getLocation` 与 `wx.getFuzzyLocation` 互斥，本项目只用后者；精确定位靠地图组件的 `moveToLocation` + 读中心实现
