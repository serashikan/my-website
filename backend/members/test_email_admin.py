from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .email_services import EmailFlowError, review_change
from .models import AccountEmail, EmailOperation


User = get_user_model()


class EmailAdminTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = User.objects.create_user("mail-owner", password="AdminTest-password-61")
        self.admin = User.objects.create_superuser("site-owner", "admin@example.test", "AdminTest-password-62")
        self.staff = User.objects.create_user("limited-staff", is_staff=True)
        self.binding = AccountEmail.objects.create(user=self.owner, email="old@example.test", verified_at=timezone.now())
        User.objects.filter(pk=self.owner.pk).update(email=self.binding.email)
        self.operation = EmailOperation.objects.create(
            user=self.owner, kind=EmailOperation.Kind.CHANGE_EMAIL,
            previous_email=self.binding.email, target_email="new@example.test",
            status=EmailOperation.Status.AWAITING_REVIEW, verified_at=timezone.now(),
            expires_at=timezone.now() + timezone.timedelta(days=1),
        )

    def test_approval_service_requires_separate_permission(self):
        for reviewer in (self.owner, self.staff):
            with self.subTest(reviewer=reviewer.username), self.assertRaises(EmailFlowError):
                review_change(self.operation, reviewer, approve=True)
        self.binding.refresh_from_db()
        self.assertEqual(self.binding.email, "old@example.test")

    def test_user_admin_email_is_readonly_and_cannot_bypass_verification(self):
        self.client.force_login(self.admin)
        url = reverse("admin:auth_user_change", args=[self.owner.pk])
        response = self.client.get(url)
        self.assertContains(response, "old@example.test")
        self.assertNotContains(response, 'name="email"')
        response = self.client.post(url, {
            "username": self.owner.username, "first_name": "", "last_name": "",
            "email": "forged@example.test", "is_active": "on", "_save": "保存",
            "date_joined_0": "2026-10-20", "date_joined_1": "12:00:00",
        })
        self.assertIn(response.status_code, (200, 302))
        self.owner.refresh_from_db()
        self.assertEqual(self.owner.email, "old@example.test")

    def test_approval_detail_and_replay(self):
        self.client.force_login(self.admin)
        url = reverse("admin:members_emailoperation_change", args=[self.operation.pk])
        self.assertContains(self.client.get(url), "通过邮箱变更")
        self.assertEqual(self.client.post(url, {"_approve_email": "通过"}).status_code, 302)
        self.binding.refresh_from_db()
        self.owner.refresh_from_db()
        self.operation.refresh_from_db()
        self.assertEqual(self.binding.email, "new@example.test")
        self.assertEqual(self.owner.email, self.binding.email)
        self.assertEqual(self.operation.reviewed_by, self.admin)
        self.assertEqual(self.operation.status, EmailOperation.Status.COMPLETED)
        self.assertEqual(self.client.post(url, {"_approve_email": "通过"}).status_code, 302)
        self.assertEqual(AccountEmail.objects.filter(user=self.owner).count(), 1)

    def test_rejection_keeps_old_address(self):
        self.client.force_login(self.admin)
        url = reverse("admin:members_emailoperation_change", args=[self.operation.pk])
        self.assertEqual(self.client.post(url, {"_reject_email": "拒绝"}).status_code, 302)
        self.binding.refresh_from_db()
        self.operation.refresh_from_db()
        self.assertEqual(self.binding.email, "old@example.test")
        self.assertEqual(self.operation.status, EmailOperation.Status.REJECTED)

    def test_staff_without_review_permission_cannot_submit_forged_approval(self):
        self.staff.user_permissions.add(Permission.objects.get(codename="change_emailoperation"))
        self.client.force_login(self.staff)
        url = reverse("admin:members_emailoperation_change", args=[self.operation.pk])
        self.assertNotContains(self.client.get(url), "通过邮箱变更")
        self.assertEqual(self.client.post(url, {"_approve_email": "通过"}).status_code, 403)
        self.operation.refresh_from_db()
        self.assertEqual(self.operation.status, EmailOperation.Status.AWAITING_REVIEW)

    def test_admin_never_exposes_token_or_password_hash(self):
        self.operation.password_hash = "pbkdf2_sha256$test-only-secret"
        self.operation.token_digest = "d" * 64
        self.operation.save()
        self.client.force_login(self.admin)
        url = reverse("admin:members_emailoperation_change", args=[self.operation.pk])
        response = self.client.get(url)
        self.assertNotContains(response, self.operation.password_hash)
        self.assertNotContains(response, self.operation.token_digest)

    def test_email_binding_admin_has_no_write_path(self):
        self.client.force_login(self.admin)
        url = reverse("admin:members_accountemail_change", args=[self.binding.pk])
        self.assertContains(self.client.get(url), "old@example.test")
        self.assertEqual(self.client.post(url, {"email": "forged@example.test"}).status_code, 403)
