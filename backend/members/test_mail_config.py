"""邮件配置工具的离线验证；只使用临时文件、测试数据库和 SMTP mock。"""
import importlib.util
import io
import os
import smtplib
import ssl
import stat
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.mail import get_connection
from django.test import SimpleTestCase, TestCase, override_settings

from config import settings as configuration


PROJECT_DIR = Path(__file__).resolve().parents[1]
tool_spec = importlib.util.spec_from_file_location(
    "test_only_configure_mail", PROJECT_DIR / "deploy" / "configure_mail.py",
)
mail_setup = importlib.util.module_from_spec(tool_spec)
tool_spec.loader.exec_module(mail_setup)


class TerminalBuffer(io.StringIO):
    def isatty(self):
        return True


class MailSettingsTests(SimpleTestCase):
    def load_settings(self, **environment):
        spec = importlib.util.spec_from_file_location(
            "config._test_only_mail_settings", PROJECT_DIR / "config" / "settings.py",
        )
        module = importlib.util.module_from_spec(spec)
        # 使用测试密钥，并显式关闭 origin 回退，不读取已有密钥或环境文件。
        with patch.dict(os.environ, {
            "DJANGO_SECRET_KEY": "test-only-mail-settings-secret",
            "DJANGO_SITE_URL": "",
            **environment,
        }, clear=True):
            spec.loader.exec_module(module)
        return module

    def test_unconfigured_mail_defaults_to_ssl_smtp_but_verification_is_disabled(self):
        settings = self.load_settings()
        self.assertEqual(settings.EMAIL_BACKEND, "django.core.mail.backends.smtp.EmailBackend")
        self.assertEqual(settings.EMAIL_HOST, "smtp.126.com")
        self.assertEqual(settings.EMAIL_PORT, 465)
        self.assertTrue(settings.EMAIL_USE_SSL)
        self.assertFalse(settings.EMAIL_USE_TLS)
        self.assertEqual(settings.EMAIL_TIMEOUT, 10)
        self.assertEqual(settings.EMAIL_HOST_USER, "")
        self.assertEqual(settings.EMAIL_HOST_PASSWORD, "")
        self.assertFalse(settings.EMAIL_VERIFICATION_ENABLED)
        self.assertEqual(settings.SITE_PUBLIC_URL, "")

    def test_env_contract_loads_credentials_and_trusted_site_url(self):
        settings = self.load_settings(
            DJANGO_EMAIL_HOST="smtp.126.com", DJANGO_EMAIL_PORT="465",
            DJANGO_EMAIL_USER="test-only-admin@126.com",
            DJANGO_EMAIL_PASSWORD="test-only-authorization",
            DJANGO_EMAIL_USE_SSL="1", DJANGO_EMAIL_VERIFICATION_ENABLED="1",
            DEFAULT_FROM_EMAIL="test-only-admin@126.com",
            DJANGO_SITE_URL="https://example.com/",
        )
        self.assertEqual(settings.EMAIL_HOST_USER, "test-only-admin@126.com")
        self.assertEqual(settings.EMAIL_HOST_PASSWORD, "test-only-authorization")
        self.assertEqual(settings.DEFAULT_FROM_EMAIL, settings.EMAIL_HOST_USER)
        self.assertTrue(settings.EMAIL_VERIFICATION_ENABLED)
        self.assertEqual(settings.SITE_PUBLIC_URL, "https://example.com")

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_django_test_backend_can_be_overridden_without_connecting_to_smtp(self):
        with patch.object(smtplib, "SMTP_SSL") as smtp:
            connection = get_connection()
        self.assertEqual(connection.__class__.__module__, "django.core.mail.backends.locmem")
        smtp.assert_not_called()

    def test_explicit_origin_must_be_a_public_https_origin_without_userinfo_or_path(self):
        invalid = (
            "", "http://example.com", "https://localhost", "https://sub.localhost",
            "https://127.0.0.1", "https://127.1", "https://[::1]", "https://mint.local",
            "https://user:password@example.com", "https://example.com/path",
            "https://example.com?next=attacker", "https://example.com#fragment",
            "https://example.com:8000", "https://*.example.com", " https://example.com",
            "https://example.com\n", "https://example.com\\@localhost",
        )
        for origin in invalid:
            with self.subTest(origin=origin):
                self.assertEqual(configuration._trusted_https_origin(origin), "")
                self.assertEqual(mail_setup.configured_origin({"DJANGO_SITE_URL": origin}), "")
        self.assertEqual(configuration._trusted_https_origin("https://example.com:443/"), "https://example.com")
        self.assertEqual(mail_setup.configured_origin({"DJANGO_SITE_URL": "https://example.com:443/"}), "https://example.com")

    def test_public_env_only_accepts_one_exact_quick_tunnel_host_and_tracks_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public.env"
            for host in (
                "test-only-first.trycloudflare.com", "test-only-next.trycloudflare.com",
            ):
                path.write_text(f'DJANGO_PUBLIC_HOST="{host}"\n', encoding="utf-8")
                self.assertEqual(
                    configuration._site_origin_from_configuration({}, directory), f"https://{host}",
                )
                self.assertEqual(mail_setup.configured_origin({}, directory), f"https://{host}")
            for line in (
                "DJANGO_PUBLIC_HOST=*.trycloudflare.com\n",
                "DJANGO_PUBLIC_HOST=test.trycloudflare.com.evil.example\n",
                "DJANGO_PUBLIC_HOST=https://test.trycloudflare.com\n",
                "DJANGO_PUBLIC_HOST=$(touch should-never-run)\n",
                "DJANGO_PUBLIC_HOST=a.trycloudflare.com\nDJANGO_PUBLIC_HOST=b.trycloudflare.com\n",
                "DJANGO_PUBLIC_HOST=test.trycloudflare.com\n" + "x" * 16384,
            ):
                path.write_text(line, encoding="utf-8")
                self.assertEqual(configuration._site_origin_from_configuration({}, directory), "")
                self.assertEqual(mail_setup.configured_origin({}, directory), "")

    def test_invalid_explicit_origin_does_not_fall_back_to_another_host(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "public.env").write_text(
                "DJANGO_PUBLIC_HOST=test-only-fallback.trycloudflare.com\n", encoding="utf-8",
            )
            environment = {"DJANGO_SITE_URL": "http://localhost"}
            self.assertEqual(configuration._site_origin_from_configuration(environment, directory), "")
            self.assertEqual(mail_setup.configured_origin(environment, directory), "")


class MailBootstrapTests(SimpleTestCase):
    def run_tool(self, *, code="test-only-client-code", smtp_error=None, argv=None, origin="https://example.com"):
        output, errors = TerminalBuffer(), TerminalBuffer()
        with patch.object(mail_setup.sys, "stdin", TerminalBuffer()), \
                patch.object(mail_setup.sys, "stdout", output), \
                patch.object(mail_setup.sys, "stderr", errors), \
                patch("django.setup"), \
                patch.object(mail_setup, "configured_origin", return_value=origin), \
                patch.object(mail_setup, "administrator_emails", return_value=["test-only-admin@126.com"]), \
                patch.object(mail_setup.getpass, "getpass", return_value=code) as prompt, \
                patch.object(mail_setup, "verify_login", side_effect=smtp_error) as verify, \
                patch.object(mail_setup, "write_mail_environment") as write, \
                patch.object(mail_setup, "restart_running_web_services", return_value=True) as restart:
            original_path = list(mail_setup.sys.path)
            try:
                status = mail_setup.main([] if argv is None else argv)
            finally:
                mail_setup.sys.path[:] = original_path
        return SimpleNamespace(
            status=status, output=output.getvalue() + errors.getvalue(),
            prompt=prompt, verify=verify, write=write, restart=restart,
        )

    def test_success_verifies_login_before_writing_and_does_not_echo_authorization_code(self):
        result = self.run_tool()
        self.assertEqual(result.status, 0)
        result.prompt.assert_called_once()
        result.verify.assert_called_once_with("test-only-admin@126.com", "test-only-client-code")
        result.write.assert_called_once_with("test-only-admin@126.com", "test-only-client-code")
        result.restart.assert_not_called()
        self.assertNotIn("test-only-client-code", result.output)
        self.assertIn("未发送测试邮件", result.output)

    def test_authentication_failure_never_overwrites_configuration_or_logs_server_error(self):
        code = "test-only-secret-must-not-appear"
        result = self.run_tool(code=code, smtp_error=smtplib.SMTPAuthenticationError(535, code.encode()))
        self.assertEqual(result.status, 1)
        result.write.assert_not_called()
        result.restart.assert_not_called()
        self.assertNotIn(code, result.output)
        self.assertNotIn("Traceback", result.output)

    def test_missing_trusted_origin_stops_before_asking_for_a_secret_or_connecting(self):
        result = self.run_tool(origin="")
        self.assertEqual(result.status, 1)
        result.prompt.assert_not_called()
        result.verify.assert_not_called()
        result.write.assert_not_called()

    def test_empty_or_multiline_secret_cannot_reach_smtp_or_environment_file(self):
        for code in ("", "test-only\nINJECTED=value", "test-only\x00value"):
            with self.subTest(code=code):
                result = self.run_tool(code=code)
                self.assertEqual(result.status, 1)
                result.verify.assert_not_called()
                result.write.assert_not_called()

    def test_non_tty_and_secret_command_arguments_are_refused_before_setup(self):
        with patch.object(mail_setup.sys, "stdin", io.StringIO()), \
                patch.object(mail_setup.sys, "stderr", io.StringIO()), \
                patch("django.setup") as setup, \
                patch.object(mail_setup.getpass, "getpass") as prompt:
            self.assertEqual(mail_setup.main([]), 1)
            self.assertEqual(mail_setup.main(["--password=test-only-never-echo"]), 2)
            self.assertNotIn("test-only-never-echo", mail_setup.sys.stderr.getvalue())
        setup.assert_not_called()
        prompt.assert_not_called()

    def test_smtp_login_uses_certificate_validation_and_never_sends_a_message(self):
        with patch.object(mail_setup.smtplib, "SMTP_SSL") as factory:
            mail_setup.verify_login("test-only-admin@126.com", "test-only-code")
        arguments = factory.call_args
        self.assertEqual(arguments.args, ("smtp.126.com", 465))
        self.assertEqual(arguments.kwargs["timeout"], 10)
        context = arguments.kwargs["context"]
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        smtp = factory.return_value.__enter__.return_value
        smtp.set_debuglevel.assert_called_once_with(0)
        smtp.login.assert_called_once_with("test-only-admin@126.com", "test-only-code")
        smtp.sendmail.assert_not_called()
        smtp.send_message.assert_not_called()

    def test_environment_file_is_atomic_private_and_does_not_pin_a_temporary_hostname(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "mail.env"
            target.write_text("test-only-old-configuration", encoding="utf-8")
            code = 'test-only-"\\$`-code'
            mail_setup.write_mail_environment("test-only-admin@126.com", code, directory)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            body = target.read_text(encoding="utf-8")
            self.assertIn('DJANGO_EMAIL_HOST="smtp.126.com"\n', body)
            self.assertIn('DJANGO_EMAIL_PORT="465"\n', body)
            self.assertIn('DJANGO_EMAIL_USE_SSL="1"\n', body)
            self.assertIn('DJANGO_EMAIL_VERIFICATION_ENABLED="1"\n', body)
            self.assertIn('DEFAULT_FROM_EMAIL="test-only-admin@126.com"\n', body)
            self.assertIn("DJANGO_EMAIL_PASSWORD=" + mail_setup.quote_environment_value(code) + "\n", body)
            self.assertNotIn("DJANGO_SITE_URL", body)
            self.assertEqual(list(Path(directory).iterdir()), [target])

    def test_environment_quoting_preserves_metacharacters_without_extra_assignments(self):
        self.assertEqual(mail_setup.quote_environment_value('a"b\\c$d`e'), r'"a\"b\\c\$d\`e"')
        for value in ("test-only\nINJECTED=value", "test-only\rvalue", "test-only\x00value"):
            with self.subTest(value=value):
                with self.assertRaises(mail_setup.MailSetupError):
                    mail_setup.quote_environment_value(value)

    def test_symlink_environment_target_is_refused_without_reading_or_overwriting_it(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / "test-only-existing-file"
            original.write_text("test-only-preserve", encoding="utf-8")
            (Path(directory) / "mail.env").symlink_to(original)
            with self.assertRaises(mail_setup.MailSetupError):
                mail_setup.write_mail_environment("test-only-admin@126.com", "test-only-code", directory)
            self.assertEqual(original.read_text(encoding="utf-8"), "test-only-preserve")

    def test_failed_atomic_replace_keeps_previous_configuration_and_removes_temporary_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "mail.env"
            target.write_text("test-only-old-configuration", encoding="utf-8")
            with patch.object(mail_setup.os, "replace", side_effect=OSError("test-only-failure")):
                with self.assertRaises(OSError):
                    mail_setup.write_mail_environment("test-only-admin@126.com", "test-only-code", directory)
            self.assertEqual(target.read_text(encoding="utf-8"), "test-only-old-configuration")
            self.assertEqual(list(Path(directory).iterdir()), [target])

    def test_restart_only_targets_active_web_services_and_never_the_tunnel(self):
        calls = []

        def systemctl(command, **kwargs):
            calls.append(command)
            return SimpleNamespace(returncode=0 if command[-1] == "sera-website.service" else 3)

        with patch.object(mail_setup.subprocess, "run", side_effect=systemctl):
            self.assertTrue(mail_setup.restart_running_web_services())
        restarts = [command for command in calls if "restart" in command]
        self.assertEqual(restarts, [["systemctl", "--user", "restart", "sera-website.service"]])
        self.assertFalse(any("tunnel" in argument for command in calls for argument in command))


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class MailSenderSelectionTests(TestCase):
    def test_sender_candidates_are_existing_superuser_126_emails_only(self):
        users = get_user_model()
        users.objects.create_superuser("mail-test-admin", "test-only-admin@126.com", "test-only-password")
        users.objects.create_superuser("mail-test-other", "test-only-other@126.com", "test-only-password")
        users.objects.create_superuser("mail-test-outside", "test-only@example.com", "test-only-password")
        users.objects.create_user("mail-test-reader", "test-only-reader@126.com", "test-only-password")
        users.objects.create_superuser("mail-test-empty", "", "test-only-password")
        self.assertEqual(mail_setup.administrator_emails(), [
            "test-only-admin@126.com", "test-only-other@126.com",
        ])

    def test_multiple_administrators_require_an_explicit_choice_and_do_not_accept_a_new_sender(self):
        choices = ["test-only-first@126.com", "test-only-second@126.com"]
        with patch("builtins.input", return_value="2"), patch.object(mail_setup.sys, "stdout", io.StringIO()):
            self.assertEqual(mail_setup.choose_sender(choices), choices[1])
        with patch("builtins.input", return_value="attacker@example.com"), \
                patch.object(mail_setup.sys, "stdout", io.StringIO()):
            with self.assertRaises(mail_setup.MailSetupError):
                mail_setup.choose_sender(choices)
