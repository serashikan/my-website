"""单进程临时入口的登录和注册限速；计数不随拒绝请求延长窗口。"""
from ipaddress import ip_address

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.http import HttpResponse
from django.utils.cache import patch_cache_control
from django.utils.crypto import salted_hmac


DEFAULT_LIMITS = {
    "login": (30, 300), "register": (10, 3600),
    "email_send": (10, 3600), "email_verify": (20, 300), "email_account": (20, 300),
}
ENDPOINTS = {
    "/accounts/login/": "login",
    "/admin/login/": "login",
    "/accounts/register/": "register",
    "/accounts/register/resend/": "email_send",
    "/accounts/email/verify/": "email_verify",
    "/account/info/": "email_account",
}
FALLBACK_IDENTITY = "loopback-or-unknown-fallback"


def consume_limit(key, limit, window):
    """原子计数；过期后重新争取窗口，异常竞争时保守拒绝。"""
    for _ in range(3):
        if cache.add(key, 1, timeout=window):
            return True
        try:
            return cache.incr(key) <= limit
        except ValueError:
            continue
    return False


def client_identity(request):
    try:
        peer = ip_address(request.META.get("REMOTE_ADDR", ""))
    except ValueError:
        return FALLBACK_IDENTITY
    if getattr(settings, "TRUST_CF_CONNECTING_IP", False) and peer.is_loopback:
        try:
            return str(ip_address(request.META.get("HTTP_CF_CONNECTING_IP", "")))
        except ValueError:
            # 缺失和损坏的代理头共用一个桶，不能通过换坏值绕过限制。
            return FALLBACK_IDENTITY
    return str(peer)


class AuthRateLimitMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        action = ENDPOINTS.get(request.path_info)
        if request.method != "POST" or action is None:
            return self.get_response(request)

        limit, window = getattr(settings, "AUTH_RATE_LIMITS", {}).get(
            action, DEFAULT_LIMITS[action],
        )
        if not isinstance(limit, int) or not isinstance(window, int) or limit < 1 or window < 1:
            raise ImproperlyConfigured("AUTH_RATE_LIMITS 必须指定正整数次数和窗口秒数。")
        digest = salted_hmac(
            "members.auth-rate-limit", client_identity(request), algorithm="sha256",
        ).hexdigest()
        key = f"auth-rate:{action}:{digest}"

        if consume_limit(key, limit, window):
            return self.get_response(request)

        if action == "register":
            message = "注册尝试过于频繁，请稍后再试。"
        elif action.startswith("email_"):
            message = "邮箱操作过于频繁，请稍后再试。"
        else:
            message = "登录尝试过于频繁，请稍后再试。"
        response = HttpResponse(message, status=429, content_type="text/plain; charset=utf-8")
        response["Retry-After"] = str(window)
        patch_cache_control(response, private=True, no_store=True, no_cache=True, max_age=0)
        return response
