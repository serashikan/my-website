from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse
from .models import PrivateNote


class AccountFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        # 仅测试数据库中的临时账号，不会创建真实可登录的演示用户。
        cls.password = "a-test-only-Passphrase-486!"
        cls.alice = get_user_model().objects.create_user("alice", password=cls.password)
        cls.bob = get_user_model().objects.create_user("bob", password=cls.password)

    def test_anonymous_cannot_read_or_write_private_note(self):
        for response in (self.client.get(reverse("account")),
                         self.client.post(reverse("account"), {"text": "unauthorized"})):
            self.assertEqual(response.status_code, 302)
            self.assertTrue(response.url.startswith(reverse("login")))
        self.assertFalse(PrivateNote.objects.exists())

    def test_login_rejects_wrong_password_and_disabled_account(self):
        response = self.client.post(reverse("login"), {"username": "alice", "password": "wrong"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("_auth_user_id", self.client.session)
        self.alice.is_active = False
        self.alice.save()
        self.assertFalse(self.client.login(username="alice", password=self.password))

    def test_each_user_can_only_edit_their_own_note_and_html_is_escaped(self):
        PrivateNote.objects.create(owner=self.bob, text="Bobs private text")
        self.client.force_login(self.alice)
        self.client.post(reverse("account"), {
            "text": "<script>alert(1)</script>", "owner": self.bob.pk,
        })
        self.assertEqual(PrivateNote.objects.get(owner=self.bob).text, "Bobs private text")
        self.assertEqual(PrivateNote.objects.get(owner=self.alice).text, "<script>alert(1)</script>")
        response = self.client.get(reverse("account"))
        self.assertNotContains(response, "Bobs private text")
        self.assertContains(response, "&lt;script&gt;alert(1)&lt;/script&gt;")
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_csrf_required_for_login_note_and_logout(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.post(reverse("login"), {
            "username": "alice", "password": self.password,
        }).status_code, 403)
        client.force_login(self.alice)
        self.assertEqual(client.post(reverse("account"), {"text": "oops"}).status_code, 403)
        self.assertEqual(client.post(reverse("logout")).status_code, 403)
        self.assertEqual(client.get(reverse("logout")).status_code, 405)

    def test_login_and_logout_full_flow(self):
        client = Client(enforce_csrf_checks=True)
        client.get(reverse("login"))
        response = client.post(reverse("login"), {
            "username": "alice", "password": self.password,
            "csrfmiddlewaretoken": client.cookies["csrftoken"].value,
        })
        self.assertRedirects(response, reverse("account"))
        self.assertTrue(client.cookies["sessionid"]["httponly"])
        client.get(reverse("account"))
        client.post(reverse("logout"), {
            "csrfmiddlewaretoken": client.cookies["csrftoken"].value,
        })
        self.assertNotIn("_auth_user_id", client.session)
        self.assertEqual(client.get(reverse("account")).status_code, 302)

    def test_password_change_preserves_current_session_and_ends_other_session(self):
        self.client.login(username="alice", password=self.password)
        other = Client()
        other.login(username="alice", password=self.password)
        new_password = "a-new-test-only-Passphrase-982!"
        response = self.client.post(reverse("password_change"), {
            "old_password": self.password,
            "new_password1": new_password, "new_password2": new_password,
        })
        self.assertRedirects(response, reverse("password_change_done"))
        self.assertEqual(self.client.get(reverse("account")).status_code, 200)
        self.assertEqual(other.get(reverse("account")).status_code, 302)
        self.alice.refresh_from_db()
        self.assertTrue(self.alice.check_password(new_password))
        self.assertNotEqual(self.alice.password, new_password)

    def test_login_cannot_redirect_to_external_website(self):
        response = self.client.post(reverse("login"), {
            "username": "alice", "password": self.password, "next": "https://example.com/",
        })
        self.assertRedirects(response, reverse("account"))

    def test_note_length_is_checked_by_server(self):
        self.client.force_login(self.alice)
        response = self.client.post(reverse("account"), {"text": "x" * 1001})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(PrivateNote.objects.filter(owner=self.alice).exists())
