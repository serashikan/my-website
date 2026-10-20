import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from .email_addresses import normalize_email


class CasinoProgress(models.Model):
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                 related_name="casino_progress")
    snapshot = models.JSONField(default=dict)
    revision = models.PositiveBigIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "赌场挑战进度"
        verbose_name_plural = "赌场挑战进度"


class PrivateNote(models.Model):
    """一个账号对应一条便签，所有读写都从当前登录用户出发。"""
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    text = models.CharField("我的便签", max_length=1000, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class Question(models.Model):
    """先由站主管理，按提问者选择及审核结果决定是否展示。"""

    class Visibility(models.TextChoices):
        PRIVATE = "private", "仅站主可见"
        ANONYMOUS = "anonymous", "匿名展示"
        NAMED = "named", "署名展示"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                              related_name="questions", verbose_name="提问者")
    title = models.CharField("问题标题", max_length=120)
    body = models.TextField("问题内容", max_length=2000)
    answer = models.TextField("站主回复", max_length=5000, blank=True)
    visibility = models.CharField("提问者选择的展示方式", max_length=16,
                                  choices=Visibility.choices, default=Visibility.PRIVATE)
    is_public = models.BooleanField("审核后在问答区展示", default=False)
    answered_at = models.DateTimeField("回复时间", null=True, blank=True)
    created_at = models.DateTimeField("提问时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "提问与回复"
        verbose_name_plural = "提问与回复"
        ordering = ["-created_at", "-pk"]

    def __str__(self):
        return self.title

    def clean(self):
        super().clean()
        if self.is_public:
            if self.visibility == self.Visibility.PRIVATE:
                raise ValidationError({"is_public": "提问者选择了仅站主可见，不能公开展示。"})
            if not self.answer.strip():
                raise ValidationError({"is_public": "请先填写回复，再审核展示。"})


class AccountEmail(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                               related_name="account_email", verbose_name="账号")
    email = models.EmailField("邮箱", max_length=254, unique=True, db_collation="nocase")
    verified_at = models.DateTimeField("验证时间", null=True, blank=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "账号邮箱"
        verbose_name_plural = "账号邮箱"

    def save(self, *args, **kwargs):
        self.email = normalize_email(self.email)
        super().save(*args, **kwargs)

    def __str__(self):
        return str(self.user)


class EmailOperation(models.Model):
    class Kind(models.TextChoices):
        REGISTRATION = "registration", "注册验证"
        FIRST_EMAIL = "first_email", "首次绑定"
        CHANGE_EMAIL = "change_email", "更换邮箱"
        VERIFY_EMAIL = "verify_email", "验证已有邮箱"

    class Status(models.TextChoices):
        PENDING = "pending", "等待验证"
        AWAITING_REVIEW = "awaiting_review", "等待管理员审批"
        COMPLETED = "completed", "已完成"
        REJECTED = "rejected", "已拒绝"
        CANCELLED = "cancelled", "已取消"
        EXPIRED = "expired", "已过期"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField("操作类型", max_length=20, choices=Kind.choices)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                             related_name="email_operations", null=True, blank=True)
    username = models.CharField("用户名", max_length=150, blank=True)
    username_key = models.CharField(max_length=450, blank=True)
    password_hash = models.CharField(max_length=256, blank=True)
    target_email = models.EmailField("新邮箱", max_length=254, db_collation="nocase")
    previous_email = models.EmailField("原邮箱", max_length=254, blank=True)
    status = models.CharField("状态", max_length=20, choices=Status.choices, default=Status.PENDING)
    token_digest = models.CharField(max_length=64, blank=True, db_index=True)
    expires_at = models.DateTimeField("有效期至", db_index=True)
    created_at = models.DateTimeField("申请时间", auto_now_add=True)
    sent_at = models.DateTimeField("发信时间", null=True, blank=True)
    verified_at = models.DateTimeField("新邮箱验证时间", null=True, blank=True)
    reviewed_at = models.DateTimeField("审批时间", null=True, blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                    related_name="reviewed_email_operations", null=True, blank=True)

    class Meta:
        verbose_name = "邮箱申请"
        verbose_name_plural = "邮箱申请"
        ordering = ["-created_at"]
        permissions = [("approve_email_change", "可以审批账号邮箱变更")]
        constraints = [
            models.UniqueConstraint(fields=["target_email"],
                condition=models.Q(status__in=["pending", "awaiting_review"]),
                name="unique_active_email_target"),
            models.UniqueConstraint(fields=["user"],
                condition=models.Q(status__in=["pending", "awaiting_review"]),
                name="unique_active_email_user"),
            models.UniqueConstraint(fields=["username_key"],
                condition=models.Q(kind="registration", status__in=["pending", "awaiting_review"]),
                name="unique_pending_signup_username"),
        ]

    def __str__(self):
        return f"{self.get_kind_display()} · {self.get_status_display()}"
