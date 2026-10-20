import shutil
import tempfile
from pathlib import Path

from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings

from django.core.management.base import CommandError

from .management.commands.build_site import ROOT_PAGES, copy_site, prepare_questions_page


class PrivateSiteTests(TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.site = self.temp / "site"
        self.site.mkdir()
        (self.temp / "static").mkdir()
        for name, content in {
            "index.html": b"private homepage", "站点内容.js": b"private article snapshot",
            "音乐.html": b"music page", "音频文件/movie.mp4": b"0123456789abcdef",
            "txt文件/article.pdf": b"%PDF-private", "图片/test.png": b"private image",
        }.items():
            path = self.site / name
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(content)
        self.override = override_settings(
            WHITENOISE_ROOT=self.site, PRIVATE_SITE_ROOT=self.site,
            STATIC_ROOT=self.temp / "static", WHITENOISE_AUTOREFRESH=False,
        )
        self.override.enable()
        self.user = get_user_model().objects.create_user("reader", password="test-only-Password-789!")

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.temp)

    def test_all_website_resources_require_session_including_ranges_and_head(self):
        for path in ["/", "/音乐.html", "/站点内容.js", "/音频文件/movie.mp4",
                     "/txt文件/article.pdf", "/图片/test.png", "/api/session/"]:
            for method in ["get", "head"]:
                response = getattr(self.client, method)(path, HTTP_RANGE="bytes=0-3")
                self.assertEqual(response.status_code, 302, (method, path))
                self.assertTrue(response.url.startswith("/accounts/login/"))
                self.assertIn("no-store", response.headers["Cache-Control"])

    def test_logged_in_video_range_and_no_shared_caching(self):
        self.client.force_login(self.user)
        response = self.client.get("/音频文件/movie.mp4", HTTP_RANGE="bytes=2-5")
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["Content-Range"], "bytes 2-5/16")
        self.assertEqual(b"".join(response.streaming_content), b"2345")
        self.assertIn("private", response.headers["Cache-Control"])
        self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)
        self.assertIn("Cookie", response.headers["Vary"])

    def test_static_pages_and_embedded_pdfs_only_allow_same_origin_frames(self):
        self.client.force_login(self.user)
        for path in ("/音乐.html", "/txt文件/article.pdf"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
            response.close()

    def test_logging_out_blocks_reusing_file_url_and_conditional_requests(self):
        self.client.force_login(self.user)
        response = self.client.get("/站点内容.js")
        self.assertEqual(response.status_code, 200)
        etag = response.headers["ETag"]
        response.close()
        self.client.post("/accounts/logout/")
        response = self.client.get("/站点内容.js", HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(response.status_code, 302)

    def test_single_byte_last_byte_head_and_unsatisfiable_ranges(self):
        self.client.force_login(self.user)
        for header, expected in [("bytes=0-0", b"0"), ("bytes=15-15", b"f"), ("bytes=-1", b"f")]:
            response = self.client.get("/音频文件/movie.mp4", HTTP_RANGE=header)
            self.assertEqual(response.status_code, 206)
            self.assertEqual(response.content, expected)
            self.assertEqual(response.headers["Content-Length"], "1")
        self.assertEqual(self.client.head("/音频文件/movie.mp4", HTTP_RANGE="bytes=0-0").status_code, 206)
        self.assertEqual(self.client.get("/音频文件/movie.mp4", HTTP_RANGE="bytes=99-100").status_code, 416)

    def test_unknown_paths_and_backend_files_are_not_served_to_members(self):
        self.client.force_login(self.user)
        for path in ["/.git/config", "/.local/db.sqlite3", "/config/settings.py", "/manage.py",
                     "/ai_workspace/account-lab/.local/secret.key", "/missing.pdf"]:
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_login_styles_and_health_are_public_and_session_info_is_private(self):
        self.assertEqual(self.client.get("/accounts/login/").status_code, 200)
        self.assertEqual(self.client.get("/health/").json(), {"status": "ok"})
        self.assertEqual(self.client.get("/api/session/").status_code, 302)
        self.client.force_login(self.user)
        data = self.client.get("/api/session/").json()
        self.assertEqual(data["username"], "reader")
        self.assertIn("csrf_token", data)


class SiteBuildTests(TestCase):
    question_html = '''<head></head><main><div id="prologue">keep the character introduction</div>
        <div id="qa" class="content"><section>GitHub-only intro
        <div class="giscus"></div></section><div id="qaList"></div></div></main>
        <script>
        // =====================
        // 问答区配置
        const QA_CONFIG = {repo: 'test/repo'};
        // 1. 获取菜单里的链接
        const keepMenuHandler = true;
        // =====================
        // 问答区
        // =====================
        function ensureQA() { fetch("https://giscus.app/client.js"); }
        </script>'''

    def test_mint_replaces_github_widget_without_changing_static_source(self):
        html = self.question_html
        with tempfile.TemporaryDirectory() as temp:
            source, target = Path(temp) / "source", Path(temp) / "target"
            source.mkdir()
            target.mkdir()
            (source / "塞拉.html").write_text(html)
            copy_site(source, target)
            built = (target / "塞拉.html").read_text()
            self.assertEqual((source / "塞拉.html").read_text(), html)
            self.assertIn("keep the character introduction", built)
            self.assertIn("keepMenuHandler", built)
            self.assertIn("提问与回答", built)
            self.assertIn("/static/members/questions.js", built)
            self.assertIn("/static/members/questions.css", built)
            self.assertNotIn("giscus", built)
            self.assertNotIn("GitHub-only", built)
            self.assertNotIn("QA_CONFIG", built)

    def test_changed_question_structure_fails_instead_of_silently_using_github(self):
        for html in ("<head></head><main>missing container</main>",
                     self.question_html.replace('id="qa"', "id='qa'"),
                     '<head></head><main><div id="qa" class="content">changed</div></main>'):
            with self.subTest(html=html[:60]), self.assertRaises(CommandError):
                prepare_questions_page(html)

    def test_only_frontend_files_copied_without_secrets_sources_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, target = root / "source", root / "target"
            source.mkdir()
            target.mkdir()
            files = {name: "<head></head><body>page</body>" for name in ROOT_PAGES}
            files["塞拉.html"] = self.question_html
            files.update({
                "站点内容.js": "snapshot", "miku/shime1.png": "sprite",
                "webmeji-main/config.js": "config", "lib/three.min.js": "three",
                "game-vault.js": "game", "音频文件/movie.mp4": "movie",
                "txt文件/article.md": "article", "txt文件/article.pdf": "pdf",
                ".git/config": "secret", "ai_workspace/draft.html": "draft",
                "backend/config/settings.py": "source", "txt文件/code.py": "source",
                "txt文件/article.log": "log", "txt文件/article.tex": "source",
                "图片/.DS_Store": "metadata", "floriography 2/.backup/old.js": "backup",
                "floriography 2/scripts/build.js": "tool", "floriography 2/data/flowers.js": "data",
            })
            for name, content in files.items():
                file = source / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(content)
            (source / "图片/leak.png").symlink_to(source / ".git/config")
            manifest = copy_site(source, target)
            for name in [".git/config", "ai_workspace/draft.html", "txt文件/code.py", "图片/leak.png",
                         "txt文件/article.tex", "txt文件/article.log", "floriography 2/scripts/build.js"]:
                self.assertNotIn(name, manifest)
            for name in ["miku/shime1.png", "game-vault.js", "lib/three.min.js", "音频文件/movie.mp4",
                         "txt文件/article.md", "floriography 2/data/flowers.js"]:
                self.assertIn(name, manifest)
            self.assertIn("/static/members/site-nav.js", (target / "主页.html").read_text())
            self.assertIn("/static/members/casino-account.js", (target / "技术.html").read_text())
            self.assertNotIn("casino-account.js", (source / "技术.html").read_text())
            self.assertNotIn("site-nav.js", (source / "主页.html").read_text())
