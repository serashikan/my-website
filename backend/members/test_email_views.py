"""邮箱 HTTP 边界；测试邮件仅写入内存，不调用 SMTP。"""
import re
from unittest.mock import patch
from urllib.parse import unquote

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .email_services import (MailDeliveryError, create_email_request,
                             create_registration, send_verification)
from .models import AccountEmail, EmailOperation


@override_settings(
    EMAIL_VERIFICATION_ENABLED=True, SITE_PUBLIC_URL="https://example.test",
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    EMAIL_VERIFICATION_COOLDOWN=0, EMAIL_VERIFICATION_MAX_PER_HOUR=50,
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class EmailViewTests(TestCase):
    password = "test-only-Email-Confirm-Passphrase-852!"

    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user("email-owner", password=cls.password)
        cls.other = get_user_model().objects.create_user("email-other", password=cls.password)
        AccountEmail.objects.create(user=cls.other, email="other-private@example.test",
                                    verified_at=timezone.now())

    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def signup(self, client=None):
        return (client or self.client).post(reverse("register"), {
            "username": "pending-reader", "email": "pending-reader@example.test",
            "password1": self.password, "password2": self.password,
        })

    def token(self):
        return unquote(re.search(r"#token=([^\s<>]+)", mail.outbox[-1].body).group(1))

    def assert_private(self, response):
        self.assertIn("no-store", response.headers.get("Cache-Control", ""))
        self.assertIn("Cookie", response.headers.get("Vary", ""))

    def test_signup_needs_email_and_does_not_create_an_unverified_user(self):
        response = self.client.post(reverse("register"), {
            "username": "pending-reader", "password1": self.password, "password2": self.password,
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn("email", response.context["form"].errors)
        self.assertFalse(EmailOperation.objects.exists())
        self.assertFalse(get_user_model().objects.filter(username="pending-reader").exists())

    @override_settings(EMAIL_VERIFICATION_ENABLED=False)
    def test_unconfigured_mail_never_opens_account_or_claims_mail_sent(self):
        response = self.signup()
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "邮箱验证暂未配置完成")
        self.assertFalse(EmailOperation.objects.exists())
        self.assertFalse(get_user_model().objects.filter(username="pending-reader").exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_delivery_failure_keeps_pending_for_password_protected_retry(self):
        with patch("members.views.send_verification", side_effect=MailDeliveryError("test-only failure")):
            response = self.signup()
        self.assertRedirects(response, reverse("register_pending"), fetch_redirect_response=False)
        operation = EmailOperation.objects.get()
        self.assertEqual(operation.status, EmailOperation.Status.PENDING)
        self.assertEqual(self.client.session["pending_registration"], str(operation.pk))
        response = self.client.get(reverse("register_pending"))
        self.assertContains(response, "验证邮件未能发送")
        self.assertContains(self.client.get(reverse("register_pending")), "验证邮件尚未发送成功")
        self.assertNotIn("_auth_user_id", self.client.session)
        self.assertFalse(get_user_model().objects.filter(username="pending-reader").exists())
        with patch("members.views.send_verification") as send:
            self.client.post(reverse("register_resend"), {"current_password": "wrong"})
            send.assert_not_called()
        self.assertRedirects(self.client.post(reverse("register_resend"), {
            "current_password": self.password,
        }), reverse("register_pending"))
        self.assertEqual(len(mail.outbox), 1)

    def test_pending_registration_is_visible_only_to_the_creating_session(self):
        self.signup()
        operation = EmailOperation.objects.get()
        own = self.client.get(reverse("register_pending"))
        self.assertContains(own, operation.target_email)
        stranger = Client().get(reverse("register_pending"), {"operation": str(operation.pk)})
        self.assertNotContains(stranger, operation.target_email)
        self.assertNotContains(stranger, operation.username)
        self.assert_private(stranger)
        self.client.force_login(self.other)
        self.assertRedirects(self.client.get(reverse("register_pending")), reverse("account_info"))

    def test_verify_get_does_not_lookup_or_consume_any_token(self):
        self.signup()
        operation = EmailOperation.objects.get()
        token = self.token()
        with patch("members.views.verify_token") as verify:
            response = self.client.get(reverse("email_verify"), {"token": token})
            verify.assert_not_called()
        operation.refresh_from_db()
        self.assertEqual(operation.status, EmailOperation.Status.PENDING)
        self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
        self.assertNotContains(response, token)
        self.assertContains(response, 'name="token"')
        self.assertContains(response, "email-verify.js")
        self.assert_private(response)

    def test_verify_requires_csrf_and_password_before_consuming_token(self):
        self.signup()
        token = self.token()
        strict = Client(enforce_csrf_checks=True)
        response = strict.post(reverse("email_verify"), {"token": token, "password": self.password})
        self.assertEqual(response.status_code, 403)
        strict.get(reverse("email_verify"))
        with patch("members.views.verify_token") as verify:
            response = strict.post(reverse("email_verify"), {
                "token": token, "password": "", "csrfmiddlewaretoken": strict.cookies["csrftoken"].value,
            })
            self.assertEqual(response.status_code, 200)
            verify.assert_not_called()
        response = strict.post(reverse("email_verify"), {
            "token": token, "password": self.password,
            "csrfmiddlewaretoken": strict.cookies["csrftoken"].value,
        })
        self.assertRedirects(response, reverse("account"))
        user = get_user_model().objects.get(username="pending-reader")
        self.assertEqual(strict.session["_auth_user_id"], str(user.pk))

    def test_another_logged_in_account_cannot_consume_registration_link(self):
        self.signup()
        token = self.token()
        self.client.force_login(self.other)
        response = self.client.post(reverse("email_verify"), {"token": token, "password": self.password})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(get_user_model().objects.filter(username="pending-reader").exists())
        self.assertEqual(EmailOperation.objects.get().status, EmailOperation.Status.PENDING)
        self.assertEqual(self.client.session["_auth_user_id"], str(self.other.pk))

    def test_account_info_requires_login_and_never_discloses_another_users_email(self):
        self.assertEqual(self.client.get(reverse("account_info")).status_code, 302)
        self.client.force_login(self.owner)
        response = self.client.get(reverse("account_info"), {"user": self.other.pk})
        self.assertNotContains(response, "other-private@example.test")
        self.assertContains(response, self.owner.username)
        self.assertContains(response, reverse("password_change"))
        self.assert_private(response)
        self.assertNotIn("email", self.client.get(reverse("session_info")).json())

    def test_account_sensitive_actions_require_current_password_and_csrf(self):
        self.client.force_login(self.owner)
        operation = create_email_request(self.owner, "own-pending@example.test")
        for action in ("request", "resend", "cancel"):
            with self.subTest(action=action), patch("members.views.create_email_request") as create, \
                    patch("members.views.send_verification") as send, patch("members.views.cancel_operation") as cancel:
                for password in ("", "wrong"):
                    response = self.client.post(reverse("account_info"), {
                        "action": action, "email": "forged@example.test", "current_password": password,
                        "user": self.other.pk, "operation": str(operation.pk),
                    })
                    self.assertEqual(response.status_code, 200)
                create.assert_not_called(); send.assert_not_called(); cancel.assert_not_called()
        strict = Client(enforce_csrf_checks=True)
        strict.force_login(self.owner)
        response = strict.post(reverse("account_info"), {
            "action": "cancel", "current_password": self.password,
        })
        self.assertEqual(response.status_code, 403)
        operation.refresh_from_db()
        self.assertEqual(operation.status, EmailOperation.Status.PENDING)

    def test_pending_replacement_requires_explicit_cancel_and_other_operation_id_is_ignored(self):
        self.client.force_login(self.owner)
        operation = create_email_request(self.owner, "own-pending@example.test")
        other_operation = create_email_request(self.other, "other-pending@example.test")
        response = self.client.post(reverse("account_info"), {
            "action": "request", "email": "replacement@example.test", "current_password": self.password,
        })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.context["email_form"].errors)
        self.client.post(reverse("account_info"), {
            "action": "cancel", "current_password": self.password, "operation": str(other_operation.pk),
        })
        operation.refresh_from_db(); other_operation.refresh_from_db()
        self.assertEqual(operation.status, EmailOperation.Status.CANCELLED)
        self.assertEqual(other_operation.status, EmailOperation.Status.PENDING)

    def test_first_email_is_saved_after_verification_and_change_waits_for_review(self):
        self.client.force_login(self.owner)
        response = self.client.post(reverse("account_info"), {
            "action": "request", "email": "first@example.test", "current_password": self.password,
        })
        self.assertRedirects(response, reverse("account_info"))
        self.assertFalse(AccountEmail.objects.filter(user=self.owner).exists())
        self.assertRedirects(self.client.post(reverse("email_verify"), {
            "token": self.token(), "password": self.password,
        }), reverse("account_info"))
        saved = AccountEmail.objects.get(user=self.owner)
        self.assertEqual(saved.email, "first@example.test")
        self.assertIsNotNone(saved.verified_at)
        self.client.post(reverse("account_info"), {
            "action": "request", "email": "replacement@example.test", "current_password": self.password,
        })
        response = self.client.post(reverse("email_verify"), {"token": self.token(), "password": self.password})
        self.assertRedirects(response, reverse("account_info"))
        saved.refresh_from_db()
        self.assertEqual(saved.email, "first@example.test")
        pending = EmailOperation.objects.get(user=self.owner, status=EmailOperation.Status.AWAITING_REVIEW)
        self.assertEqual(pending.target_email, "replacement@example.test")
        self.assertContains(self.client.get(reverse("account_info")), "正在等待站主审核")

    def test_same_address_can_verify_without_review_and_password_change_link_remains(self):
        AccountEmail.objects.create(user=self.owner, email="unverified@example.test")
        # 与迁移和正式绑定服务一致：旧邮箱同时保存在 User.email 镜像中。
        get_user_model().objects.filter(pk=self.owner.pk).update(email="unverified@example.test")
        self.client.force_login(self.owner)
        self.client.post(reverse("account_info"), {
            "action": "request", "email": "unverified@example.test", "current_password": self.password,
        })
        response = self.client.post(reverse("email_verify"), {"token": self.token(), "password": self.password})
        self.assertRedirects(response, reverse("account_info"))
        self.assertIsNotNone(AccountEmail.objects.get(user=self.owner).verified_at)
        self.assertFalse(EmailOperation.objects.filter(status=EmailOperation.Status.AWAITING_REVIEW).exists())
        self.assertContains(self.client.get(reverse("password_change")), 'name="old_password"')
