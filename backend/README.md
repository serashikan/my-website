# 个人网站的 Mint 完整版

当前项目有两个发布入口，共用一套前端源码：

- 仓库根目录的 HTML、CSS、JavaScript、图片、音乐和文章，继续用于 GitHub Pages 的公开静态版。
- 本目录提供 Django 账号、便签和全站登录检查。`build_site` 从原站生成受保护的前端副本，供 Mint 完整版使用。

日常只在本机项目文件夹修改源码，再分别推送 GitHub 和部署 Mint。不要在服务器上单独修改网页，否则两份发布结果会逐渐不同。

Mint 登录只限制 Mint 入口。GitHub Pages 及公开仓库中的同一份文章、图片和视频仍然公开。若以后出现真正只供熟人阅读的内容，应单独存入后端，不能同时提交到公开仓库或静态版。

## 文件与数据

| 位置 | 用途 |
| --- | --- |
| 项目根目录 | 共享的前端源码与资源 |
| `backend/` | 后端源码、测试、部署配置 |
| 服务器项目的 `.venv/` | 服务器自己安装的 Python 依赖 |
| 服务器项目的 `.local/db.sqlite3` | 账号、会话和便签 |
| 服务器项目的 `.local/secret.key` | 服务器自己的签名密钥 |
| 服务器项目的 `.local/site/` | `build_site` 生成的完整版前端 |
| 服务器项目的 `.local/static/` | `collectstatic` 收集的登录/管理界面样式和脚本 |

`.local/` 和 `.venv/` 均被 Git 忽略。部署时必须排除它们，数据库另外备份。现有 Mint 项目目录沿用 `~/sera-account-lab`，名称不影响运行；迁移保留原数据库和密钥。

## 注册和密码

登录页提供“注册”和“忘记密码”入口。注册只填写用户名、密码和确认密码；服务端检查重复用户名及密码要求，成功后创建普通账号并自动进入“我的小屋”。注册页面不接受管理员、权限或账号归属字段。已有账号的创建和停用仍可在管理后台操作。

能访问 Mint 入口的人可以自行注册并浏览完整版。当前没有邀请码或人工审核，也不收集注册邮箱。找回密码页只显示“请联系站主”，由站主核实身份后在后台重置密码。

## 本机开发与构建

从仓库根目录执行：

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
backend/.venv/bin/python backend/manage.py migrate
backend/.venv/bin/python backend/manage.py build_site --source .
backend/.venv/bin/python backend/manage.py collectstatic --noinput
backend/.venv/bin/python backend/manage.py test members
```

首次本机试用时，通过 `backend/.venv/bin/python backend/manage.py createsuperuser` 在自己的终端创建本机账号；它与 Mint 上的账号是独立的。不要把真实密码写进源码、命令参数或聊天。

```bash
cd backend
.venv/bin/gunicorn --config gunicorn.conf.py config.wsgi:application
```

默认仅监听 `127.0.0.1:8000`。浏览器访问时，未登录会跳转到登录页。

## Mint 更新流程

1. 在本机构建 `build_site` 以及运行测试。
2. 将 `backend/` 源码同步到远端项目目录，排除 `.venv/`、`.local/`、`__pycache__/`。
3. 仅把本机生成的 `.local/site/` 内容同步到远端对应目录；不要同步整个 `.local/`。
4. 远端安装锁定的依赖、执行 `migrate` 和 `collectstatic`。
5. `systemctl --user restart sera-website`。

例如，`SSH_TARGET` 必须先设置为实际 SSH 目标：

```bash
rsync -az --exclude='.venv' --exclude='.local' --exclude='__pycache__' backend/ "$SSH_TARGET:sera-account-lab/"
rsync -az --delete backend/.local/site/ "$SSH_TARGET:sera-account-lab/.local/site/"
```

第二条的 `--delete` 仅用于生成出来的前端副本，清除已从源码移除的网页。不能把删除范围扩大到 `.local/`，那里还有真实数据库和密钥。

## 服务管理

用户级 systemd 配置见 `deploy/sera-website.service`。安装位置为远端 `~/.config/systemd/user/sera-website.service`。

```bash
systemctl --user status sera-website
journalctl --user -u sera-website -n 30 --no-pager
systemctl --user restart sera-website
systemctl --user stop sera-website
```

这是用户级服务。是否在无人登录时、系统启动后也能运行，取决于 Mint 的用户会话和 linger 配置；本次没有修改系统级登录策略。

## 校园网络与公网入口

当前继续通过 SSH 端口转发访问。Mac 浏览器在本机访问，Mint 上无需图形界面：

```bash
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:18000:127.0.0.1:8000 "$SSH_TARGET"
```

打开 `http://127.0.0.1:18000/`。服务没有监听校园网网卡，所以同校其他人目前也不能直接访问 `校园IP:8000`。

校园内网地址不是可供校外直接访问的公网入口。后续若要给朋友使用，应先确认学校允许的接入方式和可用网络，再配置稳定的 HTTPS 入口。可以评估学校提供的网络服务或合适的隧道/托管服务；本次没有启动公网隧道，也没有改防火墙或路由器。

公网接入需要配置明确的域名、HTTPS、登录尝试限制和备份。配置项包括 `DJANGO_ALLOWED_HOSTS`、`DJANGO_PUBLIC_HTTPS=1`、`DJANGO_CSRF_TRUSTED_ORIGINS`。仅在可信 HTTPS 代理后启用 `DJANGO_TRUST_HTTPS_PROXY=1`。

## 权限与资源验证

全站登录中间件必须放在 `AuthenticationMiddleware` 之后、静态文件处理之前。不要把 `WhiteNoiseMiddleware` 移到登录检查前，也不要让另一个文件服务器直接公开 `.local/site/`。

公开的 `/static/` 仅含 Django 登录/管理和导航脚本样式。文章快照 `站点内容.js`、PDF、图片、字体、音乐和 MP4 都由登录检查保护。响应使用 `private, no-store`，并根据 Cookie 区分；退出后文件直链和条件请求也必须重新登录。

视频通过流式文件响应和 HTTP Range 发送，不把整段视频读入 Python 内存。`members/static_files.py` 包含 WhiteNoise 6.12 单字节 Range 的兼容处理，相关边界有测试。

迁移保留 URL 和资源相对路径；浏览器中小游戏、花语工具保存的 `localStorage` 按域名/端口隔离，不会从 GitHub 地址自动转移到 Mint 地址。
