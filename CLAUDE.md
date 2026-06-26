# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指导。
Claude Code在工作时，对于ai_workspace之外的文件只能读取或者复制，不能做其他操作，有任何需要更改的地方，请复制该文件到ai_workspace里面修改副本，人类会在确认无误后将文件放到应该放到地方。生成的任何新文件也请放到ai_workspace里面。谢谢。

## 概述

塞拉爱米露的个人网站 — 纯静态个人网站，无构建步骤、无框架、无依赖。直接在浏览器中打开任意 `.html` 文件即可预览。所有 CSS 和 JS 均为内联编写，或以 `<script src="...">` 标签引入。

## 运行 / 开发方式

```bash
# 无需构建步骤 — 直接在浏览器中打开
open index.html
# 如果 fetch() 遇到跨域问题，可以用 Python 内置服务器：
python3 -m http.server 8080
```

没有 package.json、打包工具、代码检查工具或测试套件。全部为原生 HTML/CSS/JS。

## 页面结构

| 文件 | 功能 |
|------|------|
| `index.html` | 着陆页，包含欢迎信息、自定义光标、密码保护烟花按钮 |
| `主页.html` | 主枢纽页 — 包含指向 6 个子版块的导航卡片 |
| `文学.html` | 文学版块 — 侧边栏导航通过 `fetch()` 加载 `.txt` 内容 |
| `技术.html` | 技术版块 — 加载 `.txt` 并通过 ES `import()` 动态导入 `.js` 游戏模块 |
| `数学.html` | 数学版块 — 加载 `.txt`，并通过 `<embed>` 嵌入 `.pdf` |
| `音乐.html` | 音乐版块（大部分为占位状态） |
| `塞拉.html` | 塞拉角色页面（占位状态） |
| `米露.html` | 米露角色页面（占位状态） |

## 子页面的共享模式（`文学/技术/数学/音乐/塞拉/米露.html`）

所有子页面共享相同的布局模式：
- **顶部导航栏**：`burlywood` 背景色，logo 图片链接回 `主页.html`
- **侧边栏**（`.sidebar`，200px 宽）：树形菜单，`<ul class="menu">` 内包含可折叠的 `<ul class="sub1">` 子菜单
- **主内容区**（`.main`）：两个内容 div — `#prologue`（默认介绍文字）和 `#txtBox`（点击菜单后加载的动态内容）
- 内容切换：所有 `.content` div 默认隐藏；添加 `.active` 类即可显示
- 自定义光标：body 设置 `cursor: none` + 由 `鼠标.js` 定位的 `.mouse` div

侧边栏 JS 逻辑在每个页面中以内联形式重复 — 相同模式：查询所有 `<a>` 标签，根据 `data-target` 或 `data-file` 属性切换 `#prologue`/`#txtBox` 的显示。

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
- **`ai_workspace/`** — 空目录（已纳入 git 跟踪，可能用于 AI 生成内容）

## 常用 CSS 规范

- `.top-bar`：全宽导航栏（高 100px，`burlywood` 背景色）
- `.mouse`：固定定位的光标替代（50×50px，z-index 9999，pointer-events none）
- `.box`：卡片式容器（400×200px，白色半透明，圆角，悬停上浮效果）
- `.sidebar` + `.main` + `.wrap`：flexbox 侧边栏布局（200px 侧边栏，flex-1 主区域）
- 配色：暖色调 — `linen` 背景，`burlywood` 导航栏，`#FF8FB1` 粉色边框，粉彩色渐变
- 自定义字体 `破晓像素` 通过 `@font-face` 从 `字体/破晓像素.ttf` 加载

## Git 说明

- 单分支（`main`），无 PR 工作流
- 提交信息为非正式风格，中文撰写
- `.DS_Store` 文件已被跟踪 — 如不需要，建议加入 `.gitignore`
