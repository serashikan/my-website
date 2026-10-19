from django import forms
from .models import PrivateNote


class PrivateNoteForm(forms.ModelForm):
    class Meta:
        model = PrivateNote
        # 不允许浏览器提交 owner。归属只能由服务器决定。
        fields = ["text"]
        widgets = {"text": forms.Textarea(attrs={
            "rows": 6, "maxlength": 1000, "placeholder": "写点想留给自己的话……",
        })}
