import hashlib
import re
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import Permission
from django.core import mail
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import IntegrityError, OperationalError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone

from .email_addresses import normalize_email
from .email_services import (
    EmailFlowError, MailDeliveryError, active_operation, cancel_operation,
    create_email_request, create_registration, mail_ready, review_change,
    send_verification, verify_token,
)
from .models import AccountEmail, EmailOperation


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    EMAIL_VERIFICATION_ENABLED=True, SITE_PUBLIC_URL="https://example.test",
    DEFAULT_FROM_EMAIL="owner@example.test", EMAIL_VERIFICATION_COOLDOWN=0,
    EMAIL_VERIFICATION_MAX_PER_HOUR=50,
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class EmailServiceTests(TestCase):
    password = "test-only-Email-Passphrase-792!"

    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.reader = User.objects.create_user("email-reader", password=cls.password)
        cls.other = User.objects.create_user("email-other", password=cls.password)
        cls.legacy = User.objects.create_user("legacy-reader", email="legacy@example.test", password=cls.password)
        AccountEmail.objects.create(user=cls.legacy, email=cls.legacy.email)
        cls.bound = User.objects.create_user("bound-reader", email="old@example.test", password=cls.password)
        AccountEmail.objects.create(user=cls.bound, email=cls.bound.email, verified_at=timezone.now())
        cls.admin = User.objects.create_superuser("email-admin", password=cls.password)
        cls.staff = User.objects.create_user("limited-staff", password=cls.password, is_staff=True)

    def setUp(self):
        cache.clear()
        mail.outbox.clear()

    def tearDown(self):
        cache.clear()

    def deliver(self, operation):
        send_verification(operation)
        return re.search(r"#token=([A-Za-z0-9_-]+)", mail.outbox[-1].body).group(1)

    def awaiting_change(self):
        operation = create_email_request(self.bound, "new@example.test")
        return verify_token(self.deliver(operation), self.password, self.bound)

    def test_normalization_validates_idna_and_does_not_merge_aliases(self):
        self.assertEqual(normalize_email(" Friend+tag@EXAMPLE.TEST "), "friend+tag@example.test")
        self.assertEqual(normalize_email("Friend@例子.测试"), "friend@xn--fsqu00a.xn--0zwm56d")
        self.assertNotEqual(normalize_email("first.last@example.test"), normalize_email("firstlast@example.test"))
        for value in (None, "not-an-email", "friend@", "friend@example.test\nCc: other@example.test"):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                normalize_email(value)

    def test_registration_keeps_only_password_hash_until_verified(self):
        operation = create_registration("new-reader", self.password, "NEW@example.test")
        self.assertFalse(get_user_model().objects.filter(username="new-reader").exists())
        self.assertEqual(operation.target_email, "new@example.test")
        self.assertTrue(check_password(self.password, operation.password_hash))
        self.assertNotEqual(operation.password_hash, self.password)
        self.assertEqual(operation.token_digest, "")
        self.assertIsNone(operation.sent_at)
        self.assertFalse(mail.outbox)

    def test_signup_verification_creates_one_normal_user_and_clears_secrets(self):
        operation = create_registration("new-reader", self.password, "new@example.test")
        token = self.deliver(operation)
        self.assertEqual(operation.token_digest, hashlib.sha256(token.encode()).hexdigest())
        self.assertNotIn(self.password, mail.outbox[-1].body)
        self.assertIn("https://example.test/accounts/email/verify/#token=", mail.outbox[-1].body)
        verified = verify_token(token, self.password)
        user = verified.user
        self.assertEqual(verified.status, EmailOperation.Status.COMPLETED)
        self.assertTrue(user.check_password(self.password))
        self.assertTrue(user.is_active)
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertEqual(user.email, "new@example.test")
        self.assertEqual(user.account_email.email, user.email)
        self.assertIsNotNone(user.account_email.verified_at)
        self.assertEqual(verified.password_hash, "")
        self.assertEqual(verified.token_digest, "")
        with self.assertRaises(EmailFlowError):
            verify_token(token, self.password)

    def test_wrong_password_or_different_logged_in_actor_cannot_verify(self):
        operation = create_registration("new-reader", self.password, "new@example.test")
        token = self.deliver(operation)
        for password, actor in (("wrong", None), (self.password, self.other)):
            with self.subTest(actor=actor), self.assertRaises(EmailFlowError):
                verify_token(token, password, actor)
        operation.refresh_from_db()
        self.assertEqual(operation.status, EmailOperation.Status.PENDING)
        self.assertFalse(get_user_model().objects.filter(username="new-reader").exists())

    def test_first_email_is_bound_directly_after_token_and_password_verification(self):
        operation = create_email_request(self.reader, "first@example.test")
        self.assertEqual(operation.kind, EmailOperation.Kind.FIRST_EMAIL)
        verified = verify_token(self.deliver(operation), self.password, self.reader)
        self.reader.refresh_from_db()
        self.assertEqual(verified.status, EmailOperation.Status.COMPLETED)
        self.assertEqual(self.reader.email, "first@example.test")
        self.assertEqual(self.reader.account_email.email, self.reader.email)
        self.assertIsNotNone(self.reader.account_email.verified_at)

    def test_legacy_address_can_be_verified_without_admin_approval(self):
        operation = create_email_request(self.legacy, "LEGACY@example.test")
        self.assertEqual(operation.kind, EmailOperation.Kind.VERIFY_EMAIL)
        verified = verify_token(self.deliver(operation), self.password, self.legacy)
        self.assertEqual(verified.status, EmailOperation.Status.COMPLETED)
        self.assertIsNotNone(AccountEmail.objects.get(user=self.legacy).verified_at)

    def test_existing_email_stays_unchanged_until_approved(self):
        operation = self.awaiting_change()
        self.assertEqual(operation.status, EmailOperation.Status.AWAITING_REVIEW)
        self.assertGreater(operation.expires_at, timezone.now() + timedelta(days=6))
        self.bound.refresh_from_db()
        self.assertEqual(self.bound.email, "old@example.test")
        approved = review_change(operation, self.admin, True)
        self.bound.refresh_from_db()
        self.assertEqual(approved.status, EmailOperation.Status.COMPLETED)
        self.assertEqual(approved.reviewed_by_id, self.admin.pk)
        self.assertEqual(self.bound.email, "new@example.test")
        self.assertEqual(AccountEmail.objects.get(user=self.bound).email, self.bound.email)
        with self.assertRaises(EmailFlowError):
            review_change(operation, self.admin, True)

    def test_review_needs_active_staff_and_explicit_permission(self):
        operation = self.awaiting_change()
        for reviewer in (self.reader, self.staff):
            with self.subTest(reviewer=reviewer), self.assertRaises(EmailFlowError):
                review_change(operation, reviewer, True)
        permission = Permission.objects.get(content_type__app_label="members", codename="approve_email_change")
        self.staff.user_permissions.add(permission)
        self.staff.is_active = False
        self.staff.save(update_fields=["is_active"])
        with self.assertRaises(EmailFlowError):
            review_change(operation, self.staff, True)
        self.staff.is_active = True
        self.staff.save(update_fields=["is_active"])
        self.assertEqual(review_change(operation, self.staff, True).status, EmailOperation.Status.COMPLETED)

    def test_rejection_releases_request_without_changing_old_email_even_if_user_disabled(self):
        operation = self.awaiting_change()
        self.bound.is_active = False
        self.bound.save(update_fields=["is_active"])
        rejected = review_change(operation, self.admin, False)
        self.bound.refresh_from_db()
        self.assertEqual(rejected.status, EmailOperation.Status.REJECTED)
        self.assertEqual(self.bound.email, "old@example.test")
        self.assertEqual(rejected.password_hash, "")
        self.assertEqual(rejected.token_digest, "")

    def test_old_email_snapshot_and_inactive_user_block_approval(self):
        operation = self.awaiting_change()
        get_user_model().objects.filter(pk=self.bound.pk).update(email="changed-elsewhere@example.test")
        with self.assertRaises(EmailFlowError):
            review_change(operation, self.admin, True)
        get_user_model().objects.filter(pk=self.bound.pk).update(email="old@example.test", is_active=False)
        with self.assertRaises(EmailFlowError):
            review_change(operation, self.admin, True)
        self.assertEqual(AccountEmail.objects.get(user=self.bound).email, "old@example.test")

    def test_new_request_requires_explicit_cancel_and_old_token_then_fails(self):
        operation = create_email_request(self.reader, "first@example.test")
        token = self.deliver(operation)
        with self.assertRaises(EmailFlowError):
            create_email_request(self.reader, "second@example.test")
        with self.assertRaises(EmailFlowError):
            cancel_operation(operation, self.other)
        cancelled = cancel_operation(operation, self.reader)
        self.assertEqual(cancelled.status, EmailOperation.Status.CANCELLED)
        self.assertEqual(cancelled.token_digest, "")
        with self.assertRaises(EmailFlowError):
            verify_token(token, self.password, self.reader)
        self.assertEqual(create_email_request(self.reader, "second@example.test").target_email, "second@example.test")

    def test_resend_rotates_token_and_invalidates_old_link(self):
        operation = create_email_request(self.reader, "first@example.test")
        old_token = self.deliver(operation)
        new_token = self.deliver(operation)
        self.assertNotEqual(old_token, new_token)
        with self.assertRaises(EmailFlowError):
            verify_token(old_token, self.password, self.reader)
        self.assertEqual(verify_token(new_token, self.password, self.reader).status, EmailOperation.Status.COMPLETED)

    def test_failed_delivery_preserves_request_but_invalidates_old_and_attempted_tokens(self):
        operation = create_registration("new-reader", self.password, "new@example.test")
        old_token = self.deliver(operation)
        failed_token = "test-only-failed-token-" + "A" * 32
        with patch("members.email_services.secrets.token_urlsafe", return_value=failed_token), \
             patch("members.email_services.send_mail", side_effect=OSError("test mail failure")):
            with self.assertRaises(MailDeliveryError):
                send_verification(operation)
        operation.refresh_from_db()
        self.assertEqual(operation.status, EmailOperation.Status.PENDING)
        self.assertTrue(operation.password_hash)
        self.assertEqual(operation.token_digest, "")
        self.assertIsNone(operation.sent_at)
        for token in (old_token, failed_token):
            with self.assertRaises(EmailFlowError):
                verify_token(token, self.password)
        verified = verify_token(self.deliver(operation), self.password)
        self.assertEqual(verified.status, EmailOperation.Status.COMPLETED)

    def test_expiry_clears_secrets_and_releases_pending_registration_reservations(self):
        operation = create_registration("new-reader", self.password, "new@example.test")
        token = self.deliver(operation)
        EmailOperation.objects.filter(pk=operation.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        with self.assertRaises(EmailFlowError):
            verify_token(token, self.password)
        operation.refresh_from_db()
        self.assertEqual(operation.status, EmailOperation.Status.EXPIRED)
        self.assertEqual(operation.password_hash, "")
        self.assertEqual(operation.token_digest, "")
        replacement = create_registration("NEW-READER", self.password, "NEW@example.test")
        self.assertNotEqual(replacement.pk, operation.pk)

    def test_expired_review_cannot_be_approved_or_replayed(self):
        operation = self.awaiting_change()
        EmailOperation.objects.filter(pk=operation.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertIsNone(active_operation(self.bound))
        with self.assertRaises(EmailFlowError):
            review_change(operation, self.admin, True)
        self.assertEqual(AccountEmail.objects.get(user=self.bound).email, "old@example.test")

    def test_one_email_and_pending_username_are_case_insensitively_reserved(self):
        create_registration("new-reader", self.password, "new@example.test")
        for username, email in (("NEW-READER", "second@example.test"), ("second-reader", "NEW@example.test"),
                                ("third-reader", "OLD@example.test")):
            with self.subTest(username=username), self.assertRaises(EmailFlowError):
                create_registration(username, self.password, email)
        with self.assertRaises(EmailFlowError):
            create_registration("EMAIL-READER", self.password, "unused@example.test")

    def test_database_constraints_also_reject_bypassing_normalization(self):
        AccountEmail.objects.create(user=self.reader, email="first@example.test")
        AccountEmail.objects.create(user=self.other, email="second@example.test")
        with self.assertRaises(IntegrityError), transaction.atomic():
            AccountEmail.objects.filter(user=self.other).update(email="FIRST@EXAMPLE.TEST")
        operation = create_registration("new-reader", self.password, "new@example.test")
        with self.assertRaises(IntegrityError), transaction.atomic():
            EmailOperation.objects.create(kind=EmailOperation.Kind.FIRST_EMAIL, user=self.reader,
                target_email="NEW@EXAMPLE.TEST", expires_at=operation.expires_at)
        with self.assertRaises(IntegrityError), transaction.atomic():
            EmailOperation.objects.create(kind=EmailOperation.Kind.REGISTRATION, username="other-name",
                username_key=operation.username_key, target_email="other@example.test", expires_at=operation.expires_at)

    @override_settings(EMAIL_VERIFICATION_COOLDOWN=60)
    def test_send_cooldown_and_hourly_limit_do_not_make_extra_mail(self):
        operation = create_email_request(self.reader, "first@example.test")
        self.deliver(operation)
        with self.assertRaises(EmailFlowError):
            send_verification(operation)
        self.assertEqual(len(mail.outbox), 1)
        cache.clear()
        with override_settings(EMAIL_VERIFICATION_COOLDOWN=0, EMAIL_VERIFICATION_MAX_PER_HOUR=1):
            self.deliver(operation)
            with self.assertRaises(EmailFlowError):
                send_verification(operation)
        self.assertEqual(len(mail.outbox), 2)

    def test_password_changed_between_check_and_commit_cannot_authorize_binding(self):
        operation = create_email_request(self.reader, "first@example.test")
        token = self.deliver(operation)
        User = get_user_model()
        original = User.check_password
        def change_after_check(account, password):
            accepted = original(account, password)
            User.objects.filter(pk=account.pk).update(password=make_password("test-only-New-Password-492!"))
            return accepted
        with patch.object(User, "check_password", autospec=True, side_effect=change_after_check):
            with self.assertRaises(EmailFlowError):
                verify_token(token, self.password, self.reader)
        self.assertFalse(AccountEmail.objects.filter(user=self.reader).exists())
        operation.refresh_from_db()
        self.assertEqual(operation.status, EmailOperation.Status.PENDING)

    def test_database_busy_errors_become_flow_errors_instead_of_raw_failures(self):
        operation = create_email_request(self.reader, "first@example.test")
        with patch("members.email_services.EmailOperation.objects.get", side_effect=OperationalError("locked")):
            with self.assertRaises(EmailFlowError):
                send_verification(operation)
            with self.assertRaises(EmailFlowError):
                cancel_operation(operation, self.reader)

    def test_mail_readiness_never_accepts_console_or_incomplete_production_smtp(self):
        self.assertTrue(mail_ready())
        for value in ("", "http://example.test", "https://example.test/path", "https://name:pass@example.test"):
            with self.subTest(url=value), override_settings(SITE_PUBLIC_URL=value):
                self.assertFalse(mail_ready())
        with override_settings(EMAIL_VERIFICATION_ENABLED=False):
            self.assertFalse(mail_ready())
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend"):
            self.assertFalse(mail_ready())
        smtp = dict(EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend", EMAIL_HOST="smtp.example.test",
                    EMAIL_PORT=465, EMAIL_HOST_USER="owner@example.test", EMAIL_HOST_PASSWORD="test-only-secret",
                    EMAIL_USE_SSL=True, EMAIL_USE_TLS=False, EMAIL_TIMEOUT=10)
        with override_settings(**smtp):
            self.assertTrue(mail_ready())
            with override_settings(EMAIL_HOST_PASSWORD=""):
                self.assertFalse(mail_ready())
