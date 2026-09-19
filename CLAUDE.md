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

注意：`文学/技术/数学.html` 靠 `fetch()` 读取 `txt文件/` 里的内容，
用 `file://` 直接打开会因跨域限制而加载不出正文，建议用上面的本地服务器预览。

没有 package.json、打包工具、代码检查工具或测试套件。全部为原生 HTML/CSS/JS。

## 页面结构

| 文件 | 功能 |
|------|------|
| `风格.css` | 全站共享样式表 — 设计变量、基础排版、导航栏、侧边栏、正文、卡片 |
| `index.html` | 着陆页，包含欢迎信息、自定义光标、密码保护烟花按钮 |
| `主页.html` | 主枢纽页 — 包含指向 6 个子版块的导航卡片 |
| `文学.html` | 文学版块 — 侧边栏导航通过 `fetch()` 加载 `.txt` 内容 |
| `技术.html` | 技术版块 — 加载 `.txt`/`.md`，并通过 ES `import()` 动态导入 `.js` 游戏模块 |
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

`技术.html` 的点击回调必须是 `async function`（内部用了 `await import()`），
写成普通函数会是语法错误，导致整个 `<script>` 块失效、菜单全部点不动。

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

### `game-breakout.js` — 打砖块游戏（ES 模块）
- 导出 `init(container)`、`start()`、`stop()`
- 由 `技术.html` 通过 `import('./game-breakout.js')` 动态加载
- `init()` 向给定容器注入 `<canvas>`；`start()` 启动游戏循环；`stop()` 清理事件监听和动画帧
- 按住 `S` 键减速（将 `speedScale` 提升至最高 10 倍，实现慢动作效果）

## 内容目录

- **`txt文件/`** — 子页面加载的文本内容和 PDF。`.txt` 文件通过 fetch 获取并显示在 `#txtBox` 中；`.pdf` 文件以 embed 方式嵌入。命名规则体现归属关系（如 `魔法_前言.txt`、`魔法_贤者.txt`）。
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
- 窄屏（`max-width: 820px`）：侧边栏改为上下堆叠，导航栏与 logo 同步缩小

## Git 说明

- 单分支（`main`），无 PR 工作流
- 提交信息为非正式风格，中文撰写
- `.DS_Store` 文件已被跟踪 — 如不需要，建议加入 `.gitignore`
