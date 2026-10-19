from unittest.mock import patch

from django.core.cache import cache
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, override_settings

from .rate_limit import AuthRateLimitMiddleware


@override_settings(
    AUTH_RATE_LIMITS={"login": (2, 20), "register": (1, 30)},
    TRUST_CF_CONNECTING_IP=False,
    CACHES={"default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "test-only-auth-rate-limits",
    }},
)
class AuthRateLimitTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()
        self.view_calls = 0
        self.middleware = AuthRateLimitMiddleware(self.view)

    def tearDown(self):
        cache.clear()

    def view(self, request):
        # 不调用认证视图，也不计算密码哈希。
        self.view_calls += 1
        return HttpResponse("view reached")

    def request(self, path="/accounts/login/", method="post", **meta):
        request = getattr(self.factory, method)(path, REMOTE_ADDR=meta.pop("REMOTE_ADDR", "127.0.0.1"), **meta)
        return self.middleware(request)

    def test_account_and_admin_login_share_one_bucket_before_views_run(self):
        self.assertEqual(self.request().status_code, 200)
        self.assertEqual(self.request("/admin/login/").status_code, 200)
        for path in ("/accounts/login/", "/admin/login/"):
            response = self.request(path)
            self.assertEqual(response.status_code, 429)
            self.assertEqual(response.headers["Retry-After"], "20")
            self.assertIn("private", response.headers["Cache-Control"])
            self.assertIn("no-store", response.headers["Cache-Control"])
            self.assertContains(response, "请稍后再试", status_code=429)
        self.assertEqual(self.view_calls, 2)

    def test_registration_has_its_own_lower_limit(self):
        self.assertEqual(self.request().status_code, 200)
        self.assertEqual(self.request().status_code, 200)
        self.assertEqual(self.request("/accounts/register/").status_code, 200)
        response = self.request("/accounts/register/")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["Retry-After"], "30")
        self.assertContains(response, "注册尝试过于频繁", status_code=429)

    def test_get_and_unrelated_post_requests_do_not_consume_limits(self):
        for path in ("/accounts/login/", "/admin/login/", "/accounts/register/"):
            for _ in range(4):
                self.assertEqual(self.request(path, method="get").status_code, 200)
        for _ in range(4):
            self.assertEqual(self.request("/account/").status_code, 200)
        self.assertEqual(self.request().status_code, 200)
        self.assertEqual(self.request().status_code, 200)
        self.assertEqual(self.request().status_code, 429)
        self.assertEqual(self.request(method="get").status_code, 200)
        self.assertEqual(self.request("/accounts/register/").status_code, 200)

    def test_different_direct_peer_ips_have_independent_limits(self):
        for address in ("198.51.100.1", "198.51.100.2"):
            with self.subTest(address=address):
                self.assertEqual(self.request(REMOTE_ADDR=address).status_code, 200)
                self.assertEqual(self.request(REMOTE_ADDR=address).status_code, 200)
                self.assertEqual(self.request(REMOTE_ADDR=address).status_code, 429)

    def test_private_instance_ignores_cloudflare_and_forwarded_for_headers(self):
        for index, address in enumerate(("198.51.100.1", "198.51.100.2", "198.51.100.3")):
            response = self.request(
                HTTP_CF_CONNECTING_IP=address, HTTP_X_FORWARDED_FOR=address,
            )
            self.assertEqual(response.status_code, 200 if index < 2 else 429)

    @override_settings(TRUST_CF_CONNECTING_IP=True)
    def test_public_instance_uses_valid_cloudflare_ips_only_from_loopback(self):
        for address in ("198.51.100.1", "2001:db8::1"):
            with self.subTest(address=address):
                for expected in (200, 200, 429):
                    self.assertEqual(self.request(
                        REMOTE_ADDR="::1", HTTP_CF_CONNECTING_IP=address,
                    ).status_code, expected)

    @override_settings(TRUST_CF_CONNECTING_IP=True)
    def test_non_loopback_peer_cannot_select_its_identity_with_proxy_headers(self):
        for index, address in enumerate(("198.51.100.1", "198.51.100.2", "198.51.100.3")):
            response = self.request(
                REMOTE_ADDR="203.0.113.10", HTTP_CF_CONNECTING_IP=address,
                HTTP_X_FORWARDED_FOR=address,
            )
            self.assertEqual(response.status_code, 200 if index < 2 else 429)

    @override_settings(TRUST_CF_CONNECTING_IP=True)
    def test_missing_or_invalid_cloudflare_headers_share_one_fallback_bucket(self):
        requests = (
            {"REMOTE_ADDR": "127.0.0.1"},
            {"REMOTE_ADDR": "::1", "HTTP_CF_CONNECTING_IP": "not-an-ip"},
            {"REMOTE_ADDR": "127.0.0.2", "HTTP_CF_CONNECTING_IP": "198.51.100.1, 198.51.100.2"},
            {"REMOTE_ADDR": "invalid-peer", "HTTP_CF_CONNECTING_IP": "198.51.100.20"},
        )
        for index, meta in enumerate(requests):
            self.assertEqual(self.request(**meta).status_code, 200 if index < 2 else 429)

    @override_settings(TRUST_CF_CONNECTING_IP=True)
    def test_forwarded_for_does_not_change_public_client_identity(self):
        for index, forwarded in enumerate(("198.51.100.1", "198.51.100.2", "malformed")):
            response = self.request(
                HTTP_CF_CONNECTING_IP="203.0.113.8", HTTP_X_FORWARDED_FOR=forwarded,
            )
            self.assertEqual(response.status_code, 200 if index < 2 else 429)

    @override_settings(TRUST_CF_CONNECTING_IP=True)
    def test_equivalent_ipv6_spelling_does_not_create_another_bucket(self):
        for index, address in enumerate(("2001:db8::1", "2001:0db8:0:0:0:0:0:1", "2001:db8::1")):
            self.assertEqual(self.request(
                HTTP_CF_CONNECTING_IP=address,
            ).status_code, 200 if index < 2 else 429)

    def test_window_expires_from_first_attempt_without_sliding_on_retries(self):
        with patch("django.core.cache.backends.locmem.time.time", return_value=100) as clock:
            self.assertEqual(self.request().status_code, 200)
            clock.return_value = 110
            self.assertEqual(self.request().status_code, 200)
            clock.return_value = 119
            self.assertEqual(self.request().status_code, 429)
            clock.return_value = 121
            self.assertEqual(self.request().status_code, 200)

    def test_cache_keys_are_secret_dependent_and_do_not_contain_plain_ip(self):
        address = "198.51.100.17"
        with patch("members.rate_limit.cache") as counter:
            counter.add.return_value = True
            with override_settings(SECRET_KEY="test-only-first-secret"):
                self.assertEqual(self.request(REMOTE_ADDR=address).status_code, 200)
            first_key = counter.add.call_args.args[0]
            with override_settings(SECRET_KEY="test-only-second-secret"):
                self.assertEqual(self.request(REMOTE_ADDR=address).status_code, 200)
            second_key = counter.add.call_args.args[0]
        self.assertNotIn(address, first_key)
        self.assertNotIn(address, second_key)
        self.assertNotEqual(first_key, second_key)
