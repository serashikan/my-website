import uuid

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth import login
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import redirect, render
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from django.views.decorators.http import require_http_methods, require_safe
from django.utils import timezone
from .email_services import (EmailFlowError, MailDeliveryError, active_operation,
    cancel_operation, create_email_request, create_registration, mail_ready,
    send_verification, verify_token)
from .forms import (CurrentPasswordForm, EmailRequestForm, EmailVerificationForm,
                    PrivateNoteForm, RegistrationForm)
from .models import AccountEmail, EmailOperation, PrivateNote


REGISTRATION_SESSION_KEY = "pending_registration"


def _registration_operation(request):
    """只能按当前浏览器的服务器会话取待确认注册，忽略 URL 中的编号。"""
    try:
        operation_id = uuid.UUID(str(request.session.get(REGISTRATION_SESSION_KEY, "")))
    except (ValueError, TypeError, AttributeError):
        return None
    return EmailOperation.objects.filter(
        pk=operation_id, kind=EmailOperation.Kind.REGISTRATION,
        status=EmailOperation.Status.PENDING, expires_at__gt=timezone.now(),
    ).first()


def _send_email(request, operation):
    try:
        send_verification(operation)
    except MailDeliveryError:
        messages.error(request, "验证邮件未能发送。申请仍保留为待验证，可稍后重发；目前尚未完成验证。")
    except EmailFlowError as error:
        messages.error(request, str(error))
    else:
        messages.success(request, "验证邮件已发送，请在有效期内打开邮件链接，并输入密码确认。")


@require_safe
def home(request):
    return render(request, "home.html")


@require_safe
def health(request):
    return JsonResponse({"status": "ok"})


@never_cache
@sensitive_post_parameters("password", "password1", "password2", "current_password", "token")
@require_http_methods(["GET", "POST"])
def register(request):
    if request.user.is_authenticated:
        return redirect("account")
    form = RegistrationForm(request.POST if request.method == "POST" else None)
    ready = mail_ready()
    if request.method == "POST" and form.is_valid():
        if not ready:
            form.add_error(None, "邮箱验证暂未配置完成，请稍后再来或联系站主。")
            return render(request, "registration/register.html", {"form": form, "mail_ready": ready})
        try:
            operation = create_registration(form.cleaned_data["username"],
                form.cleaned_data["password1"], form.cleaned_data["email"])
        except EmailFlowError as error:
            form.add_error(None, str(error))
        else:
            request.session[REGISTRATION_SESSION_KEY] = str(operation.pk)
            _send_email(request, operation)
            return redirect("register_pending")
    return render(request, "registration/register.html", {"form": form, "mail_ready": ready})


@never_cache
@require_safe
def register_pending(request):
    if request.user.is_authenticated:
        return redirect("account_info")
    operation = _registration_operation(request)
    return render(request, "registration/register_pending.html", {
        "operation": operation, "form": CurrentPasswordForm(),
    })


@never_cache
@sensitive_post_parameters("password", "password1", "password2", "current_password", "token")
@require_http_methods(["POST"])
def register_resend(request):
    if request.user.is_authenticated:
        return redirect("account_info")
    operation = _registration_operation(request)
    if operation is None:
        return redirect("register_pending")
    form = CurrentPasswordForm(request.POST, password_hash=operation.password_hash)
    if form.is_valid():
        _send_email(request, operation)
        return redirect("register_pending")
    return render(request, "registration/register_pending.html", {"operation": operation, "form": form})


@never_cache
@sensitive_post_parameters("password", "password1", "password2", "current_password", "token")
@require_http_methods(["GET", "POST"])
def email_verify(request):
    # GET 只显示确认页；令牌由浏览器从 fragment 取出，不查询或消耗链接。
    form = EmailVerificationForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        try:
            operation = verify_token(form.cleaned_data["token"], form.cleaned_data["password"],
                actor=request.user if request.user.is_authenticated else None)
        except EmailFlowError as error:
            form.add_error(None, str(error))
        else:
            if operation.kind == EmailOperation.Kind.REGISTRATION:
                login(request, operation.user, backend="django.contrib.auth.backends.ModelBackend")
                request.session.pop(REGISTRATION_SESSION_KEY, None)
                messages.success(request, "邮箱已确认，账号已开通。欢迎来到你的小屋。")
            elif operation.status == EmailOperation.Status.AWAITING_REVIEW:
                messages.success(request, "新邮箱已验证，正在等待站主审核；当前邮箱暂不改变。")
            else:
                messages.success(request, "邮箱验证已完成。")
            destination = ("account" if operation.kind == EmailOperation.Kind.REGISTRATION
                           else "account_info" if request.user.is_authenticated else "login")
            response = redirect(destination)
            response["Referrer-Policy"] = "same-origin"
            return response
    response = render(request, "registration/email_verify.html", {"form": form})
    # Safari 的同源表单可能不带 Origin，HTTPS CSRF 检查仍需要同源 Referer。
    # 验证令牌在 fragment 中，浏览器从不会把 fragment 作为 Referer 发送。
    response["Referrer-Policy"] = "same-origin"
    return response


@never_cache
@login_required
@sensitive_post_parameters("password", "password1", "password2", "current_password", "token")
@require_http_methods(["GET", "POST"])
def account_info(request):
    saved_email = AccountEmail.objects.filter(user=request.user).first()
    pending = active_operation(request.user)
    email_form = EmailRequestForm(user=request.user)
    operation_form = CurrentPasswordForm(user=request.user)
    if request.method == "POST":
        action = request.POST.get("action")
        if action == "request":
            email_form = EmailRequestForm(request.POST, user=request.user)
            if email_form.is_valid():
                if pending is not None:
                    email_form.add_error(None, "请先取消当前待处理的邮箱申请，再申请另一个地址。")
                elif not mail_ready():
                    email_form.add_error(None, "邮箱验证暂未配置完成，请稍后重试或联系站主。")
                else:
                    try:
                        operation = create_email_request(request.user, email_form.cleaned_data["email"])
                    except EmailFlowError as error:
                        email_form.add_error(None, str(error))
                    else:
                        _send_email(request, operation)
                        return redirect("account_info")
        elif action in {"resend", "cancel"}:
            operation_form = CurrentPasswordForm(request.POST, user=request.user)
            if operation_form.is_valid():
                if pending is None:
                    operation_form.add_error(None, "没有可操作的待处理申请，请刷新页面。")
                else:
                    try:
                        if action == "cancel":
                            cancel_operation(pending, request.user)
                            messages.success(request, "已取消待处理的邮箱申请。")
                        else:
                            _send_email(request, pending)
                    except EmailFlowError as error:
                        operation_form.add_error(None, str(error))
                    else:
                        return redirect("account_info")
        else:
            operation_form.add_error(None, "请选择有效的账户操作。")
    return render(request, "account_info.html", {
        "saved_email": saved_email, "pending": pending,
        "email_form": email_form, "operation_form": operation_form,
        "mail_ready": mail_ready(),
    })


@never_cache
@require_safe
def password_reset_help(request):
    return render(request, "registration/password_reset_help.html")


@never_cache
@login_required
@require_safe
def session_info(request):
    return JsonResponse({
        "username": request.user.get_short_name() or request.user.username,
        "is_staff": request.user.is_staff,
        "csrf_token": get_token(request),
    })


@never_cache
@login_required
@require_http_methods(["GET", "POST"])
def account(request):
    # 关键：不用来自网页的用户编号，以当前会话中的用户确定所有者。
    note = PrivateNote.objects.filter(owner=request.user).first()
    form = PrivateNoteForm(request.POST if request.method == "POST" else None, instance=note)
    if request.method == "POST" and form.is_valid():
        note = form.save(commit=False)
        note.owner = request.user
        note.save()
        messages.success(request, "便签已保存。")
        return redirect("account")
    return render(request, "account.html", {"form": form, "note": note})
