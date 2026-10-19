from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import path
from members import question_views, views

admin.site.site_header = "塞拉爱米露 · 站点管理"
admin.site.site_title = "站点管理"
urlpatterns = [
    path("", views.home, name="home"),
    path("health/", views.health, name="health"),
    path("api/session/", views.session_info, name="session_info"),
    path("api/questions/", question_views.questions, name="questions"),
    path("api/questions/<int:pk>/", question_views.question_detail, name="question_detail"),
    path("accounts/login/", auth_views.LoginView.as_view(), name="login"),
    path("accounts/register/", views.register, name="register"),
    path("accounts/password_reset/", views.password_reset_help, name="password_reset"),
    path("accounts/logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("accounts/password_change/", auth_views.PasswordChangeView.as_view(
        success_url="/accounts/password_change/done/"), name="password_change"),
    path("accounts/password_change/done/", auth_views.PasswordChangeDoneView.as_view(),
         name="password_change_done"),
    path("account/", views.account, name="account"),
    path("admin/", admin.site.urls),
]
