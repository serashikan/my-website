"""站内提问接口；公开展示须符合提问者选择且经站主回复和审核。"""
import json

from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db.models import Q
from django.http import Http404, JsonResponse
from django.utils.crypto import salted_hmac
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods, require_safe

from .forms import QuestionForm
from .models import Question
from .rate_limit import consume_limit


def public_questions():
    return Question.objects.filter(
        is_public=True,
        visibility__in=[Question.Visibility.ANONYMOUS, Question.Visibility.NAMED],
        answer__regex=r"\S",
    )


def question_data(question, viewer):
    return {
        "id": question.pk,
        "title": question.title,
        "body": question.body,
        "answer": question.answer,
        "author": (question.owner.get_short_name() or question.owner.username)
                  if question.visibility == Question.Visibility.NAMED else "匿名朋友",
        "visibility": question.visibility,
        "is_public": question.is_public,
        "is_mine": question.owner_id == viewer.pk,
        "created_at": question.created_at.isoformat(),
        "answered_at": question.answered_at.isoformat() if question.answered_at else None,
    }


@never_cache
@login_required
@require_http_methods(["GET", "POST"])
def questions(request):
    if request.method == "GET":
        scope = request.GET.get("scope", "mine")
        if scope not in {"mine", "public"}:
            return JsonResponse({"error": "请选择问答展示或我的提问。"}, status=400)
        try:
            number = int(request.GET.get("page", "1"))
        except ValueError:
            return JsonResponse({"error": "页码应是正整数。"}, status=400)
        if not 1 <= number <= 1000000:
            return JsonResponse({"error": "页码应是正整数。"}, status=400)
        # 管理员查看全部待审核问题仍走有模型权限检查的管理后台。
        queryset = public_questions() if scope == "public" else Question.objects.filter(owner=request.user)
        paginator = Paginator(queryset.select_related("owner"), 20)
        page = paginator.get_page(number)
        return JsonResponse({
            "items": [question_data(question, request.user) for question in page],
            "page": page.number,
            "pages": paginator.num_pages,
            "total": paginator.count,
            "has_next": page.has_next(),
            "has_previous": page.has_previous(),
        })

    if request.content_type != "application/json":
        return JsonResponse({"error": "请以 JSON 提交问题。"}, status=415)
    if len(request.body) > 32768:
        return JsonResponse({"error": "问题内容过长，请缩短后重试。"}, status=413)
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"error": "提交内容格式不正确。"}, status=400)
    if not isinstance(data, dict):
        return JsonResponse({"error": "提交内容格式不正确。"}, status=400)
    errors = {field: ["请填写文字。"] for field in ("title", "body", "visibility")
              if field in data and not isinstance(data[field], str)}
    if errors:
        return JsonResponse({"error": "请检查问题内容。", "errors": errors}, status=400)
    form = QuestionForm({
        "title": data.get("title", ""), "body": data.get("body", ""),
        "visibility": data.get("visibility", Question.Visibility.PRIVATE),
    })
    if not form.is_valid():
        return JsonResponse({"error": "请检查问题内容。", "errors": dict(form.errors)}, status=400)
    digest = salted_hmac("members.question-submit", str(request.user.pk)).hexdigest()
    if not consume_limit(f"question-submit:{digest}", 10, 3600):
        response = JsonResponse({"error": "本小时提问较多，请稍后再来。"}, status=429)
        response["Retry-After"] = "3600"
        return response
    question = form.save(commit=False)
    question.owner = request.user
    question.save()
    return JsonResponse({"question": question_data(question, request.user)}, status=201)


@never_cache
@login_required
@require_safe
def question_detail(request, pk):
    allowed = Question.objects.select_related("owner")
    if not (request.user.is_staff and request.user.has_perm("members.view_question")):
        allowed = allowed.filter(Q(owner=request.user) | Q(pk__in=public_questions().values("pk")))
    try:
        question = allowed.get(pk=pk)
    except Question.DoesNotExist:
        raise Http404 from None
    return JsonResponse({"question": question_data(question, request.user)})
