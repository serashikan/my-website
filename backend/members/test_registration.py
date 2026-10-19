from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core import mail
from django.test import Client, TestCase
from django.urls import reverse

from .models import PrivateNote


class PublicRegistrationTests(TestCase):
    """所有账号仅存在于临时测试数据库，不创建真实的演示账号。"""

    password = "test-only-Registration-Passphrase-946!"

    @classmethod
    def setUpTestData(cls):
        cls.existing = get_user_model().objects.create_user(
            "existing-reader", password=cls.password,
        )
        PrivateNote.objects.create(owner=cls.existing, text="Existing readers private note")

    def registration_data(self, username="new-reader", **extra):
        return {
            "username": username,
            "password1": self.password,
            "password2": self.password,
            **extra,
        }

    def test_anonymous_can_reach_registration_and_find_it_from_login(self):
        response = self.client.get(reverse("login"))
        self.assertContains(response, f'href="{reverse("register")}"')
        self.assertContains(response, f'href="{reverse("password_reset")}"')
        response = self.client.get(reverse("register"))
        self.assertEqual(response.status_code, 200)
        for field in ("username", "password1", "password2"):
            self.assertContains(response, f'name="{field}"')
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_registration_requires_csrf_before_creating_an_account(self):
        client = Client(enforce_csrf_checks=True)
        client.get(reverse("register"))
        count = get_user_model().objects.count()
        response = client.post(reverse("register"), self.registration_data())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(get_user_model().objects.count(), count)
        self.assertNotIn("_auth_user_id", client.session)

    def test_valid_registration_hashes_password_and_logs_in_without_extra_privileges(self):
        group = Group.objects.create(name="test-only-privileged-group")
        permission = Permission.objects.get(
            content_type__app_label="auth", codename="change_user",
        )
        client = Client(enforce_csrf_checks=True)
        client.get(reverse("register"))
        response = client.post(reverse("register"), self.registration_data(
            csrfmiddlewaretoken=client.cookies["csrftoken"].value,
            is_staff="on", is_superuser="on", is_active="",
            groups=[group.pk], user_permissions=[permission.pk],
        ))
        self.assertRedirects(response, reverse("account"))
        user = get_user_model().objects.get(username="new-reader")
        self.assertTrue(user.check_password(self.password))
        self.assertNotEqual(user.password, self.password)
        self.assertTrue(user.is_active)
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertFalse(user.groups.exists())
        self.assertFalse(user.user_permissions.exists())
        self.assertEqual(client.session["_auth_user_id"], str(user.pk))
        self.assertTrue(client.cookies["sessionid"]["httponly"])
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_duplicate_usernames_are_rejected_including_case_variations(self):
        count = get_user_model().objects.count()
        for username in ("existing-reader", "EXISTING-READER"):
            with self.subTest(username=username):
                response = self.client.post(reverse("register"), self.registration_data(username))
                self.assertEqual(response.status_code, 200)
                self.assertIn("username", response.context["form"].errors)
                self.assertEqual(get_user_model().objects.count(), count)
                self.assertNotIn("_auth_user_id", self.client.session)

    def test_mismatched_and_weak_passwords_do_not_create_users(self):
        count = get_user_model().objects.count()
        for password1, password2 in (
            (self.password, "test-only-Different-Passphrase-847!"),
            ("tiny", "tiny"),
            ("123456789", "123456789"),
            ("password", "password"),
        ):
            with self.subTest(password1=password1, password2=password2):
                response = self.client.post(reverse("register"), self.registration_data(
                    password1=password1, password2=password2,
                ))
                self.assertEqual(response.status_code, 200)
                self.assertIn("password2", response.context["form"].errors)
                self.assertEqual(get_user_model().objects.count(), count)
                self.assertNotIn("_auth_user_id", self.client.session)

    def test_authenticated_users_cannot_create_another_account(self):
        self.client.force_login(self.existing)
        count = get_user_model().objects.count()
        self.assertRedirects(self.client.get(reverse("register")), reverse("account"))
        response = self.client.post(reverse("register"), self.registration_data())
        self.assertRedirects(response, reverse("account"))
        self.assertEqual(get_user_model().objects.count(), count)
        self.assertEqual(self.client.session["_auth_user_id"], str(self.existing.pk))

    def test_new_user_cannot_read_or_overwrite_existing_users_note(self):
        self.client.post(reverse("register"), self.registration_data())
        user = get_user_model().objects.get(username="new-reader")
        response = self.client.get(reverse("account"))
        self.assertNotContains(response, "Existing readers private note")
        response = self.client.post(reverse("account"), {
            "text": "New readers note", "owner": self.existing.pk,
        })
        self.assertRedirects(response, reverse("account"))
        self.assertEqual(PrivateNote.objects.get(owner=user).text, "New readers note")
        self.assertEqual(
            PrivateNote.objects.get(owner=self.existing).text,
            "Existing readers private note",
        )

    def test_registration_does_not_redirect_to_external_next(self):
        response = self.client.post(
            reverse("register") + "?next=https%3A%2F%2Fexample.com%2F",
            self.registration_data(next="https://example.com/"),
        )
        self.assertRedirects(response, reverse("account"))


class PasswordHelpTests(TestCase):
    def test_anonymous_password_help_only_shows_contact_instruction_and_login_link(self):
        response = self.client.get(reverse("password_reset"))
        self.assertContains(response, "请联系站主")
        self.assertContains(response, f'href="{reverse("login")}"')
        self.assertNotContains(response, 'type="email"')
        self.assertNotContains(response, 'type="password"')
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertEqual(len(mail.outbox), 0)

    def test_password_help_rejects_posts_and_never_sends_mail(self):
        response = self.client.post(reverse("password_reset"), {
            "email": "test-only@example.invalid",
        })
        self.assertEqual(response.status_code, 405)
        self.assertEqual(len(mail.outbox), 0)
