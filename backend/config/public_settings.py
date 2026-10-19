"""只用于 loopback 上由 cloudflared 转发的临时 HTTPS 入口。"""
import re

from django.core.exceptions import ImproperlyConfigured

from .settings import *  # noqa: F403

PUBLIC_HOST = os.environ.get("DJANGO_PUBLIC_HOST", "")
if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com", PUBLIC_HOST):
    raise ImproperlyConfigured("必须设置本次隧道的完整 DJANGO_PUBLIC_HOST，不能使用通配符。")

DEBUG = False
ALLOWED_HOSTS = [PUBLIC_HOST]
CSRF_TRUSTED_ORIGINS = [f"https://{PUBLIC_HOST}"]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
# 与 SSH 的 HTTP 入口隔离，__Host- 同时要求 Secure、Path=/、无 Domain。
SESSION_COOKIE_NAME = "__Host-sera_public_session"
CSRF_COOKIE_NAME = "__Host-sera_public_csrf"
TRUST_CF_CONNECTING_IP = True
AUTH_RATE_LIMITS = {"login": (30, 300), "register": (10, 3600)}
MIDDLEWARE = [*MIDDLEWARE]  # noqa: F405
MIDDLEWARE.insert(1, "members.rate_limit.AuthRateLimitMiddleware")
# 限速缓存只属于该单 worker 的进程，重启会清空；不要直接增加 worker。
CACHES = {"default": {
    "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    "LOCATION": "sera-public-auth",
    "OPTIONS": {"MAX_ENTRIES": 10000},
}}
