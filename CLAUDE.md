# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指导。

## 文件改动范围

- 对于 `ai_workspace/` 之外的文件，默认只能**读取或复制**。
- 需要修改时，先把文件复制到 `ai_workspace/` 里改副本；生成的任何新文件也先放进 `ai_workspace/`。
- **在取得用户明确许可后**，AI 可以把 `ai_workspace/` 里确认无误的改动搬进正式位置
  （复制到仓库根目录或对应目录），并顺手清理 `ai_workspace/` 里剩下的临时副本与软链接。
- 未经许可，不要直接改动正式文件。改动说明请写在 `ai_workspace/改动说明.md` 里。

## 概述

塞拉爱米露的个人网站 — 纯静态个人网站，无构建步骤、无框架、无依赖。直接在浏览器中打开任意 `.html` 文件即可预览。

样式分两层：全站共享的 `风格.css`（设计变量、基础排版、导航栏、侧边栏、正文样式），
加上每个页面 `<head>` 里少量页面专属的 `<style>`。JS 以 `<script src="...">` 引入或内联。

## 运行 / 开发方式

```bash
# 无需构建步骤 — 直接在浏览器中打开
open index.html
# 如果 fetch() 遇到跨域问题，可以用 Python 内置服务器：
python3 -m http.server 8080
```

注意：`文学/技术/数学.html` 的正文（`txt文件/` 里的 `.txt` / `.md`）由
`站点内容.js` 提供一份**打包快照**，子页面统一用 `SiteContent.load()` 读取：

- 用本地服务器打开 → **先 `fetch`**，读的是实时文件，改完立刻生效
- 双击（`file://`）→ `fetch` 被 CORS 拦掉，**自动退回快照**，照样能看

> **改了 `txt文件/` 里的内容后，想让双击打开也能看到，记得跑一下
> `node 生成内容.js` 重新生成快照。** 用服务器打开则不需要。

（`fetch()` 和 ES module 在 `file://` 下都会被 CORS 拦掉；普通 `<script>` 不受影响，
所以 `鼠标.js`、`花火.js`、两个游戏脚本和 `站点内容.js` 直接双击打开也能跑。）

没有 package.json、打包工具、代码检查工具或测试套件。全部为原生 HTML/CSS/JS。

## 页面结构

| 文件 | 功能 |
|------|------|
| `风格.css` | 全站共享样式表 — 设计变量、基础排版、导航栏、侧边栏、正文、卡片 |
| `站点内容.js` | **自动生成**的正文快照 + `SiteContent.load()` 读取器（`node 生成内容.js` 重新生成） |
| `生成内容.js` | 上面那个快照的生成器（Node 脚本，改完 `txt文件/` 才需要跑） |
| `index.html` | 着陆页，包含欢迎信息、自定义光标、密码保护烟花按钮 |
| `主页.html` | 主枢纽页 — 包含指向 6 个子版块的导航卡片 |
| `文学.html` | 文学版块 — 加载 `.txt`/`.md`/`.pdf`；含《蓝色的宝石和黑色的恶魔》和「梅血饅頭」短篇集 |
| `技术.html` | 技术版块 — 加载 `.txt`/`.md`，并通过注入 `<script>` 动态加载 `.js` 小游戏（打砖块、花瓣占卜） |
| `数学.html` | 数学版块 — 加载 `.txt`，并通过 `<embed>` 嵌入 `.pdf` |
| `音乐.html` | 音乐版块（大部分为占位状态） |
| `塞拉.html` | 塞拉角色页面（占位状态） |
| `米露.html` | 米露角色页面（占位状态） |

## 子页面的共享模式（`文学/技术/数学/音乐/塞拉/米露.html`）

所有子页面结构相同，样式全部来自 `风格.css`：

- **顶部导航栏**（`.top-bar`）：`burlywood` 渐变背景，`position: sticky`。
  logo 包在 `.logo-slot` 里（`overflow: hidden` 裁掉原图四周的透明留白）链接回 `主页.html`
- **侧边栏**（`.sidebar`，宽度 `--sidebar-w` = 236px，`sticky` 固定在导航栏下方）：
  树形菜单，`<ul class="menu">` 内包含可折叠的 `<ul class="sub1">` 子菜单
- **主内容区**（`.main`）：两个内容 div — `#prologue`（默认介绍文字）和 `#txtBox`（点击菜单后加载的动态内容）
- 内容切换：所有 `.content` div 默认隐藏；添加 `.active` 类即可显示
- 自定义光标：`html, body` 设置 `cursor: none` + 由 `鼠标.js` 定位的 `.mouse` div

侧边栏 JS 逻辑在每个页面中以内联形式重复 — 相同模式：查询所有 `<a>` 标签，
根据 `data-target` 或 `data-file` 属性切换 `#prologue`/`#txtBox` 的显示，
并给点击过的条目加 `.current` 类做高亮。

`技术.html` 的点击回调必须是 `async function`（内部用了 `await loadScript()`），
写成普通函数会是语法错误，导致整个 `<script>` 块失效、菜单全部点不动。

它还有一步**容易被漏掉**：切换菜单时必须先 `txtBox._module.stop()`、再
`txtBox.innerHTML = ""`，否则切走之后游戏还在后台空转。

### 小游戏是怎么加载的

游戏用**注入 `<script>`** 的方式加载，不是 `import()`。
因为 `file://` 直接打开网页时 ES module 会被 CORS 拦掉（origin 是 `null`），
而普通 `<script>` 不受限制。全站其他脚本也都是普通脚本，保持一致。

约定：

1. 游戏脚本是**普通脚本**，末尾用 `document.currentScript.src` 当键注册：
   ```js
   window.SiteGames = window.SiteGames || {};
   window.SiteGames[scriptEl.src] = { init, start, stop };
   ```
2. `技术.html` 的 `loadScript(src)` 注入 `<script>`，加载完成后按 **`el.src`**（解析后的
   绝对 URL）去 `window.SiteGames` 里取。两边都用同一个真实 URL 当键，
   **脚本改名或挪到子目录都不会失效**。
3. 加新游戏：写一个同样注册的普通脚本，然后在「小游戏」子菜单里加一条
   `<a data-file="你的脚本.js">名字</a>` 即可，不用改加载器。

## JavaScript 模块

### `鼠标.js` — 自定义光标 + 点击火花
- 跟踪鼠标位置，移动 `.mouse` div（Miku gif）作为光标
- 按 `Z` 键切换两种光标图片（静态指针 / 动画 Miku）
- 点击任意位置产生 20 个微小粒子，带重力散开并淡出，每个粒子带有拖尾轨迹

### `花火.js` — 密码保护烟花
- 监听 `#Fire` 按钮点击 → 弹出密码输入框
- 密码正确后：隐藏所有页面元素（`.hidden-all`），设置夜空背景，启动基于 Canvas 的烟花动画（火箭升空 + 粒子爆炸），播放背景音乐
- 按 `B` 键退出烟花模式并恢复页面
- 烟花系统使用 `Rocket` 和 `Particle` 类，通过 `requestAnimationFrame` 循环驱动
- **退出时不再写回硬编码的行内样式**：进入烟花模式会给 `<body>` 加若干行内样式，
  退出时按 `fireInlineProps` 列表逐条 `removeProperty`，把版式交还给 `风格.css`。
  **改首页版式不需要动这个文件。**

### `game-breakout.js` — 打砖块（普通脚本，**不是** ES 模块）
- 注册到 `window.SiteGames`，提供 `init(container)`、`start()`、`stop()`
- `init()` 向给定容器注入 `<canvas>`；`start()` 启动游戏循环；`stop()` 清理事件监听和动画帧
- 按住 `S` 键减速（将 `speedScale` 提升至最高 10 倍，实现慢动作效果）
- 视觉配色写在文件顶部的 `THEME`（纸面/焦糖/粉）和 `ROW_COLORS`（砖块按行取色，
  上排焦糖 → 下排玫瑰）里，想改游戏画面只动这两处

### `game-hanauta.js` — 花瓣占卜（普通脚本）
- 同样注册到 `window.SiteGames`，接口一致
- 玩法：每次随机开一朵花瓣数随机的花（5–13 片），点主按钮掰掉一片，
  按钮在「好き / 嫌い」之间切换（粉 ↔ 蓝）；**最后一片掰掉时的那个词就是结果**
- **绝对不要显示剩余花瓣数** —— 知道片数就能直接推算出结果，占卜就废了。
  所以游玩过程中状态栏是空的（只留高度防止布局跳动），只在开始前给一句操作提示
- 视角：花盘是**倾斜面向用户**的透视。做法是整个花盘在 y 方向压扁，
  背面的花瓣再额外缩短拉开纵深；花瓣从花盘边缘长出来、花心最后画，
  这样花心是完整的一块，不会被花瓣切碎
- 花瓣会转到正上方再被掰下、飘落，`requestAnimationFrame` 驱动。
  飘落花瓣的初始角度要按 `atan2(ay, ax)` 反算压扁后的角度，否则会斜着飞出去
- 画布按设备像素比放大绘制保证清晰，但**必须同时 `canvas.style.width` 钉死显示尺寸**，
  否则 Retina 屏上整朵花会变成两倍大（这个坑踩过一次）

**花的样子是可切换的**，全都定义在文件顶部的 `STYLES` 数组里，目前三种：
波斯菊（默认）/ 玫瑰 / 彼岸花。每种花提供：

| 字段 | 作用 |
|------|------|
| `tilt` / `backLen` | 倾斜程度、背面花瓣缩短比例（每种花可以不一样） |
| `coreR` / `petalBase` | 花心半径、花瓣从花盘半径的多少倍处长出来 |
| `len` / `wid` | 花瓣长度与宽度的随机范围 |
| `path(len, wid)` | 花瓣轮廓，画在局部坐标里（沿 +x 方向） |
| `paint(len, wid)` | 填色 / 描边 / 脉络 |
| `center(r)` | 花心，坐标系已平移到花盘中心且做过压扁 |
| `extra()` | 附加零件（如彼岸花的雄蕊），画在花心之后 |
| `stem(headX, headY)` | 茎和叶子（彼岸花「花不见叶」，所以只有一根花茎） |
| `petal3d` / `stem3d` / `color3d` | 同一种花的 **3D 版参数**（见下） |

想再加一种花，照着一个对象写进 `STYLES` 就行，切换按钮会自动多出来一个。
按钮样式在 `风格.css` 的 `.hanauta-styles` / `.hanauta-style`。

**2D / 3D 可切换**：

- `mode` 只影响「怎么画」，玩法状态（`petals` / `plucked` / `callIndex` / `phase` / `result`）
  完全共用，所以切模式不会重开一局，已经掰掉的花瓣会补上
- 切到 3D 时**懒加载** `lib/three.min.js` + `game-hanauta-3d.js`，加载失败会老实退回 2D
- 颜色（色相 + 饱和度倍率）两种模式共用：
  2D 每帧重画即可，3D 走 `h3.refreshColors()` 原地重算顶点色
- 颜色只覆盖色相和饱和度、**保留每种花自己的明暗关系**；
  `satMul` 是**倍率不是绝对值**（盖成绝对数会把花瓣渐变的浓淡对比抹平，整朵花发灰）
- 🌈 疯狂变色：每帧推色相，两种模式都生效；
  开了 `prefers-reduced-motion` 就大幅放慢而不是砍掉功能

### `game-hanauta-3d.js` — 花瓣占卜的 3D 渲染器（普通脚本）
- 挂在 `window.Hanauta3D`，由 `game-hanauta.js` 切到 3D 时才注入
- **只负责画**：`setFlower(cfg, count)` / `pluck(i)` / `refreshColors()` / `tick()` /
  `resize()` / `dispose()`；玩法仍在 `game-hanauta.js`
- 依赖 `window.THREE`（`lib/three.min.js`，r160 UMD，本地内置所以离线可用）
- 花瓣几何 `makePetalGeometry` 的参数含义：

  | 参数 | 作用 |
  |------|------|
  | `len` / `wid` | 长度、最大宽度 |
  | `envA` / `envB` | 宽度包络（柳叶形 vs 长条形） |
  | `cup` | 横截面张开弧度，0 = 平，1 = 半个槽 |
  | `roll` | 沿长轴逐渐翻转（条状花瓣靠它扭起来） |
  | `turn` | 中心线总转角。**超过 π 尖端就会向内翻卷** |
  | `turnPow` | 卷曲集中在哪一段，越大越靠尖端 |

- 顶点色里存了每个顶点在渐变中的位置 `ts`，疯狂变色时才不用重建几何
- 光照以环境光为主（Hemisphere 2.0 + 平行光 0.85）：
  平行光一强，平坦花瓣就每个面一块死高光，立刻变「低多边形折纸」

## 内容目录

- **`txt文件/`** — 正文内容和 PDF，是**唯一的内容源头**。`.txt` / `.md` 由 `SiteContent.load()` 读取；`.pdf` 以 embed 方式嵌入。命名体现归属（如 `魔法_前言.txt`）。
  - **改完这里的内容后要跑 `node 生成内容.js` 刷新 `站点内容.js`**，
    否则双击（`file://`）看到的还是旧快照
- **`站点内容.js`** — 自动生成的正文快照 + 读取器，给 `file://` 兜底，**不要手改**
- **`lib/`** — 本地内置的第三方库（`three.min.js` r160 UMD、`marked.min.js`），离线也能用
- **`图片/`** — 所有图片资源（网站图标、logo、角色图、光标图）。许多资源同时存在 `.png` 和 `.webp` 两种格式。
- **`音频文件/`** — 音频文件（目前为 `爆弾.m4a`，烟花模式使用）
- **`字体/`** — 自定义字体（`破晓像素.ttf` 像素字体，`源古宋體-F.ttf`）
- **`ai_workspace/`** — AI 工作区：改动的副本、新文件、改动说明都先放这里，得到用户许可后再搬到正式位置

## 样式架构（`风格.css`）

**所有配色 / 圆角 / 阴影 / 尺寸都收在文件顶部的 `:root` 变量里，改那一段就能全站换风格。**

- `--linen` / `--paper` / `--surface`：纸面底色与卡片纸白
- `--brand*`：焦糖色系（`--brand` 就是原来的 `burlywood`）
- `--accent*`：强调粉（沿用原来的 `#FF8FB1` 一脉）
- `--ink` / `--ink-2` / `--ink-3`：暖褐墨色，代替纯黑
- `--sh-1/2/3`：三级暖色投影（用 `rgba(122,94,62,…)` 而不是灰黑）
- `--topbar-h`、`--sidebar-w`、`--logo-img`：导航栏高度、侧边栏宽度、logo 尺寸
- `--font-ui` / `--font-serif` / `--font-pixel`：正文字体、宋体（长文阅读）、`破晓像素`

关键选择器：

- `.top-bar` / `.logo-slot` / `.logo`：导航栏与 logo（logo 原图是 2048² 的方形，
  文字只占中间 569px 高，靠透明留白撑版面，所以要用 `.logo-slot` 裁切）
- `.sidebar` + `.main` + `.wrap`：flexbox 布局；`.wrap::before` 单独画贯穿到底的分隔线
- `.menu` / `.sub1`：树形菜单，`.current` 为当前条目；带子菜单的项用 `:has(> .sub1)` 画箭头
- `.hidden-all`：烟花模式的隐藏规则，配合 `花火.js`
- `#txtBox`：正文。**`.txt` 是纯文本，必须用 `white-space: pre-wrap` 保留换行**，
  否则整篇小说会被压成一整段；Markdown 走 `innerHTML`，所以要加 `.md` 类切回 `normal`
- `#prologue`：前言便签卡
- `#txtBox canvas`：游戏画布（暖色纸底 + 描边 + 圆角）。
  **`height: auto` 不能删**，否则窄屏下 `max-width: 100%` 会把画布压扁变形
- `#txtBox embed.pdf-view`：PDF 阅读器（文学「梅血饅頭」的三篇短篇），
  高度 `clamp(460px, 76vh, 920px)`。
  **PDF 用 `<embed>` 直接交给浏览器自带的阅读器、不走 `fetch`**，
  所以双击（`file://`）打开也能看 —— 这点和 `.txt`/`.md` 不一样
- `.hanauta` / `.hanauta-call` / `.hanauta-reset`：花瓣占卜的按钮与排版。
  `.is-like` 粉色、`.is-dislike` 蓝色、`.is-done` 是出结果后的状态
- `.hanauta-styles` / `.hanauta-style`：花的样子切换胶囊按钮，`.is-active` 为选中态
- 窄屏（`max-width: 820px`）：侧边栏改为上下堆叠，导航栏与 logo 同步缩小

## 调参时最容易踩的五个坑

这几条都是做花瓣占卜（尤其 3D 那一版）时真踩过的，放着避免重蹈覆辙。

**1. 逐项列举参数的调用处，改了参数名就会静默失效。**
`makePetalGeometry` 的参数从 `curl/twist` 改成 `turn/roll/envA/envB` 之后，
配置对象和函数体都改了，唯独中间的调用处还在写
`makePetalGeometry({ len:…, wid:…, curl:…, twist:… })` ——
于是新参数**一个都没传进去，全部走默认值**，花瓣永远是平的。
表现是「怎么调都没反应」，极难靠肉眼定位。

> 修法：把参数对象整体展开传进去，别逐项列举。
> `makePetalGeometry(Object.assign({ colorBase, colorTip }, f.petal))`
> 这样以后往配置里加字段，不会再漏。

**2. 验证截图必须关浏览器缓存。**
`Network.setCacheDisabled({ cacheDisabled: true })`。
不关的话，改完代码再截图，很可能拿到的还是上一版，
于是会得出「改了没效果」的错误结论，然后在错误的方向上继续调参。

**3. 视觉调参前，先把真实数值打出来。**
花瓣卷没卷、卷了多少，靠看截图猜很容易误判（尤其卷曲发生在竖直平面时，
正对镜头看就是一条线）。直接读几何的包围盒最快：

```js
o.geometry.computeBoundingBox();
// 平的 → y 范围几乎为 0；卷起来 → y 会明显抬高
```

**先确认「几何到底变没变」，再去调参数。**

**4. `#txtBox` 是 `white-space: pre-wrap`，注入的 HTML 会被缩进撑高。**
这是为了 `.txt` 保留换行，但游戏 UI 是用模板字符串注入的，
模板里那些「换行 + 缩进」的空白会被当成**真实换行**渲染成一堆空行。
表现是某个容器莫名高出几百像素（`.hanauta-readout` 曾经是 215px 而不是 30px），
把「好き」按钮挤出首屏。

> 两道防线都要有：
> ① CSS 里 `#txtBox .hanauta { white-space: normal; }` 重置掉；
> ② 赋给 `innerHTML` 的模板末尾加 `.trim()`，否则**行首那个换行**在 `#txtBox`
> 里照样是一条空行（它不在 `.hanauta` 内部，第 ① 条管不到）。

**5. 判断「按钮有没有掉出首屏」要量，不要看截图。**
截图裁剪范围会骗人。直接读：

```js
call.getBoundingClientRect().bottom <= window.innerHeight
```


## Git 说明

- 单分支（`main`），无 PR 工作流
- 提交信息为非正式风格，中文撰写
- `.DS_Store` 文件已被跟踪 — 如不需要，建议加入 `.gitignore`
