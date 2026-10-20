from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.hashers import check_password
from .email_addresses import normalize_email
from .models import PrivateNote, Question


class RegistrationForm(UserCreationForm):
    """只校验注册资料，账号须由邮箱确认服务建立。"""

    email = forms.EmailField(label="邮箱", max_length=254,
                             widget=forms.EmailInput(attrs={"autocomplete": "email"}))

    class Meta(UserCreationForm.Meta):
        fields = ("username", "email")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"].widget.attrs["autocomplete"] = "username"
        self.fields["password2"].label = "确认密码"
        self.order_fields(["username", "email", "password1", "password2"])

    def clean_email(self):
        return normalize_email(self.cleaned_data["email"])

    def save(self, commit=True):
        raise RuntimeError("注册账号只能通过邮箱确认服务建立。")


class CurrentPasswordForm(forms.Form):
    current_password = forms.CharField(label="当前密码", strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}))

    def __init__(self, *args, user=None, password_hash=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user
        self.password_hash = password_hash

    def clean_current_password(self):
        password = self.cleaned_data["current_password"]
        valid = (self.user.check_password(password) if self.user is not None
                 else bool(self.password_hash) and check_password(password, self.password_hash))
        if not valid:
            raise forms.ValidationError("密码不正确，请重新输入。")
        return password


class EmailRequestForm(CurrentPasswordForm):
    email = forms.EmailField(label="邮箱", max_length=254,
                             widget=forms.EmailInput(attrs={"autocomplete": "email"}))

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("auto_id", "email_%s")
        super().__init__(*args, **kwargs)
        self.order_fields(["email", "current_password"])

    def clean_email(self):
        return normalize_email(self.cleaned_data["email"])


class EmailVerificationForm(forms.Form):
    token = forms.CharField(max_length=512, widget=forms.HiddenInput())
    password = forms.CharField(label="注册时设置的密码或当前账号密码", strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}))


class PrivateNoteForm(forms.ModelForm):
    class Meta:
        model = PrivateNote
        # 不允许浏览器提交 owner。归属只能由服务器决定。
        fields = ["text"]
        widgets = {"text": forms.Textarea(attrs={
            "rows": 6, "maxlength": 1000, "placeholder": "写点想留给自己的话……",
        })}


class QuestionForm(forms.ModelForm):
    class Meta:
        model = Question
        fields = ["title", "body", "visibility"]
