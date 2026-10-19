"""全站登录：先经 SSH 验证；公网 HTTPS 参数在接入域名时配置。"""
import os
import secrets
from pathlib import Path

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
