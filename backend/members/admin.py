from django.contrib import admin
from django.utils import timezone

from .models import Question


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "reply_status", "visibility", "is_public", "created_at")
    list_filter = ("is_public", "visibility", "created_at", "answered_at")
    search_fields = ("title", "body", "answer", "owner__username")
    list_select_related = ("owner",)
    list_per_page = 30
    readonly_fields = ("owner", "title", "body", "visibility", "created_at", "updated_at", "answered_at")
    fieldsets = (
        ("朋友的提问", {"fields": ("owner", "title", "body", "visibility", "created_at")}),
        ("站主回复与审核", {"fields": ("answer", "is_public"),
                   "description": "填写回复后，按提问者选择的展示方式决定是否勾选审核展示。匿名展示不会向其他用户显示提问者账号；仅站主可见的问题不能公开。"}),
        ("记录", {"fields": ("answered_at", "updated_at")}),
    )

    @admin.display(description="回复状态")
    def reply_status(self, obj):
        return "已回复" if obj.answer.strip() else "待回复"

    def has_add_permission(self, request):
        return False

    def save_model(self, request, obj, form, change):
        if "answer" in form.changed_data:
            obj.answered_at = timezone.now() if obj.answer.strip() else None
        super().save_model(request, obj, form, change)
