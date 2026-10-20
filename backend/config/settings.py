"""全站登录：先经 SSH 验证；公网 HTTPS 参数在接入域名时配置。"""
import os
import re
import secrets
from pathlib import Path
from urllib.parse import urlsplit

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / ".local"
DATA_DIR.mkdir(mode=0o700, exist_ok=True)

# 每台电脑生成自己的密钥。密钥、数据库、用户密码都不放进 Git。
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    key_path = DATA_DIR / "secret.key"
    try:
        with open(key_path, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as key_file:
            key_file.write(secrets.token_urlsafe(64))
    except FileExistsError:
        pass
    SECRET_KEY = key_path.read_text().strip()

DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
# 通过 SSH 转发访问时，浏览器地址仍然是本机的 127.0.0.1。
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost,[::1]").split(",")
INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "members",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "members.rate_limit.AuthRateLimitMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # 顺序不能互换：文件服务器之前，先检查账号和登录状态。
    "members.middleware.SiteLoginRequiredMiddleware",
    "members.static_files.SiteStaticFilesMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE_DIR / "templates"],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {"default": {
    "ENGINE": "django.db.backends.sqlite3",
    "NAME": DATA_DIR / "db.sqlite3",
    "OPTIONS": {"timeout": 10},
}}
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = DATA_DIR / "static"
PRIVATE_SITE_ROOT = DATA_DIR / "site"
WHITENOISE_ROOT = PRIVATE_SITE_ROOT
WHITENOISE_INDEX_FILE = True
WHITENOISE_ALLOW_ALL_ORIGINS = False
WHITENOISE_AUTOREFRESH = False
WHITENOISE_USE_FINDERS = False
WHITENOISE_MAX_AGE = 0
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "account"
LOGOUT_REDIRECT_URL = "login"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 8
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
# 当前只监听回环地址。公网接入 HTTPS 后显式开启这些设置。
PUBLIC_HTTPS = os.environ.get("DJANGO_PUBLIC_HTTPS", "0") == "1"
SESSION_COOKIE_SECURE = PUBLIC_HTTPS
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = PUBLIC_HTTPS
SECURE_SSL_REDIRECT = PUBLIC_HTTPS
CSRF_TRUSTED_ORIGINS = [value for value in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if value]
if os.environ.get("DJANGO_TRUST_HTTPS_PROXY", "0") == "1":
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
# 站内 PDF 使用同源 embed；同时阻止其他网站把本站嵌入 iframe。
X_FRAME_OPTIONS = "SAMEORIGIN"


def _trusted_https_origin(value):
    """邮件中的链接只能来自明确配置的 HTTPS 域名，不能借用请求 Host。"""
    if not isinstance(value, str) or not value or value.strip() != value:
        return ""
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
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


def _site_origin_from_configuration(environ=None, data_dir=None):
    """只解析受控的隧道域名配置；不执行或 source 环境文件。"""
    environ = os.environ if environ is None else environ
    if "DJANGO_SITE_URL" in environ:
        return _trusted_https_origin(environ["DJANGO_SITE_URL"])
    public_file = Path(DATA_DIR if data_dir is None else data_dir) / "public.env"
    try:
        if public_file.is_symlink():
            return ""
        with public_file.open("rb") as source:
            raw = source.read(16385)
        if len(raw) > 16384:
            return ""
        hosts = []
        for line in raw.decode("utf-8").splitlines():
            key, separator, value = line.strip().partition("=")
            if separator and key == "DJANGO_PUBLIC_HOST":
                value = value.strip()
                if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                hosts.append(value)
        if len(hosts) != 1 or not re.fullmatch(
            r"[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com", hosts[0],
        ):
            return ""
        return _trusted_https_origin(f"https://{hosts[0]}")
    except (OSError, UnicodeError):
        return ""


# 无凭据或未显式开启时，注册验证功能由 mail_ready 保持关闭。
# 测试可以使用 override_settings(EMAIL_BACKEND="...locmem.EmailBackend")。
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = os.environ.get("DJANGO_EMAIL_HOST", "smtp.126.com")
EMAIL_PORT = int(os.environ.get("DJANGO_EMAIL_PORT", "465"))
EMAIL_HOST_USER = os.environ.get("DJANGO_EMAIL_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("DJANGO_EMAIL_PASSWORD", "")
EMAIL_USE_SSL = os.environ.get("DJANGO_EMAIL_USE_SSL", "1") == "1"
EMAIL_USE_TLS = False
EMAIL_TIMEOUT = 10
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", EMAIL_HOST_USER)
EMAIL_VERIFICATION_ENABLED = os.environ.get("DJANGO_EMAIL_VERIFICATION_ENABLED", "0") == "1"
SITE_PUBLIC_URL = _site_origin_from_configuration()
