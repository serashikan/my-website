from django import forms
from django.contrib.auth.forms import UserCreationForm
from .models import PrivateNote


class RegistrationForm(UserCreationForm):
    """复用 Django 的用户名、密码校验与哈希保存，只开放普通账号字段。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"].widget.attrs["autocomplete"] = "username"
        self.fields["password2"].label = "确认密码"


class PrivateNoteForm(forms.ModelForm):
    class Meta:
        model = PrivateNote
        # 不允许浏览器提交 owner。归属只能由服务器决定。
        fields = ["text"]
        widgets = {"text": forms.Textarea(attrs={
            "rows": 6, "maxlength": 1000, "placeholder": "写点想留给自己的话……",
        })}
