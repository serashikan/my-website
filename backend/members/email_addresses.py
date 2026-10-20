from django.core.exceptions import ValidationError
from django.core.validators import validate_email


def normalize_email(value):
    """本站邮箱不区分大小写；域名转为同一个 IDNA 表示，不合并邮箱别名。"""
    if not isinstance(value, str):
        raise ValidationError("请输入有效的邮箱地址。")
    value = value.strip()
    try:
        local, domain = value.rsplit("@", 1)
        value = f"{local.lower()}@{domain.encode('idna').decode('ascii').lower()}"
    except (ValueError, UnicodeError):
        raise ValidationError("请输入有效的邮箱地址。") from None
    if len(value) > 254:
        raise ValidationError("邮箱地址不能超过 254 个字符。")
    try:
        validate_email(value)
    except ValidationError:
        raise ValidationError("请输入有效的邮箱地址。") from None
    return value
