from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


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
