from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied
from django.shortcuts import redirect
from django.urls import reverse
from django.utils import timezone

from .email_services import EmailFlowError, review_change
from .models import AccountEmail, EmailOperation, Question


User = get_user_model()
admin.site.unregister(User)


@admin.register(User)
class AccountUserAdmin(UserAdmin):
    # 邮箱只能经验证与审核服务更新，不能在用户编辑页绕过流程。
    readonly_fields = (*UserAdmin.readonly_fields, "email")


@admin.register(AccountEmail)
class AccountEmailAdmin(admin.ModelAdmin):
    list_display = ("user", "email", "verified_at", "updated_at")
    search_fields = ("user__username", "email")
    readonly_fields = ("user", "email", "verified_at", "updated_at")
    list_select_related = ("user",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(EmailOperation)
class EmailOperationAdmin(admin.ModelAdmin):
    change_form_template = "admin/members/emailoperation/change_form.html"
    list_display = ("account_name", "kind", "target_email", "status", "created_at", "reviewed_by")
    list_filter = ("status", "kind", "created_at")
    search_fields = ("user__username", "username", "target_email", "previous_email")
    list_select_related = ("user", "reviewed_by")
    list_per_page = 30
    actions = ("approve_changes", "reject_changes")
    readonly_fields = (
        "kind", "status", "user", "username", "target_email", "previous_email",
        "created_at", "sent_at", "verified_at", "expires_at", "reviewed_at", "reviewed_by",
    )
    fields = readonly_fields

    @admin.display(description="账号")
    def account_name(self, obj):
        return obj.user.username if obj.user_id else obj.username

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_approve_permission(self, request):
        return request.user.has_perm("members.approve_email_change")

    def save_model(self, request, obj, form, change):
        # 此页所有字段只读，审核动作统一经过服务中的状态与唯一性检查。
        pass

    def _review(self, request, queryset, approve):
        if not self.has_approve_permission(request):
            raise PermissionDenied
        count = 0
        for operation in queryset:
            try:
                review_change(operation, request.user, approve=approve)
            except EmailFlowError as exc:
                self.message_user(request, str(exc), level=messages.ERROR)
            else:
                count += 1
        if count:
            verb = "通过" if approve else "拒绝"
            self.message_user(request, f"已{verb} {count} 个邮箱变更申请。", level=messages.SUCCESS)

    @admin.action(description="通过选中的邮箱变更申请", permissions=["approve"])
    def approve_changes(self, request, queryset):
        self._review(request, queryset, approve=True)

    @admin.action(description="拒绝选中的邮箱变更申请", permissions=["approve"])
    def reject_changes(self, request, queryset):
        self._review(request, queryset, approve=False)

    def render_change_form(self, request, context, *args, **kwargs):
        operation = context.get("original")
        context["can_review_email"] = bool(
            operation and operation.status == EmailOperation.Status.AWAITING_REVIEW
            and self.has_approve_permission(request)
            and self.has_change_permission(request, operation)
        )
        context.update(show_save=False, show_save_and_continue=False, show_save_and_add_another=False)
        return super().render_change_form(request, context, *args, **kwargs)

    def response_change(self, request, obj):
        if "_approve_email" in request.POST or "_reject_email" in request.POST:
            self._review(request, [obj], approve="_approve_email" in request.POST)
            return redirect(reverse("admin:members_emailoperation_change", args=[obj.pk]))
        return super().response_change(request, obj)


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
