from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import redirect, render
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods, require_safe
from .forms import PrivateNoteForm
from .models import PrivateNote


@require_safe
def home(request):
    return render(request, "home.html")


@require_safe
def health(request):
    return JsonResponse({"status": "ok"})


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
