import importlib.util
import os
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.test import Client, SimpleTestCase, TestCase, override_settings
from django.urls import reverse


PUBLIC_HOST = "test-only-quiet-moon.trycloudflare.com"


def load_public_settings(host):
    """单独加载配置文件，不切换测试进程的 DJANGO_SETTINGS_MODULE。"""
    path = Path(__file__).resolve().parents[1] / "config" / "public_settings.py"
    spec = importlib.util.spec_from_file_location("config._test_public_settings", path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(os.environ):
        os.environ.pop("DJANGO_PUBLIC_HOST", None)
        if host is not None:
            os.environ["DJANGO_PUBLIC_HOST"] = host
        spec.loader.exec_module(module)
    return module


PUBLIC_CONFIG = load_public_settings(PUBLIC_HOST)
PUBLIC_OVERRIDES = {
    name: getattr(PUBLIC_CONFIG, name)
    for name in (
        "DEBUG", "ALLOWED_HOSTS", "CSRF_TRUSTED_ORIGINS",
        "SECURE_PROXY_SSL_HEADER", "SECURE_SSL_REDIRECT",
        "SESSION_COOKIE_SECURE", "SESSION_COOKIE_HTTPONLY", "CSRF_COOKIE_SECURE",
        "SESSION_COOKIE_NAME", "CSRF_COOKIE_NAME", "TRUST_CF_CONNECTING_IP",
        "AUTH_RATE_LIMITS", "MIDDLEWARE", "CACHES",
    )
}


class PublicSettingsTests(SimpleTestCase):
    def test_missing_wildcard_or_invalid_hosts_refuse_to_start(self):
        for host in (
            None, "", "*", "*.trycloudflare.com", ".trycloudflare.com",
            "example.com", f"https://{PUBLIC_HOST}", f"{PUBLIC_HOST}:443",
            f"{PUBLIC_HOST}/path", f"{PUBLIC_HOST}.example.com", f" {PUBLIC_HOST}",
        ):
            with self.subTest(host=host):
                with self.assertRaises(ImproperlyConfigured):
                    load_public_settings(host)

    def test_exact_host_https_and_distinct_secure_cookie_settings(self):
        original_module = os.environ.get("DJANGO_SETTINGS_MODULE")
        public = load_public_settings(PUBLIC_HOST)
        self.assertEqual(os.environ.get("DJANGO_SETTINGS_MODULE"), original_module)
        self.assertEqual(public.ALLOWED_HOSTS, [PUBLIC_HOST])
        self.assertEqual(public.CSRF_TRUSTED_ORIGINS, [f"https://{PUBLIC_HOST}"])
        self.assertEqual(public.SECURE_PROXY_SSL_HEADER, ("HTTP_X_FORWARDED_PROTO", "https"))
        self.assertFalse(public.DEBUG)
        self.assertTrue(public.SECURE_SSL_REDIRECT)
        self.assertTrue(public.SESSION_COOKIE_SECURE)
        self.assertTrue(public.SESSION_COOKIE_HTTPONLY)
        self.assertTrue(public.CSRF_COOKIE_SECURE)
        self.assertTrue(public.TRUST_CF_CONNECTING_IP)
        self.assertTrue(public.SESSION_COOKIE_NAME.startswith("__Host-"))
        self.assertTrue(public.CSRF_COOKIE_NAME.startswith("__Host-"))
        self.assertNotEqual(public.SESSION_COOKIE_NAME, public.CSRF_COOKIE_NAME)
        self.assertNotEqual(public.SESSION_COOKIE_NAME, settings.SESSION_COOKIE_NAME)
        self.assertNotEqual(public.CSRF_COOKIE_NAME, settings.CSRF_COOKIE_NAME)


@override_settings(**PUBLIC_OVERRIDES)
class PublicAccessFlowTests(TestCase):
    password = "test-only-Public-Passphrase-758!"

    @classmethod
    def setUpTestData(cls):
        # 仅临时测试数据库中的账号，不写入运行中网站的账号库。
        cls.reader = get_user_model().objects.create_user("public-test-reader", password=cls.password)

    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)

    def tearDown(self):
        cache.clear()

    def request(self, path, method="get", data=None, **extra):
        meta = {
            "HTTP_HOST": PUBLIC_HOST,
            "HTTP_X_FORWARDED_PROTO": "https",
            "REMOTE_ADDR": "127.0.0.1",
            "HTTP_CF_CONNECTING_IP": "198.51.100.30",
            **extra,
        }
        return getattr(self.client, method)(path, data=data or {}, **meta)

    def login_data(self):
        self.request(reverse("login"))
        return {
            "username": self.reader.username,
            "password": self.password,
            "csrfmiddlewaretoken": self.client.cookies[settings.CSRF_COOKIE_NAME].value,
        }

    def test_forwarded_https_has_no_redirect_loop_and_plain_http_redirects(self):
        response = self.request(reverse("login"))
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Location", response.headers)
        response = self.request(reverse("login"), HTTP_X_FORWARDED_PROTO="http")
        self.assertEqual(response.status_code, 301)
        self.assertEqual(response.url, f"https://{PUBLIC_HOST}{reverse('login')}")
        response = self.request("/health/")
        self.assertEqual(response.status_code, 200)

    def test_valid_https_login_sets_secure_host_cookies_and_authenticated_session(self):
        data = self.login_data()
        response = self.request(
            reverse("login"), method="post", data=data,
            HTTP_ORIGIN=f"https://{PUBLIC_HOST}",
        )
        self.assertRedirects(response, reverse("account"), fetch_redirect_response=False)
        self.assertEqual(self.client.session["_auth_user_id"], str(self.reader.pk))
        session_cookie = self.client.cookies[settings.SESSION_COOKIE_NAME]
        csrf_cookie = self.client.cookies[settings.CSRF_COOKIE_NAME]
        for cookie in (session_cookie, csrf_cookie):
            self.assertTrue(cookie["secure"])
            self.assertEqual(cookie["path"], "/")
            self.assertEqual(cookie["domain"], "")
        self.assertTrue(session_cookie["httponly"])
        self.assertNotIn("sessionid", self.client.cookies)
        self.assertNotIn("csrftoken", self.client.cookies)
        self.assertEqual(self.request(reverse("account")).status_code, 200)

    def test_csrf_rejects_untrusted_origins_even_with_a_valid_token(self):
        data = self.login_data()
        for origin in (
            "https://example.com", "https://other-tunnel.trycloudflare.com",
            f"http://{PUBLIC_HOST}",
        ):
            with self.subTest(origin=origin):
                response = self.request(
                    reverse("login"), method="post", data=data, HTTP_ORIGIN=origin,
                )
                self.assertEqual(response.status_code, 403)
                self.assertNotIn("_auth_user_id", self.client.session)

    def test_unauthenticated_private_files_and_range_requests_redirect_to_login(self):
        for path in ("/", "/站点内容.js", "/音频文件/private.mp4", "/txt文件/private.pdf"):
            for method in ("get", "head"):
                with self.subTest(path=path, method=method):
                    response = self.request(path, method=method, HTTP_RANGE="bytes=0-1")
                    self.assertEqual(response.status_code, 302)
                    self.assertTrue(response.url.startswith(reverse("login") + "?next="))
                    self.assertIn("private", response.headers["Cache-Control"])
                    self.assertIn("no-store", response.headers["Cache-Control"])
                    self.assertIn("Cookie", response.headers["Vary"])

    def test_unknown_hosts_are_rejected_despite_forwarded_https(self):
        for host in ("other-tunnel.trycloudflare.com", f"subdomain.{PUBLIC_HOST}", "127.0.0.1"):
            with self.subTest(host=host):
                response = self.request(reverse("login"), HTTP_HOST=host)
                self.assertEqual(response.status_code, 400)
