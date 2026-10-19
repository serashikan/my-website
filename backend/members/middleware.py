from django.contrib.auth.views import redirect_to_login
from django.utils.cache import patch_cache_control, patch_vary_headers


class SiteLoginRequiredMiddleware:
    """HTML、文章快照、图片、PDF 和 Range 视频请求统一经过这里。"""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # /static/ 只含 Django 登录/管理界面的样式脚本，不放网站正文资源。
        public_asset = request.path_info.startswith("/static/")
        public_page = request.path_info in {
            "/accounts/login/", "/accounts/register/", "/accounts/password_reset/", "/health/",
        }
        if public_asset or public_page or request.user.is_authenticated:
            response = self.get_response(request)
        else:
            response = redirect_to_login(request.get_full_path())
        if not public_asset:
            # 防止浏览器或共享缓存把已登录时下载的内容直接给未登录者。
            patch_cache_control(response, private=True, no_store=True, no_cache=True, max_age=0)
            patch_vary_headers(response, ["Cookie"])
        return response
