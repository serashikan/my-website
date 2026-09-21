// =============================================================================
// 站点内容.js 的生成器
// -----------------------------------------------------------------------------
// 用法（在仓库根目录）：node 生成内容.js
//
// 为什么需要它：
//   子页面原来用 fetch() 读 txt文件/ 里的正文，但用 file:// 直接双击打开时
//   fetch 会被 CORS 拦掉（origin 是 null），正文就变成「加载失败: Failed to fetch」。
//   普通 <script> 不受这个限制，所以这里把正文打包成 站点内容.js，
//   由它提供一份「快照」当退路。
//
// 加载顺序仍是「fetch 优先」：
//   · 用本地服务器打开 → 读的是 txt文件/ 里的实时内容，改完立刻生效
//   · 双击（file://）→ fetch 失败，自动退回这份快照
// 所以改了 txt文件/ 里的东西，想让双击也能看到，就跑一下这个脚本重新生成。
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = 'txt文件';
const OUT = '站点内容.js';
const EXTS = new Set(['.txt', '.md']);

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (EXTS.has(path.extname(name).toLowerCase())) acc.push(full);
  }
  return acc;
}

if (!fs.existsSync(ROOT)) {
  console.error('找不到 ' + ROOT + '/，请在仓库根目录运行');
  process.exit(1);
}

const files = walk(ROOT, []).sort();
const entries = [];

for (const f of files) {
  // 统一用 / 作分隔符，和页面里 data-file 的写法保持一致
  const key = f.split(path.sep).join('/');
  const text = fs.readFileSync(f, 'utf8');
  // </script> 出现在字符串里会提前结束标签，转义掉
  const json = JSON.stringify(text).replace(/<\//g, '<\\/');
  entries.push('  ' + JSON.stringify(key) + ': ' + json);
}

const out = `// =============================================================================
// 站点内容.js —— 自动生成，请勿手改
// -----------------------------------------------------------------------------
// 改完 txt文件/ 里的内容后，在仓库根目录运行：node 生成内容.js
//
// 用途：用 file:// 双击打开网页时 fetch() 会被 CORS 拦掉，
//       这份快照就是给那种情况兜底的。用本地服务器打开时仍会优先读真实文件。
// 共 ${entries.length} 个文件。
// =============================================================================

window.SiteContent = window.SiteContent || {};
window.SiteContent.snapshot = {
${entries.join(',\n')}
};

// 读正文：先试 fetch（能拿到最新内容），失败再退回快照（file:// 兜底）
window.SiteContent.load = async function (p) {
  try {
    const res = await fetch(p);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } catch (err) {
    const snap = window.SiteContent.snapshot;
    if (snap && Object.prototype.hasOwnProperty.call(snap, p)) return snap[p];
    throw err;
  }
};
`;

fs.writeFileSync(OUT, out, 'utf8');
const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(0);
console.log('已生成 ' + OUT + '：' + entries.length + ' 个文件，' + kb + ' KB');
entries.forEach(e => console.log('  · ' + JSON.parse(e.trim().slice(0, e.trim().indexOf(': ')))));
