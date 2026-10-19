from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth import login
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import redirect, render
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods, require_safe
from .forms import PrivateNoteForm, RegistrationForm
from .models import PrivateNote


@require_safe
def home(request):
    return render(request, "home.html")


@require_safe
def health(request):
    return JsonResponse({"status": "ok"})


@never_cache
@require_http_methods(["GET", "POST"])
def register(request):
    if request.user.is_authenticated:
        return redirect("account")
    form = RegistrationForm(request.POST if request.method == "POST" else None)
    if request.method == "POST" and form.is_valid():
        try:
            with transaction.atomic():
                user = form.save()
        except IntegrityError:
            # 同名注册同时提交时，数据库的唯一约束仍是最后一道检查。
            form.add_error("username", "这个用户名已经有人用了，请换一个。")
        else:
            login(request, user, backend="django.contrib.auth.backends.ModelBackend")
            messages.success(request, "注册成功，欢迎来到你的小屋。")
            return redirect("account")
    return render(request, "registration/register.html", {"form": form})


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
