# 钓鱼指南 · 微信小程序

一个给钓鱼人用的工具：按实时天气算「适钓指数」，带鱼种图鉴、钓法、饵料、钓点地图和渔获日志。

- AppID：`wx8c1919d5d5760dde`
- 页面 17 个，tabBar 5 个：出钓指数 / 鱼种图鉴 / 钓法 / 饵料 / 我的
- 云函数：`weather`、`sync`、`wxacode`、`recFish`
- 云环境：`fishing-prod`

## 零、这版更新了什么（v1.1.1）

**鱼种图鉴**

- 新增**解锁系统**：是否解锁由渔获日志决定（钓到过即解锁），未解锁的配图置灰显示
- 列表右侧显示「已解锁 / 未解锁」标识，鱼名后跟「已钓 N 次」角标
- 顶部新增解锁进度条（`X/33`），进度条与搜索框滚动时**吸顶**
- 列表排序：已解锁鱼种优先，组内保持原有顺序
- 从日志页返回自动刷新解锁状态（`onShow` 重算）

**鱼种配图**

- 33 张 AI 写实鱼图替换原矢量简笔画，按每种鱼真实的体色、体型、鳍型、斑纹、须生成
- 新增处理流水线 `tools/process-aifish.py`：抹水印 → 品红底抠图 → 去镶边 → 连通域清理残影 → 等比居中 → 调色板量化压缩（33 张合计约 200KB）
- 矢量生成器 `make-fishimg.py` 升级 v3：非对称包络（背峰/腹峰分离）+ 真鱼特征（头部隆起 / 棘状背鳍 / 上翘下颌 / 长须），随时可重生成回来

**钓法教学**

- 教学视频扩充至 **30 条**，分 **9 类**：台钓线组 / 路亚线组 / 调漂找底 / 抛竿手法 / 看漂读口 / 开饵打窝 / 选位看水 / 路亚操控 / 新手入门
- 列表不再内嵌播放器，改为卡片右侧播放键跳转独立播放页 `pages/rigvideo`
- 折叠列表默认**全部收起**

**饵料**

- 新增「**路亚假饵速查**」板块：13 种假饵（亮片 / 米诺 / VIB / 波扒 / 小胖子 / 铅头钩+T尾 / 德州钓组 / 雷蛙 / 胡须佬 / 干式毛钩 / 若虫 / Streamer）
- 每种含类型、水层、对象鱼、操控手法与使用场景
- 卡片右上角显示对应假饵配图（`images/lure/`）

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
| 视频域名 | 公众平台 → 开发管理 → 服务器域名 → `downloadFile` | 教学视频换成真实地址后，其域名必须加进白名单，否则 `<video>` 播不了 |

## 四、图片资源

| 目录 | 内容 | 体积 |
|---|---|---|
| `images/fish/` | 33 种鱼的写实配图，透明底 240×160 | 约 200KB |
| `images/lure/` | 13 种路亚假饵配图，透明底 200×200 | 约 250KB |
| `tools/ai-fish/`、`tools/ai-lure/` | AI 生成原始素材（已 `.gitignore`，约 42MB） | 不入库 |

两张图都是「品红底生成 → 自动抠图 → 去镶边 → 连通域清理残影 → 等比居中 → 调色板量化」出来的。
想换风格或重生成，改 `tools/` 下的脚本重跑即可；原始素材目录不入库，删了也不影响构建。

## 五、tools 脚本

| 脚本 | 用途 |
|---|---|
| `process-aifish.py` | 把 AI 生成的鱼图处理成透明底成品 |
| `process-ailure.py` | 同上，处理假饵图 |
| `make-fishimg.py` | v3 矢量鱼图生成器（不依赖 AI，纯代码画） |
| `fish-all.py` | 生成鱼图速览大图，第二参数传列数（如 `python tools/fish-all.py pkg 6`） |
| `lure-all.py` | 生成假饵速览大图 |
| `fish-preview.py` | 矢量体型参数试点 |
| `fish-compare.py` | 新旧鱼图对比图 |

## 六、几个实现上的坑

- `page` 的 `background` 取不到 `.wrap.light` 上的 CSS 变量，背景色要挂在 `.wrap` 上
- JS 里算出来的颜色不会跟随 CSS 变量切主题，主题变了要在 `onShow` 重算
- NOAA 日出日落公式里 zenith 是 90.833°，`cos(zenith) ≡ sin(alt)`；日落时角要取反：`720 − 4×(lng − ha)`
- WXML 内联 `style` 里用 8 位 hex 透明度不生效，用 `rgba()` 或 CSS 变量
- 小程序不能请求 IP 地址，图片域名要配 `downloadFile` 合法域名（云开发存储的 `cloud://` 不用配）
- 定位：`wx.getLocation` 与 `wx.getFuzzyLocation` 互斥，本项目只用后者；精确定位靠地图组件的 `moveToLocation` + 读中心实现
