"""在用户自己的 SSH 终端配置 126 SMTP；只验证登录，不发送邮件。"""
import getpass
import os
import re
import smtplib
import ssl
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path
from urllib.parse import urlsplit


BASE_DIR = Path(__file__).resolve().parents[1]
SMTP_HOST = "smtp.126.com"
SMTP_PORT = 465
WEB_SERVICES = ("sera-website.service", "sera-website-public.service")


class MailSetupError(Exception):
    """仅向终端显示固定说明，不显示带凭据的底层异常。"""


def configured_origin(environ=None, data_dir=None):
    """独立于新版 settings，旧版 Django 项目也能先运行配置工具。"""
    environ = os.environ if environ is None else environ
    if "DJANGO_SITE_URL" in environ:
        value = environ["DJANGO_SITE_URL"]
    else:
        path = (BASE_DIR / ".local" if data_dir is None else Path(data_dir)) / "public.env"
        try:
            if path.is_symlink():
                return ""
            with path.open("rb") as source:
                raw = source.read(16385)
            if len(raw) > 16384:
                return ""
            hosts = []
            for line in raw.decode("utf-8").splitlines():
                key, separator, host = line.strip().partition("=")
                if separator and key == "DJANGO_PUBLIC_HOST":
                    host = host.strip()
                    if len(host) > 1 and host[0] == host[-1] and host[0] in "\"'":
                        host = host[1:-1]
                    hosts.append(host)
            if len(hosts) != 1 or not re.fullmatch(
                r"[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com", hosts[0],
            ):
                return ""
            value = f"https://{hosts[0]}"
        except (OSError, UnicodeError):
            return ""
    if (not isinstance(value, str) or not value or value.strip() != value
            or any(ord(char) < 32 or ord(char) == 127 for char in value)):
        return ""
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname or ""
        if (parsed.scheme != "https" or parsed.username is not None
                or parsed.password is not None or parsed.port not in (None, 443)
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            return ""
    except ValueError:
        return ""
    labels = hostname.split(".")
    if (len(hostname) > 253 or len(labels) < 2
            or hostname.endswith((".localhost", ".local"))
            or not any(character.isalpha() for character in labels[-1])
            or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                   for label in labels)):
        return ""
    return f"https://{hostname}"


def administrator_emails():
    """只从现有超级用户记录中选择合法的 126 发件地址。"""
    from django.contrib.auth import get_user_model
    from django.core.exceptions import ValidationError
    from django.core.validators import validate_email

    addresses = []
    seen = set()
    for email in get_user_model().objects.filter(is_superuser=True).exclude(
        email="",
    ).order_by("pk").values_list("email", flat=True):
        email = email.strip()
        try:
            validate_email(email)
        except ValidationError:
            continue
        if email.rsplit("@", 1)[-1].lower() != "126.com" or email.casefold() in seen:
            continue
        seen.add(email.casefold())
        addresses.append(email)
    return addresses


def choose_sender(addresses):
    if not addresses:
        raise MailSetupError("没有可用的现有管理员 126 邮箱，请先核对后台管理员邮箱。")
    if len(addresses) == 1:
        print(f"将使用现有管理员邮箱：{addresses[0]}")
        return addresses[0]
    print("找到多个管理员 126 邮箱，请选择本次发件地址：")
    for index, email in enumerate(addresses, start=1):
        print(f"{index}. {email}")
    selected = input("输入序号：").strip()
    if not selected.isdecimal() or not 1 <= int(selected) <= len(addresses):
        raise MailSetupError("选择无效，未修改配置。")
    return addresses[int(selected) - 1]


def verify_login(sender, authorization_code):
    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10, context=context) as smtp:
        smtp.set_debuglevel(0)
        smtp.login(sender, authorization_code)


def quote_environment_value(value):
    """systemd EnvironmentFile 双引号规则；不是 shell source 文件。"""
    if not isinstance(value, str) or any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise MailSetupError("配置值含有不支持的控制字符，未修改配置。")
    quoted = "".join("\\" + char if char in '\\"$`' else char for char in value)
    return f'"{quoted}"'


def write_mail_environment(sender, authorization_code, data_dir=None):
    directory = BASE_DIR / ".local" if data_dir is None else Path(data_dir)
    if directory.is_symlink():
        raise MailSetupError("本机数据目录不能是符号链接，未修改配置。")
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.stat().st_uid != os.getuid():
        raise MailSetupError("本机数据目录不属于当前用户，未修改配置。")
    target = directory / "mail.env"
    if target.is_symlink():
        raise MailSetupError("邮件配置不能是符号链接，未修改配置。")
    values = {
        "DJANGO_EMAIL_HOST": SMTP_HOST,
        "DJANGO_EMAIL_PORT": str(SMTP_PORT),
        "DJANGO_EMAIL_USER": sender,
        "DJANGO_EMAIL_PASSWORD": authorization_code,
        "DJANGO_EMAIL_USE_SSL": "1",
        "DJANGO_EMAIL_VERIFICATION_ENABLED": "1",
        "DEFAULT_FROM_EMAIL": sender,
    }
    # 不将临时网址写入 mail.env；每次启动从当前 public.env 获取最新网址。
    body = "".join(f"{key}={quote_environment_value(value)}\n" for key, value in values.items())
    descriptor, temporary_name = tempfile.mkstemp(prefix=".mail.env.", dir=directory)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


def restart_running_web_services():
    succeeded = True
    for service in WEB_SERVICES:
        try:
            active = subprocess.run(
                ["systemctl", "--user", "is-active", "--quiet", service],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=10,
            )
            if active.returncode != 0:
                continue
            restarted = subprocess.run(
                ["systemctl", "--user", "restart", service],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=30,
            )
            if restarted.returncode:
                succeeded = False
        except (OSError, subprocess.TimeoutExpired):
            succeeded = False
    return succeeded


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv == ["--help"]:
        print("用法：.venv/bin/python deploy/configure_mail.py [--restart-running-web]")
        print("授权码仅在交互提示中输入；可选参数仅重启已运行的网站服务，不重启隧道。")
        return 0
    if any(argument != "--restart-running-web" for argument in argv):
        print("此脚本不接受邮箱或授权码参数，请按提示在终端中输入。", file=sys.stderr)
        return 2
    if not all(stream.isatty() for stream in (sys.stdin, sys.stdout, sys.stderr)):
        print("请在自己的交互式 SSH 终端运行，不能通过管道或重定向输入授权码。", file=sys.stderr)
        return 1

    authorization_code = ""
    try:
        sys.path.insert(0, str(BASE_DIR))
        os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
        import django
        django.setup()

        if not configured_origin():
            raise MailSetupError("没有可信的 HTTPS 网站地址，请先启动公网入口或明确配置 DJANGO_SITE_URL。")
        sender = choose_sender(administrator_emails())
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            authorization_code = getpass.getpass("输入此邮箱的客户端授权码（不回显）：").strip()
        if not authorization_code:
            raise MailSetupError("授权码为空，未修改配置。")
        # 先验证值能安全写入，再联网；验证码不传给子进程或 os.environ。
        quote_environment_value(authorization_code)
        verify_login(sender, authorization_code)
        write_mail_environment(sender, authorization_code)
    except MailSetupError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (EOFError, KeyboardInterrupt):
        print("已取消，未修改邮件配置。", file=sys.stderr)
        return 1
    except Exception:
        # SMTP 服务器错误和调试异常可能带敏感信息，不打印 traceback 或原文。
        print("邮件配置未完成。请检查 SMTP 是否开启、授权码是否有效，以及 Mint 的网络连接。", file=sys.stderr)
        return 1
    finally:
        authorization_code = ""

    print("SMTP 的 TLS 连接和登录验证通过；未发送测试邮件。")
    print("已原子保存到服务器 .local/mail.env，文件权限为 600。")
    if "--restart-running-web" in argv:
        if not restart_running_web_services():
            print("配置已保存，但网站服务重启未全部完成，请检查网站服务状态。", file=sys.stderr)
            return 1
        print("已重启正在运行的网站服务；未重启隧道，临时网址保持不变。")
    else:
        print("请重启正在运行的网站服务以加载配置；不要为此重启隧道。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
