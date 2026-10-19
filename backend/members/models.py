from django.conf import settings
from django.db import models


class PrivateNote(models.Model):
    """一个账号对应一条便签，所有读写都从当前登录用户出发。"""
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    text = models.CharField("我的便签", max_length=1000, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
