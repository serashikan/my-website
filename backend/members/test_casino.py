import copy
import json

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from .models import CasinoProgress


def snapshot():
    return {"challenge": {"id": "attempt-one", "status": "active", "chips": 85,
        "rounds": 2, "high": 110, "attempt": 1, "history": ["轮盘 -5"],
        "pending": {"id": "round-three", "game": "二十一点", "amount": 10}, "started": 1760000000000},
        "marbles": {"challengeId": "attempt-one", "inventory": 7, "queue": 3,
            "balls": [{"level": 2, "x": 180.5, "y": 40, "vx": -2.5, "vy": 6, "age": 0.2}],
            "launched": 10, "lost": 2, "wins": 0, "deepest": 3, "visits": [10, 3, 1, 0, 0, 0]},
        "vault": {"challengeId": "attempt-one", "safe": 2, "claims": 1, "net": -10, "last": [-25, 10, 5]}}


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class CasinoProgressTests(TestCase):
    def setUp(self):
        cache.clear()
        self.alice = get_user_model().objects.create_user("casino-alice", password="test-only-pass")
        self.bob = get_user_model().objects.create_user("casino-bob", password="test-only-pass")
        self.url = reverse("casino_progress")

    def save(self, revision=0, data=None, **extra):
        return self.client.post(self.url, json.dumps({"account_id": self.alice.pk,
            "revision": revision, "snapshot": data if data is not None else snapshot(), **extra}),
            content_type="application/json")

    def test_login_required_for_read_and_write(self):
        self.assertEqual(self.client.get(self.url).status_code, 302)
        self.assertEqual(self.save().status_code, 302)
        self.assertFalse(CasinoProgress.objects.exists())

    def test_first_read_is_empty_and_returns_actual_username(self):
        self.alice.first_name = "a display name"
        self.alice.save()
        self.client.force_login(self.alice)
        response = self.client.get(self.url)
        self.assertEqual(response.json()["username"], self.alice.username)
        self.assertEqual(response.json()["revision"], 0)
        self.assertIsNone(response.json()["snapshot"])
        self.assertFalse(CasinoProgress.objects.exists())
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_account_restores_all_three_parts_on_another_device(self):
        self.client.force_login(self.alice)
        self.assertEqual(self.save().json()["revision"], 1)
        other_device = Client()
        other_device.force_login(self.alice)
        response = other_device.get(self.url)
        self.assertEqual(response.json()["snapshot"], snapshot())
        self.assertEqual(response.json()["account_id"], self.alice.pk)
        self.assertIn("no-store", response.headers["Cache-Control"])

    def test_other_account_cannot_read_or_overwrite_progress(self):
        self.client.force_login(self.alice)
        self.save(owner=self.bob.pk)
        self.client.force_login(self.bob)
        self.assertIsNone(self.client.get(self.url, {"owner": self.alice.pk}).json()["snapshot"])
        self.assertEqual(self.save(revision=1).status_code, 403)
        self.assertEqual(CasinoProgress.objects.get(owner=self.alice).revision, 1)
        self.assertFalse(CasinoProgress.objects.filter(owner=self.bob).exists())

    def test_stale_device_and_simultaneous_first_save_do_not_overwrite(self):
        self.client.force_login(self.alice)
        self.assertEqual(self.save().status_code, 200)
        self.assertEqual(self.save().status_code, 409)
        changed = snapshot()
        changed["challenge"]["chips"] = 95
        self.assertEqual(self.save(revision=1, data=changed).status_code, 200)
        self.assertEqual(self.save(revision=1).status_code, 409)
        row = CasinoProgress.objects.get(owner=self.alice)
        self.assertEqual(row.revision, 2)
        self.assertEqual(row.snapshot["challenge"]["chips"], 95)

    def test_malformed_values_do_not_replace_the_existing_save(self):
        self.client.force_login(self.alice)
        self.save()
        for path, value in ((["challenge", "chips"], -1), (["challenge", "rounds"], True),
            (["marbles", "challengeId"], "someone-else"), (["marbles", "balls"], [{}] * 61),
            (["marbles", "balls", 0, "vx"], float("inf")), (["vault", "last"], ["<script>"]),
            (["challenge", "history"], ["x" * 201])):
            data = copy.deepcopy(snapshot())
            node = data
            for key in path[:-1]:
                node = node[key]
            node[path[-1]] = value
            with self.subTest(path=path):
                self.assertEqual(self.save(1, data).status_code, 400)
        self.assertEqual(CasinoProgress.objects.get(owner=self.alice).snapshot, snapshot())

    def test_oversized_and_non_json_requests_rejected(self):
        self.client.force_login(self.alice)
        self.assertEqual(self.client.post(self.url, {"snapshot": "wrong"}).status_code, 415)
        for body, status in (("[", 400), ('{"x":"' + 'a' * 66000 + '"}', 413)):
            self.assertEqual(self.client.post(self.url, body, content_type="application/json").status_code, status)
        self.assertFalse(CasinoProgress.objects.exists())

    def test_cookie_and_csrf_required(self):
        strict = Client(enforce_csrf_checks=True)
        strict.force_login(self.alice)
        data = {"account_id": self.alice.pk, "revision": 0, "snapshot": snapshot()}
        self.assertEqual(strict.post(self.url, data, content_type="application/json").status_code, 403)
        token = strict.get(self.url).json()["csrf_token"]
        response = strict.post(self.url, data, content_type="application/json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 200)

    def test_disabled_user_cannot_save(self):
        self.client.force_login(self.alice)
        get_user_model().objects.filter(pk=self.alice.pk).update(is_active=False)
        self.assertEqual(self.save().status_code, 302)
        self.assertFalse(CasinoProgress.objects.exists())
