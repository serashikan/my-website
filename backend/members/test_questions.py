"""问答的隐私与审核边界；账号和数据只存在于临时测试数据库。"""
import json
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .forms import QuestionForm
from .models import Question


LIST_URL = "/api/questions/"


@override_settings(
    CACHES={"default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "test-only-private-questions",
    }},
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class QuestionTestCase(TestCase):
    password = "test-only-Question-Passphrase-852!"

    @classmethod
    def setUpTestData(cls):
        users = get_user_model()
        cls.owner = users.objects.create_user("question-test-owner", password=cls.password)
        cls.other = users.objects.create_user("question-test-other", password=cls.password)
        cls.staff = users.objects.create_user(
            "question-test-staff", password=cls.password, is_staff=True,
        )

    def setUp(self):
        cache.clear()
        self.client.force_login(self.owner)

    def tearDown(self):
        cache.clear()

    def detail_url(self, question):
        return f"{LIST_URL}{question.pk}/"

    def create_question(self, **changes):
        values = {
            "owner": self.owner,
            "title": "只有站主和我能看到的问题",
            "body": "这是一条测试问题。",
        }
        values.update(changes)
        return Question.objects.create(**values)

    def payload(self, **changes):
        return {"title": "一个问题", "body": "想向站主请教的内容。", **changes}

    def post_question(self, data=None, client=None, **extra):
        return (client or self.client).post(
            LIST_URL,
            data=json.dumps(self.payload() if data is None else data),
            content_type="application/json",
            **extra,
        )

    def grant(self, user, *codenames):
        for codename in codenames:
            user.user_permissions.add(Permission.objects.get(
                content_type__app_label="members", codename=codename,
            ))

    def assert_private_response(self, response):
        self.assertIn("private", response.headers.get("Cache-Control", ""))
        self.assertIn("no-store", response.headers.get("Cache-Control", ""))
        self.assertIn("Cookie", response.headers.get("Vary", ""))


class PrivateQuestionAccessTests(QuestionTestCase):
    def test_anonymous_requests_redirect_to_login_without_disclosing_data(self):
        question = self.create_question(body="test-only-private-question-content")
        self.client.logout()
        for path in (LIST_URL, self.detail_url(question)):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 302)
                self.assertTrue(response.url.startswith(reverse("login") + "?next="))
                self.assertNotContains(
                    response, "test-only-private-question-content", status_code=302,
                )
                self.assert_private_response(response)
        count = Question.objects.count()
        response = self.post_question()
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Question.objects.count(), count)

    def test_list_contains_only_current_owners_answered_and_unanswered_questions(self):
        own_unanswered = self.create_question()
        own_answered = self.create_question(answer="给你的回复", answered_at=timezone.now())
        self.create_question(owner=self.other, title="另一个人的私密问题")
        self.create_question(
            owner=self.other, title="另一个人的已回复问题", answer="也不能被别人看到",
            answered_at=timezone.now(),
        )
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 2)
        self.assertEqual({item["id"] for item in data["items"]}, {
            own_unanswered.pk, own_answered.pk,
        })
        self.assert_private_response(response)

    def test_other_users_cannot_read_questions_even_after_the_admin_replies(self):
        questions = [
            self.create_question(),
            self.create_question(answer="仍然是私密回复", answered_at=timezone.now()),
        ]
        self.client.force_login(self.other)
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"], [])
        self.assertEqual(response.json()["total"], 0)
        for question in questions:
            with self.subTest(answered=bool(question.answer)):
                response = self.client.get(self.detail_url(question))
                self.assertEqual(response.status_code, 404)
                self.assert_private_response(response)

    def test_question_owner_can_read_the_full_question_and_reply(self):
        question = self.create_question(answer="仅给提问人的回复", answered_at=timezone.now())
        response = self.client.get(self.detail_url(question))
        self.assertEqual(response.status_code, 200)
        item = response.json()["question"]
        self.assertEqual(item["id"], question.pk)
        self.assertEqual(item["title"], question.title)
        self.assertEqual(item["body"], question.body)
        self.assertEqual(item["answer"], question.answer)
        self.assertIsNotNone(item["created_at"])
        self.assertIsNotNone(item["answered_at"])
        for hidden in ("owner", "owner_id", "allow_public"):
            self.assertNotIn(hidden, item)
        self.assertEqual(item["visibility"], "private")
        self.assertFalse(item["is_public"])
        self.assertTrue(item["is_mine"])
        self.assert_private_response(response)

    def test_staff_needs_model_view_permission_and_permissions_do_not_make_a_user_staff(self):
        question = self.create_question()
        self.client.force_login(self.staff)
        self.assertEqual(self.client.get(self.detail_url(question)).status_code, 404)
        self.grant(self.staff, "view_question")
        self.client.force_login(self.staff)
        response = self.client.get(self.detail_url(question))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["question"]["id"], question.pk)

        self.grant(self.other, "view_question")
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.detail_url(question)).status_code, 404)

    def test_staff_list_also_contains_only_their_own_questions(self):
        self.create_question()
        staff_question = self.create_question(owner=self.staff)
        self.grant(self.staff, "view_question", "change_question")
        self.client.force_login(self.staff)
        response = self.client.get(LIST_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.json()["items"]], [staff_question.pk])

    def test_pagination_returns_twenty_items_without_duplicates_or_other_users_data(self):
        own_ids = {
            self.create_question(title=f"我的测试问题 {number}").pk
            for number in range(45)
        }
        for number in range(3):
            self.create_question(owner=self.other, title=f"别人的测试问题 {number}")
        collected = []
        for page, expected_count in ((1, 20), (2, 20), (3, 5)):
            with self.subTest(page=page):
                response = self.client.get(LIST_URL, {"page": page})
                self.assertEqual(response.status_code, 200)
                data = response.json()
                self.assertEqual(data["page"], page)
                self.assertEqual(data["pages"], 3)
                self.assertEqual(data["total"], 45)
                self.assertEqual(len(data["items"]), expected_count)
                self.assertEqual(data["has_next"], page < 3)
                self.assertEqual(data["has_previous"], page > 1)
                collected.extend(item["id"] for item in data["items"])
        self.assertEqual(len(collected), len(set(collected)))
        self.assertEqual(set(collected), own_ids)

    def test_invalid_page_numbers_return_a_private_validation_error(self):
        self.create_question()
        for page in ("0", "-1", "not-a-page", "1.5"):
            with self.subTest(page=page):
                response = self.client.get(LIST_URL, {"page": page})
                self.assertEqual(response.status_code, 400)
                self.assertTrue(response.json().get("error"))
                self.assert_private_response(response)


class PrivateQuestionSubmissionTests(QuestionTestCase):
    def test_form_exposes_only_question_content(self):
        self.assertEqual(set(QuestionForm().fields), {"title", "body", "visibility"})

    def test_creation_uses_logged_in_owner_and_ignores_privilege_or_publication_fields(self):
        response = self.post_question(self.payload(
            title="  想问的问题  ", body=" \n问题正文\n ",
            owner=self.other.pk, owner_id=self.other.pk,
            answer="伪造的管理员回复", answered_at="2000-01-01T00:00:00Z",
            allow_public=True, is_public=True, is_staff=True,
        ))
        self.assertEqual(response.status_code, 201)
        question = Question.objects.get()
        self.assertEqual(question.owner, self.owner)
        self.assertEqual(question.title, "想问的问题")
        self.assertEqual(question.body, "问题正文")
        self.assertEqual(question.answer, "")
        self.assertIsNone(question.answered_at)
        self.assertEqual(question.visibility, "private")
        self.assertFalse(question.is_public)
        item = response.json()["question"]
        self.assertEqual(item["id"], question.pk)
        self.assertEqual(item["answer"], "")
        self.assertIsNone(item["answered_at"])
        self.assertEqual(item["visibility"], "private")
        self.assertFalse(item["is_public"])
        self.assertTrue(item["is_mine"])
        for hidden in ("owner", "owner_id", "allow_public"):
            self.assertNotIn(hidden, item)
        self.assert_private_response(response)

        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.detail_url(question)).status_code, 404)
        self.assertEqual(self.client.get(LIST_URL).json()["items"], [])

    def test_csrf_is_required_and_a_valid_same_origin_token_allows_creation(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.owner)
        client.get(reverse("account"))
        token = client.cookies[settings.CSRF_COOKIE_NAME].value
        response = self.post_question(client=client)
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Question.objects.exists())

        response = self.post_question(
            client=client, HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://example.invalid",
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Question.objects.exists())

        response = self.post_question(client=client, HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Question.objects.get().owner, self.owner)

    def test_non_json_posts_are_rejected_without_creating_a_question(self):
        for content_type, body in (
            ("application/x-www-form-urlencoded", "title=abc&body=def"),
            ("text/plain", json.dumps(self.payload())),
        ):
            with self.subTest(content_type=content_type):
                response = self.client.post(LIST_URL, data=body, content_type=content_type)
                self.assertEqual(response.status_code, 415)
                self.assert_private_response(response)
        self.assertFalse(Question.objects.exists())

    def test_invalid_json_or_non_object_json_is_rejected(self):
        for body in ("{", "null", "[]", '"a string"', "123", "true"):
            with self.subTest(body=body):
                response = self.client.post(
                    LIST_URL, data=body, content_type="application/json",
                )
                self.assertEqual(response.status_code, 400)
                self.assertTrue(response.json().get("error") or response.json().get("errors"))
                self.assert_private_response(response)
        self.assertFalse(Question.objects.exists())

    def test_required_fields_and_length_limits_are_checked_after_trimming(self):
        invalid = [
            {}, {"title": "只有标题"}, {"body": "只有正文"},
            self.payload(title=" \n\t "), self.payload(body=" \n\t "),
            self.payload(title="题" * 121), self.payload(body="文" * 2001),
        ]
        for data in invalid:
            with self.subTest(data=data):
                response = self.post_question(data)
                self.assertEqual(response.status_code, 400)
                self.assertTrue(response.json().get("error") or response.json().get("errors"))
        self.assertFalse(Question.objects.exists())
        response = self.post_question(self.payload(
            title=" " + "题" * 120 + " ", body="\n" + "文" * 2000 + "\n",
        ))
        self.assertEqual(response.status_code, 201)
        question = Question.objects.get()
        self.assertEqual(len(question.title), 120)
        self.assertEqual(len(question.body), 2000)

    def test_title_and_body_must_be_strings_instead_of_coercing_json_values(self):
        for field in ("title", "body"):
            for value in (None, True, 12, ["text"], {"text": "value"}):
                with self.subTest(field=field, value=value):
                    response = self.post_question(self.payload(**{field: value}))
                    self.assertEqual(response.status_code, 400)
        self.assertFalse(Question.objects.exists())

    def test_visibility_choices_are_recorded_but_never_approve_a_new_question(self):
        for visibility in ("private", "anonymous", "named"):
            with self.subTest(visibility=visibility):
                response = self.post_question(self.payload(
                    visibility=visibility, is_public=True, answer="伪造的审核回复",
                ))
                self.assertEqual(response.status_code, 201)
                question = Question.objects.get(pk=response.json()["question"]["id"])
                self.assertEqual(question.visibility, visibility)
                self.assertFalse(question.is_public)
                self.assertEqual(question.answer, "")
                self.assertFalse(response.json()["question"]["is_public"])

    def test_visibility_must_be_a_known_string_when_supplied(self):
        for value in (None, True, 1, ["anonymous"], {"mode": "named"}, "public", ""):
            with self.subTest(value=value):
                response = self.post_question(self.payload(visibility=value))
                self.assertEqual(response.status_code, 400)
                self.assertTrue(response.json().get("error") or response.json().get("errors"))
        self.assertFalse(Question.objects.exists())

    def test_markup_and_sql_like_text_remain_plain_question_content(self):
        title = '<img src=x onerror="alert(1)">'
        body = "<script>alert('test-only')</script>\n'; DROP TABLE members_question; --"
        response = self.post_question(self.payload(title=title, body=body))
        self.assertEqual(response.status_code, 201)
        question = Question.objects.get()
        self.assertEqual(question.title, title)
        self.assertEqual(question.body, body)
        item = self.client.get(self.detail_url(question)).json()["question"]
        self.assertEqual(item["title"], title)
        self.assertEqual(item["body"], body)
        self.assertEqual(Question.objects.count(), 1)

    def test_clients_cannot_edit_or_delete_questions_through_the_read_only_detail_api(self):
        question = self.create_question()
        for method in ("post", "put", "patch", "delete"):
            with self.subTest(method=method):
                response = getattr(self.client, method)(
                    self.detail_url(question),
                    data=json.dumps({"body": "篡改正文", "answer": "伪造回复"}),
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 405)
        question.refresh_from_db()
        self.assertEqual(question.body, "这是一条测试问题。")
        self.assertEqual(question.answer, "")


class PrivateQuestionRateLimitTests(QuestionTestCase):
    def test_each_user_can_submit_ten_valid_questions_before_being_limited(self):
        for number in range(10):
            response = self.post_question(self.payload(title=f"有效问题 {number}"))
            self.assertEqual(response.status_code, 201)
        response = self.post_question()
        self.assertEqual(response.status_code, 429)
        self.assert_private_response(response)
        self.assertEqual(Question.objects.filter(owner=self.owner).count(), 10)
        self.assertEqual(self.client.get(LIST_URL).status_code, 200)

        self.client.force_login(self.other)
        response = self.post_question()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Question.objects.filter(owner=self.other).count(), 1)

    def test_invalid_submissions_do_not_spend_the_users_valid_submission_allowance(self):
        for _ in range(12):
            response = self.post_question(self.payload(body="   "))
            self.assertEqual(response.status_code, 400)
        self.assertFalse(Question.objects.exists())
        for _ in range(10):
            self.assertEqual(self.post_question().status_code, 201)
        self.assertEqual(self.post_question().status_code, 429)

    def test_changing_network_headers_or_forging_owner_does_not_reset_account_limit(self):
        for _ in range(10):
            self.assertEqual(self.post_question().status_code, 201)
        response = self.post_question(
            self.payload(owner=self.other.pk), REMOTE_ADDR="198.51.100.18",
            HTTP_CF_CONNECTING_IP="203.0.113.9", HTTP_X_FORWARDED_FOR="203.0.113.10",
        )
        self.assertEqual(response.status_code, 429)
        self.assertFalse(Question.objects.filter(owner=self.other).exists())

    def test_account_can_submit_again_after_the_one_hour_window_expires(self):
        with patch("django.core.cache.backends.locmem.time.time", return_value=1_000_000) as clock:
            for _ in range(10):
                self.assertEqual(self.post_question().status_code, 201)
            clock.return_value = 1_003_599
            self.assertEqual(self.post_question().status_code, 429)
            clock.return_value = 1_003_601
            self.assertEqual(self.post_question().status_code, 201)
        self.assertEqual(Question.objects.filter(owner=self.owner).count(), 11)


class QuestionPublicationRulesTests(QuestionTestCase):
    def test_unspecified_visibility_keeps_questions_private_and_unapproved(self):
        question = self.create_question()
        self.assertEqual(question.visibility, "private")
        self.assertFalse(question.is_public)
        question.full_clean()

    def test_model_rejects_publication_without_consent_and_a_nonblank_reply(self):
        for visibility, answer in (
            ("private", "站主已回复"), ("anonymous", ""), ("named", " \n\t "),
        ):
            with self.subTest(visibility=visibility, answer=answer):
                question = Question(
                    owner=self.owner, title="审核规则测试", body="不能直接公开的内容",
                    visibility=visibility, answer=answer, is_public=True,
                )
                with self.assertRaises(ValidationError):
                    question.full_clean()

    def test_model_accepts_an_approved_answer_for_either_consented_visibility(self):
        for visibility in ("anonymous", "named"):
            with self.subTest(visibility=visibility):
                question = Question(
                    owner=self.owner, title="允许展示的测试问题", body="同意对应展示方式",
                    visibility=visibility, answer="审核通过的回复", is_public=True,
                )
                question.full_clean()


class ReviewedQuestionAccessTests(QuestionTestCase):
    def test_public_scope_contains_only_approved_consented_questions_with_a_reply(self):
        public_questions = [
            self.create_question(visibility="anonymous", is_public=True, answer="匿名展示的回复"),
            self.create_question(visibility="named", is_public=True, answer="署名展示的回复"),
        ]
        self.create_question(visibility="anonymous", answer="尚未审核的回复")
        self.create_question(visibility="named", answer="")
        self.create_question(visibility="private", answer="保持私密的回复")
        # 模拟绕过表单校验的旧数据，读取接口仍必须守住展示条件。
        self.create_question(visibility="private", is_public=True, answer="不应公开")
        self.create_question(visibility="anonymous", is_public=True, answer="")
        self.create_question(visibility="named", is_public=True, answer=" \n\t ")
        self.client.force_login(self.other)
        response = self.client.get(LIST_URL, {"scope": "public"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 2)
        self.assertEqual({item["id"] for item in data["items"]}, {
            question.pk for question in public_questions
        })
        for item in data["items"]:
            self.assertTrue(item["is_public"])
            self.assertFalse(item["is_mine"])
        self.assert_private_response(response)

    def test_anonymous_public_list_and_detail_do_not_include_the_owners_identity(self):
        self.owner.first_name = "测试用保密昵称"
        self.owner.save(update_fields=["first_name"])
        question = self.create_question(
            visibility="anonymous", is_public=True, answer="站主同意展示的回答",
        )
        self.client.force_login(self.other)
        for path in (LIST_URL + "?scope=public", self.detail_url(question)):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                data = response.json()
                item = data["items"][0] if "items" in data else data["question"]
                self.assertEqual(item["author"], "匿名朋友")
                self.assertEqual(item["visibility"], "anonymous")
                self.assertFalse(item["is_mine"])
                for identity in (self.owner.username, self.owner.first_name):
                    self.assertNotIn(identity, json.dumps(data, ensure_ascii=False))
                for hidden in ("owner", "owner_id", "username", "email"):
                    self.assertNotIn(hidden, item)
                self.assert_private_response(response)

    def test_named_questions_display_short_name_or_username_as_consented(self):
        username_question = self.create_question(
            visibility="named", is_public=True, answer="第一条审核回复",
        )
        self.other.first_name = "测试展示昵称"
        self.other.save(update_fields=["first_name"])
        nickname_question = self.create_question(
            owner=self.other, visibility="named", is_public=True, answer="第二条审核回复",
        )
        self.client.force_login(self.staff)
        response = self.client.get(LIST_URL, {"scope": "public"})
        self.assertEqual(response.status_code, 200)
        authors = {item["id"]: item["author"] for item in response.json()["items"]}
        self.assertEqual(authors[username_question.pk], self.owner.username)
        self.assertEqual(authors[nickname_question.pk], "测试展示昵称")

    def test_unreviewed_questions_stay_private_even_when_the_submitter_consented(self):
        questions = [
            self.create_question(visibility="anonymous"),
            self.create_question(visibility="named", answer="回复了但未审核展示"),
        ]
        self.client.force_login(self.other)
        for question in questions:
            with self.subTest(visibility=question.visibility):
                response = self.client.get(self.detail_url(question))
                self.assertEqual(response.status_code, 404)
                self.assert_private_response(response)
        self.assertEqual(self.client.get(LIST_URL, {"scope": "public"}).json()["items"], [])

        self.client.force_login(self.owner)
        response = self.client.get(LIST_URL, {"scope": "mine"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual({item["id"] for item in response.json()["items"]}, {
            question.pk for question in questions
        })
        self.assertTrue(all(item["is_mine"] for item in response.json()["items"]))


class QuestionAdministrationTests(QuestionTestCase):
    def change_url(self, question):
        return reverse("admin:members_question_change", args=[question.pk])

    def login_editor(self):
        self.grant(self.staff, "view_question", "change_question")
        self.client.force_login(self.staff)

    def test_staff_without_model_permissions_cannot_open_or_submit_reply_form(self):
        question = self.create_question()
        self.client.force_login(self.staff)
        url = self.change_url(question)
        self.assertEqual(self.client.get(url).status_code, 403)
        self.assertEqual(self.client.post(url, {"answer": "未经授权的回复"}).status_code, 403)
        question.refresh_from_db()
        self.assertEqual(question.answer, "")
        self.assertIsNone(question.answered_at)

    def test_view_only_staff_can_inspect_but_cannot_change_a_reply(self):
        question = self.create_question()
        self.grant(self.staff, "view_question")
        self.client.force_login(self.staff)
        url = self.change_url(question)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.post(url, {"answer": "未经授权的回复"}).status_code, 403)
        question.refresh_from_db()
        self.assertEqual(question.answer, "")

    def test_admin_can_reply_but_cannot_tamper_with_ownership_or_original_question(self):
        question = self.create_question()
        self.login_editor()
        url = self.change_url(question)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        form = response.context["adminform"].form
        for immutable in ("owner", "title", "body", "visibility", "created_at", "updated_at", "answered_at"):
            self.assertNotIn(immutable, form.fields)
        self.assertIn("is_public", form.fields)

        before = timezone.now()
        response = self.client.post(url, {
            "answer": "  给提问人的回复  ", "_save": "保存",
            "owner": self.other.pk, "title": "篡改的标题", "body": "篡改的正文",
            "answered_at": "2000-01-01T00:00:00Z", "allow_public": "on", "visibility": "named",
        })
        self.assertEqual(response.status_code, 302)
        question.refresh_from_db()
        self.assertEqual(question.owner, self.owner)
        self.assertEqual(question.title, "只有站主和我能看到的问题")
        self.assertEqual(question.body, "这是一条测试问题。")
        self.assertEqual(question.visibility, "private")
        self.assertFalse(question.is_public)
        self.assertEqual(question.answer, "给提问人的回复")
        self.assertIsNotNone(question.answered_at)
        self.assertGreaterEqual(question.answered_at, before)
        self.assertLessEqual(question.answered_at, timezone.now())
        self.assert_private_response(response)

        self.client.force_login(self.owner)
        response = self.client.get(self.detail_url(question))
        self.assertEqual(response.json()["question"]["answer"], "给提问人的回复")
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.detail_url(question)).status_code, 404)

    def test_clearing_reply_clears_answered_timestamp(self):
        question = self.create_question(
            answer="之前的回复", answered_at=timezone.now() - timedelta(days=1),
        )
        self.login_editor()
        response = self.client.post(self.change_url(question), {"answer": " \n ", "_save": "保存"})
        self.assertEqual(response.status_code, 302)
        question.refresh_from_db()
        self.assertEqual(question.answer, "")
        self.assertIsNone(question.answered_at)

    def test_saving_unchanged_reply_preserves_timestamp_and_editing_reply_updates_it(self):
        previous_reply_time = timezone.now() - timedelta(days=1)
        question = self.create_question(answer="原来的回复", answered_at=previous_reply_time)
        self.login_editor()
        url = self.change_url(question)
        response = self.client.post(url, {"answer": "原来的回复", "_save": "保存"})
        self.assertEqual(response.status_code, 302)
        question.refresh_from_db()
        self.assertEqual(question.answered_at, previous_reply_time)

        before_edit = timezone.now()
        response = self.client.post(url, {"answer": "修改后的回复", "_save": "保存"})
        self.assertEqual(response.status_code, 302)
        question.refresh_from_db()
        self.assertEqual(question.answer, "修改后的回复")
        self.assertGreaterEqual(question.answered_at, before_edit)

    def test_reply_length_is_validated_before_modifying_stored_answer(self):
        question = self.create_question(answer="原来的回复", answered_at=timezone.now())
        original_answered_at = question.answered_at
        self.login_editor()
        response = self.client.post(self.change_url(question), {
            "answer": "答" * 5001, "_save": "保存",
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn("answer", response.context["adminform"].form.errors)
        question.refresh_from_db()
        self.assertEqual(question.answer, "原来的回复")
        self.assertEqual(question.answered_at, original_answered_at)

    def test_admin_cannot_create_questions_even_with_superuser_permissions(self):
        self.staff.is_superuser = True
        self.staff.save(update_fields=["is_superuser"])
        self.client.force_login(self.staff)
        url = reverse("admin:members_question_add")
        self.assertEqual(self.client.get(url).status_code, 403)
        self.assertEqual(self.client.post(url, {
            "owner": self.other.pk, "title": "代替别人发问", "body": "不应创建", "answer": "",
        }).status_code, 403)
        self.assertFalse(Question.objects.exists())


class ReviewedQuestionAdministrationTests(QuestionTestCase):
    def change_url(self, question):
        return reverse("admin:members_question_change", args=[question.pk])

    def login_editor(self):
        self.grant(self.staff, "view_question", "change_question")
        self.client.force_login(self.staff)

    def test_admin_reply_remains_private_until_explicitly_approved_for_display(self):
        question = self.create_question(visibility="anonymous")
        self.login_editor()
        url = self.change_url(question)
        response = self.client.post(url, {"answer": "准备好的回复", "_save": "保存"})
        self.assertEqual(response.status_code, 302)
        question.refresh_from_db()
        self.assertFalse(question.is_public)
        reply_time = question.answered_at
        self.assertIsNotNone(reply_time)

        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.detail_url(question)).status_code, 404)
        self.assertEqual(self.client.get(LIST_URL, {"scope": "public"}).json()["items"], [])

        self.client.force_login(self.staff)
        response = self.client.post(url, {
            "answer": "准备好的回复", "is_public": "on", "visibility": "named", "_save": "保存",
        })
        self.assertEqual(response.status_code, 302)
        question.refresh_from_db()
        self.assertTrue(question.is_public)
        self.assertEqual(question.visibility, "anonymous")
        self.assertEqual(question.answered_at, reply_time)

        self.client.force_login(self.other)
        response = self.client.get(self.detail_url(question))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["question"]["author"], "匿名朋友")
        response = self.client.get(LIST_URL, {"scope": "public"})
        self.assertEqual([item["id"] for item in response.json()["items"]], [question.pk])

    def test_admin_cannot_approve_private_or_unanswered_questions(self):
        self.login_editor()
        for visibility, submitted_reply in (
            ("private", "即使回复也不能覆盖用户的隐私选择"),
            ("anonymous", ""),
            ("named", " \n\t "),
        ):
            with self.subTest(visibility=visibility):
                question = self.create_question(visibility=visibility)
                response = self.client.post(self.change_url(question), {
                    "answer": submitted_reply, "is_public": "on",
                    "visibility": "named", "_save": "保存",
                })
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.context["adminform"].form.errors)
                question.refresh_from_db()
                self.assertFalse(question.is_public)
                self.assertEqual(question.visibility, visibility)
                self.assertEqual(question.answer, "")
                self.assertIsNone(question.answered_at)
        self.assertEqual(self.client.get(LIST_URL, {"scope": "public"}).json()["items"], [])

    def test_admin_can_withdraw_publication_without_losing_the_private_reply(self):
        reply_time = timezone.now() - timedelta(days=1)
        question = self.create_question(
            visibility="named", is_public=True, answer="撤回展示后仍保留给提问人的回复",
            answered_at=reply_time,
        )
        self.login_editor()
        response = self.client.post(self.change_url(question), {
            "answer": question.answer, "_save": "保存",
        })
        self.assertEqual(response.status_code, 302)
        question.refresh_from_db()
        self.assertFalse(question.is_public)
        self.assertEqual(question.answered_at, reply_time)

        self.client.force_login(self.other)
        self.assertEqual(self.client.get(self.detail_url(question)).status_code, 404)
        self.assertEqual(self.client.get(LIST_URL, {"scope": "public"}).json()["items"], [])
        self.client.force_login(self.owner)
        response = self.client.get(self.detail_url(question))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["question"]["answer"], question.answer)
