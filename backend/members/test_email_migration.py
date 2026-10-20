from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class LegacyEmailMigrationTests(TransactionTestCase):
    """在临时数据库还原旧版本，确认原有账号、邮箱和便签无损迁移。"""

    def test_existing_addresses_are_reserved_but_not_claimed_as_verified(self):
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes("members")
        target = ("members", "0003_account_email")
        old_target = ("members", "0002_question")
        executor.migrate([old_target])
        try:
            old_apps = executor.loader.project_state([old_target]).apps
            OldUser = old_apps.get_model("auth", "User")
            OldNote = old_apps.get_model("members", "PrivateNote")
            owner = OldUser.objects.create(username="legacy-mail", email=" Legacy.Owner@Example.Test ", password="!")
            reader = OldUser.objects.create(username="legacy-empty", email="", password="!")
            OldNote.objects.create(owner_id=owner.pk, text="Keep my original note")
            executor = MigrationExecutor(connection)
            executor.migrate([target])
            apps = executor.loader.project_state([target]).apps
            User = apps.get_model("auth", "User")
            Binding = apps.get_model("members", "AccountEmail")
            Note = apps.get_model("members", "PrivateNote")
            binding = Binding.objects.get(user_id=owner.pk)
            self.assertEqual(binding.email, "legacy.owner@example.test")
            self.assertIsNone(binding.verified_at)
            self.assertEqual(User.objects.get(pk=owner.pk).email, binding.email)
            self.assertFalse(Binding.objects.filter(user_id=reader.pk).exists())
            self.assertEqual(Note.objects.get(owner_id=owner.pk).text, "Keep my original note")
        finally:
            MigrationExecutor(connection).migrate(latest)
