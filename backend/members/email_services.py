"""验证邮件及审批的状态机；SMTP 调用始终位于本服务的事务块之外。"""
import hashlib
import secrets
from datetime import timedelta
from email.utils import parseaddr
from functools import wraps
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import URLValidator
from django.db import IntegrityError, OperationalError, transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac

from .email_addresses import normalize_email
from .models import AccountEmail, EmailOperation


class EmailFlowError(Exception):
    pass


class MailDeliveryError(EmailFlowError):
    pass


ACTIVE = (EmailOperation.Status.PENDING, EmailOperation.Status.AWAITING_REVIEW)
VERIFY_LIFETIME = timedelta(minutes=30)
REVIEW_LIFETIME = timedelta(days=7)


def _database_errors(function):
    @wraps(function)
    def call(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except OperationalError:
            raise EmailFlowError("申请正在处理中，请稍后重试。") from None
    return call


def _expire_operations():
    try:
        EmailOperation.objects.filter(status__in=ACTIVE, expires_at__lte=timezone.now()).update(
            status=EmailOperation.Status.EXPIRED, password_hash="", token_digest="",
        )
    except OperationalError:
        # 清理可重试；所有实际处理动作仍单独检查 expires_at。
        pass


def _operation(operation):
    try:
        return EmailOperation.objects.get(pk=getattr(operation, "pk", operation))
    except (EmailOperation.DoesNotExist, ValueError, ValidationError):
        raise EmailFlowError("找不到这条邮箱申请，请重新申请。") from None


def _user(user):
    user_id = getattr(user, "pk", None)
    account = get_user_model().objects.filter(pk=user_id, is_active=True).first()
    if account is None:
        raise EmailFlowError("账号当前不可用，请联系站主。")
    return account


def _address(value):
    try:
        return normalize_email(value)
    except ValidationError as error:
        raise EmailFlowError(" ".join(error.messages)) from None


def _current_email(user):
    binding = AccountEmail.objects.filter(user_id=user.pk).first()
    if binding:
        return binding.email
    return _address(user.email) if user.email.strip() else ""


def _username(value):
    if not isinstance(value, str):
        raise EmailFlowError("请输入有效的用户名。")
    User = get_user_model()
    value = User.normalize_username(value.strip())
    try:
        value = User._meta.get_field("username").clean(value, None)
    except ValidationError as error:
        raise EmailFlowError(" ".join(error.messages)) from None
    return value, value.casefold()


def _username_available(username_key):
    User = get_user_model()
    # 站点规模很小；同时覆盖 SQLite 的 iexact 不处理的 Unicode 大小写。
    for name in User.objects.values_list("username", flat=True):
        if User.normalize_username(name).casefold() == username_key:
            raise EmailFlowError("这个用户名已经有人使用，请换一个。")


def _target_available(email, user_id=None):
    if AccountEmail.objects.filter(email=email).exclude(user_id=user_id).exists():
        raise EmailFlowError("这个邮箱已经绑定了其他账号。")
    for account_id, value in get_user_model().objects.exclude(email="").values_list("pk", "email"):
        if account_id == user_id:
            continue
        try:
            matches = normalize_email(value) == email
        except ValidationError:
            matches = False
        if matches:
            raise EmailFlowError("这个邮箱已经绑定了其他账号。")


@_database_errors
def active_operation(user):
    _expire_operations()
    if not getattr(user, "pk", None):
        return None
    return EmailOperation.objects.filter(user_id=user.pk, status__in=ACTIVE, expires_at__gt=timezone.now()).first()


@_database_errors
def create_registration(username, password, email):
    _expire_operations()
    username, key = _username(username)
    email = _address(email)
    candidate = get_user_model()(username=username, email=email)
    if not isinstance(password, str) or not password:
        raise EmailFlowError("请设置注册密码。")
    try:
        validate_password(password, user=candidate)
    except ValidationError as error:
        raise EmailFlowError(" ".join(error.messages)) from None
    candidate.set_password(password)
    try:
        with transaction.atomic():
            _username_available(key)
            _target_available(email)
            return EmailOperation.objects.create(
                kind=EmailOperation.Kind.REGISTRATION, username=username, username_key=key,
                password_hash=candidate.password, target_email=email,
                expires_at=timezone.now() + VERIFY_LIFETIME,
            )
    except IntegrityError:
        raise EmailFlowError("用户名或邮箱已有待处理申请，请使用原申请重发邮件，或等到期后重试。") from None
    except OperationalError:
        raise EmailFlowError("申请正在处理中，请稍后再试。") from None


@_database_errors
def create_email_request(user, email):
    _expire_operations()
    user = _user(user)
    email = _address(email)
    try:
        with transaction.atomic():
            if EmailOperation.objects.filter(user_id=user.pk, status__in=ACTIVE,
                                             expires_at__gt=timezone.now()).exists():
                raise EmailFlowError("你已有待处理邮箱申请，请先完成或取消，再申请新的邮箱。")
            previous = _current_email(user)
            binding = AccountEmail.objects.filter(user_id=user.pk).first()
            if email == previous and binding and binding.verified_at:
                raise EmailFlowError("这个邮箱已经验证，无需重复绑定。")
            _target_available(email, user.pk)
            kind = (EmailOperation.Kind.FIRST_EMAIL if not previous else
                    EmailOperation.Kind.VERIFY_EMAIL if email == previous else EmailOperation.Kind.CHANGE_EMAIL)
            return EmailOperation.objects.create(
                kind=kind, user=user, username=user.username, username_key=user.username.casefold(),
                target_email=email, previous_email=previous, expires_at=timezone.now() + VERIFY_LIFETIME,
            )
    except IntegrityError:
        raise EmailFlowError("这个邮箱已有待处理申请，请稍后再试。") from None
    except OperationalError:
        raise EmailFlowError("申请正在处理中，请稍后再试。") from None


def _public_url():
    value = getattr(settings, "SITE_PUBLIC_URL", "")
    if not isinstance(value, str):
        return ""
    value = value.rstrip("/")
    try:
        URLValidator(schemes=["https"])(value)
        parsed = urlsplit(value)
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
            return ""
    except (ValidationError, ValueError, TypeError):
        return ""
    return value


def mail_ready():
    if not getattr(settings, "EMAIL_VERIFICATION_ENABLED", False) or not _public_url():
        return False
    backend = settings.EMAIL_BACKEND
    if backend == "django.core.mail.backends.locmem.EmailBackend":
        return True
    if backend != "django.core.mail.backends.smtp.EmailBackend":
        return False
    try:
        normalize_email(parseaddr(settings.DEFAULT_FROM_EMAIL)[1])
        timeout = float(settings.EMAIL_TIMEOUT)
        port = int(settings.EMAIL_PORT)
    except (ValidationError, ValueError, TypeError, AttributeError):
        return False
    return bool(settings.EMAIL_HOST and settings.EMAIL_HOST_USER and settings.EMAIL_HOST_PASSWORD
                and 0 < port < 65536 and timeout > 0
                and bool(settings.EMAIL_USE_TLS) != bool(settings.EMAIL_USE_SSL))


def _throttle_send(operation):
    identities = (f"email:{operation.target_email}",
                  f"user:{operation.user_id}" if operation.user_id else f"signup:{operation.username_key}")
    cooldown = max(0, int(getattr(settings, "EMAIL_VERIFICATION_COOLDOWN", 60)))
    maximum = max(1, int(getattr(settings, "EMAIL_VERIFICATION_MAX_PER_HOUR", 5)))
    for identity in identities:
        digest = salted_hmac("members.email-send", identity, algorithm="sha256").hexdigest()
        if cooldown and not cache.add(f"email-send:wait:{digest}", 1, timeout=cooldown):
            raise EmailFlowError("邮件请求有些频繁，请稍等一分钟再试。")
        key = f"email-send:hour:{digest}"
        for _ in range(3):
            if cache.add(key, 1, timeout=3600):
                count = 1
                break
            try:
                count = cache.incr(key)
                break
            except ValueError:
                continue
        else:
            count = maximum + 1
        if count > maximum:
            raise EmailFlowError("这个邮箱或账号的发信次数较多，请一小时后再试。")


@_database_errors
def send_verification(operation):
    _expire_operations()
    current = _operation(operation)
    if current.status != EmailOperation.Status.PENDING:
        raise EmailFlowError("这条申请已不再等待验证，请查看当前状态。")
    if current.user_id:
        _user(current.user)
    if not mail_ready():
        raise MailDeliveryError("验证邮件暂时还不能发送，请稍后重试或联系站主。")
    _throttle_send(current)
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    with transaction.atomic():
        changed = EmailOperation.objects.filter(
            pk=current.pk, status=EmailOperation.Status.PENDING, token_digest=current.token_digest,
            expires_at__gt=timezone.now(),
        ).update(token_digest=digest, sent_at=None, expires_at=timezone.now() + VERIFY_LIFETIME)
        if changed != 1:
            raise EmailFlowError("申请状态已经变化，请刷新后再试。")
    link = f"{_public_url()}/accounts/email/verify/#token={token}"
    try:
        sent = send_mail(
            "验证你的邮箱 · 塞拉爱米露",
            "请在 30 分钟内打开以下链接，并输入注册时设置的密码或当前账号密码完成验证。\n\n"
            + link + "\n\n如果这不是你发起的操作，请忽略本邮件。",
            settings.DEFAULT_FROM_EMAIL, [current.target_email], fail_silently=False,
        )
        if sent != 1:
            raise RuntimeError("Delivery was not confirmed")
    except Exception:
        EmailOperation.objects.filter(pk=current.pk, token_digest=digest).update(token_digest="", sent_at=None)
        if isinstance(operation, EmailOperation):
            operation.refresh_from_db()
        raise MailDeliveryError("邮件未能发送，申请已保留。请稍后重发或联系站主。") from None
    EmailOperation.objects.filter(pk=current.pk, status=EmailOperation.Status.PENDING,
                                  token_digest=digest).update(sent_at=timezone.now())
    if isinstance(operation, EmailOperation):
        operation.refresh_from_db()


def _check_snapshot(operation, user):
    mirror = _address(user.email) if user.email.strip() else ""
    if _current_email(user) != operation.previous_email or mirror != operation.previous_email:
        raise EmailFlowError("账号邮箱已经变化，这条旧申请不能继续，请重新申请。")


def _bind_email(user, email, verified_at, expected_password_hash=None):
    AccountEmail.objects.update_or_create(user_id=user.pk, defaults={"email": email, "verified_at": verified_at})
    accounts = get_user_model().objects.filter(pk=user.pk, is_active=True)
    if expected_password_hash is not None:
        accounts = accounts.filter(password=expected_password_hash)
    if accounts.update(email=email) != 1:
        raise EmailFlowError("账号当前不可用，请联系站主。")


@_database_errors
def verify_token(raw_token, password, actor=None):
    _expire_operations()
    if not isinstance(raw_token, str) or not 20 <= len(raw_token) <= 200:
        raise EmailFlowError("验证链接无效或已经过期，请重新申请。")
    digest = hashlib.sha256(raw_token.encode()).hexdigest()
    operation = EmailOperation.objects.filter(
        token_digest=digest, status=EmailOperation.Status.PENDING, sent_at__isnull=False,
        expires_at__gt=timezone.now(),
    ).first()
    if operation is None:
        raise EmailFlowError("验证链接无效或已经过期，请重新申请。")
    authenticated_actor = actor is not None and getattr(actor, "is_authenticated", False)
    if authenticated_actor and actor.pk != operation.user_id:
        raise EmailFlowError("当前登录账号与这条申请不同，请先退出再验证。")
    if not isinstance(password, str) or not password:
        raise EmailFlowError("请输入发起申请时使用的账号密码。")
    password_hash = operation.password_hash
    if operation.kind == EmailOperation.Kind.REGISTRATION:
        if not check_password(password, password_hash):
            raise EmailFlowError("注册密码不正确，请重新输入。")
    else:
        user = _user(operation.user)
        if not user.check_password(password):
            raise EmailFlowError("当前账号密码不正确，请重新输入。")
        checked_password_hash = user.password
    try:
        with transaction.atomic():
            now = timezone.now()
            needs_review = operation.kind == EmailOperation.Kind.CHANGE_EMAIL
            if operation.kind == EmailOperation.Kind.REGISTRATION:
                _username_available(operation.username_key)
                _target_available(operation.target_email)
            else:
                user = _user(operation.user)
                if user.password != checked_password_hash:
                    raise EmailFlowError("账号密码已经变化，请使用新密码重新确认。")
                _check_snapshot(operation, user)
                _target_available(operation.target_email, user.pk)
            changed = EmailOperation.objects.filter(
                pk=operation.pk, status=EmailOperation.Status.PENDING, token_digest=digest,
                sent_at__isnull=False, expires_at__gt=now, password_hash=password_hash,
            ).update(
                status=EmailOperation.Status.AWAITING_REVIEW if needs_review else EmailOperation.Status.COMPLETED,
                verified_at=now, token_digest="", password_hash="",
                expires_at=now + REVIEW_LIFETIME if needs_review else operation.expires_at,
            )
            if changed != 1:
                raise EmailFlowError("这条申请已经处理，请刷新页面查看结果。")
            if operation.kind == EmailOperation.Kind.REGISTRATION:
                user = get_user_model()(username=operation.username, password=password_hash)
                user.save()
                EmailOperation.objects.filter(pk=operation.pk).update(user=user)
            if not needs_review:
                _bind_email(user, operation.target_email, now,
                            expected_password_hash=password_hash if operation.kind == EmailOperation.Kind.REGISTRATION
                            else checked_password_hash)
        return _operation(operation)
    except IntegrityError:
        raise EmailFlowError("用户名或邮箱已经被使用，请重新申请。") from None
    except OperationalError:
        raise EmailFlowError("申请正在处理中，请稍后重试。") from None


@_database_errors
def cancel_operation(operation, user):
    _expire_operations()
    user = _user(user)
    current = _operation(operation)
    if current.user_id != user.pk:
        raise EmailFlowError("不能取消其他账号的邮箱申请。")
    changed = EmailOperation.objects.filter(pk=current.pk, user_id=user.pk, status__in=ACTIVE,
                                            expires_at__gt=timezone.now()).update(
        status=EmailOperation.Status.CANCELLED, token_digest="", password_hash="",
    )
    if changed != 1:
        raise EmailFlowError("这条申请已经处理，不能再次取消。")
    return _operation(current)


@_database_errors
def review_change(operation, reviewer, approve):
    _expire_operations()
    reviewer = _user(reviewer)
    if not reviewer.is_staff or not reviewer.has_perm("members.approve_email_change"):
        raise EmailFlowError("你没有审批邮箱变更的权限。")
    if not isinstance(approve, bool):
        raise EmailFlowError("请选择批准或拒绝。")
    current = _operation(operation)
    if current.kind != EmailOperation.Kind.CHANGE_EMAIL or current.status != EmailOperation.Status.AWAITING_REVIEW:
        raise EmailFlowError("只能审批已经验证新邮箱的变更申请。")
    try:
        with transaction.atomic():
            now = timezone.now()
            if approve:
                user = _user(current.user)
                _check_snapshot(current, user)
                _target_available(current.target_email, user.pk)
            changed = EmailOperation.objects.filter(
                pk=current.pk, kind=EmailOperation.Kind.CHANGE_EMAIL,
                status=EmailOperation.Status.AWAITING_REVIEW, verified_at__isnull=False, expires_at__gt=now,
            ).update(status=EmailOperation.Status.COMPLETED if approve else EmailOperation.Status.REJECTED,
                     token_digest="", password_hash="", reviewed_at=now, reviewed_by=reviewer)
            if changed != 1:
                raise EmailFlowError("申请状态已经变化，不能重复审批。")
            if approve:
                _bind_email(user, current.target_email, current.verified_at)
        return _operation(current)
    except IntegrityError:
        raise EmailFlowError("新邮箱已经被其他账号使用，不能批准这条申请。") from None
    except OperationalError:
        raise EmailFlowError("申请正在处理中，请稍后重试。") from None
