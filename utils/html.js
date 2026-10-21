// 极简 HTML → rich-text nodes 转换器
// Web 版的钓法正文是 HTML 字符串，小程序 rich-text 只接受 nodes 数组，这里做一次性转换。
// 只处理本站用到的标签子集：p / div / ul / ol / li / b / strong / span / br / h3 / h4，其余标签降级为纯文本。

const BLOCK = { p: 1, div: 1, ul: 1, ol: 1, li: 1, h3: 1, h4: 1, section: 1 };
const VOID = { br: 1 };

function decode(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// 去掉标签属性，只留标签名；顺便把 style/class 丢掉
function tagName(raw) {
  const m = /^([a-zA-Z0-9]+)/.exec(raw.trim());
  return m ? m[1].toLowerCase() : "";
}

function parse(html) {
  const nodes = [];
  const stack = [{ children: nodes }];
  const re = /<\/?([a-zA-Z0-9]+)(?:\s[^>]*)?>/g;
  let last = 0, m;

  const pushText = (t) => {
    const txt = decode(t).replace(/\s+/g, " ").trim();
    if (!txt) return;
    const top = stack[stack.length - 1];
    // 文本节点直接挂到当前容器，b/strong 之类已在栈上时会自动继承
    top.children.push({ type: "node", name: "span", children: [{ type: "text", text: txt }] });
  };

  while ((m = re.exec(html))) {
    const seg = html.slice(last, m.index);
    if (seg) pushText(seg);
    last = m.index + m[0].length;

    const isClose = m[0][1] === "/";
    const name = m[1].toLowerCase();
    if (VOID[name]) {
      stack[stack.length - 1].children.push({ type: "node", name: "br", children: [] });
      continue;
    }
    if (isClose) {
      // 栈里找同名容器闭合；找不到就忽略（HTML 可能不严格配对）
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }
    if (BLOCK[name] || name === "b" || name === "strong" || name === "span") {
      const node = { type: "node", name: name === "b" || name === "strong" ? "strong" : name, children: [] };
      stack[stack.length - 1].children.push(node);
      if (BLOCK[name]) stack.push({ name: name, children: node.children });
      else stack.push({ name: name, children: node.children });
    }
    // 其余标签（如 table/tr/td、svg）忽略外层，内容按文本走
  }
  const tail = html.slice(last);
  if (tail) pushText(tail);
  return nodes;
}

// rich-text 对嵌套层数敏感，这里做一层扁平化：把只剩文本的块转成段落
function toNodes(html) {
  if (!html) return [];
  return parse(String(html).replace(/<!--[\s\S]*?-->/g, ""));
}

module.exports = { toNodes: toNodes };
