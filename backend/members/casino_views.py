"""账号自己的虚拟游戏存档；版本检查避免多设备静默覆盖。"""
import json
import math

from django.contrib.auth.decorators import login_required
from django.db import IntegrityError, OperationalError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.crypto import salted_hmac
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from .models import CasinoProgress
from .rate_limit import consume_limit

MAX_INTEGER = 9007199254740991


def integer(value, minimum=0, maximum=MAX_INTEGER):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError
    return value


def text(value, maximum=100):
    if not isinstance(value, str) or not 1 <= len(value) <= maximum:
        raise ValueError
    return value


def numbers(values, length, signed=False):
    if not isinstance(values, list) or len(values) != length:
        raise ValueError
    return [integer(value, -MAX_INTEGER if signed else 0) for value in values]


def validate_snapshot(data):
    if not isinstance(data, dict) or set(data) != {"challenge", "marbles", "vault"}:
        raise ValueError
    challenge = data["challenge"]
    if challenge is None:
        if data["marbles"] is not None or data["vault"] is not None:
            raise ValueError
        return data
    if not isinstance(challenge, dict) or challenge.get("status") not in ("ready", "active", "won", "lost"):
        raise ValueError
    challenge_id = challenge.get("id")
    if challenge_id is not None:
        text(challenge_id)
    elif challenge["status"] != "ready":
        raise ValueError
    result = {"id": challenge_id, "status": challenge["status"]}
    for field in ("chips", "rounds", "high", "attempt"):
        result[field] = integer(challenge[field])
    if result["high"] < result["chips"]:
        raise ValueError
    history = challenge["history"]
    if not isinstance(history, list) or len(history) > 12:
        raise ValueError
    result["history"] = [text(value, 200) for value in history]
    started = challenge["started"]
    result["started"] = integer(started) if started is not None else None
    pending = challenge["pending"]
    result["pending"] = None
    if pending is not None:
        result["pending"] = {"id": text(pending["id"]), "game": text(pending["game"], 50),
                             "amount": integer(pending["amount"], 1)}
    snapshot = {"challenge": result, "marbles": None, "vault": None}
    marbles = data["marbles"]
    if marbles is not None:
        if not isinstance(marbles, dict) or marbles.get("challengeId") != challenge_id:
            raise ValueError
        model = {"challengeId": challenge_id}
        for field in ("inventory", "launched", "lost", "wins"):
            model[field] = integer(marbles[field])
        model["queue"] = integer(marbles["queue"], 0, 1000)
        model["deepest"] = integer(marbles["deepest"], 0, 6)
        model["visits"] = numbers(marbles["visits"], 6)
        balls = marbles["balls"]
        if not isinstance(balls, list) or len(balls) > 60:
            raise ValueError
        model["balls"] = []
        for ball in balls:
            item = {"level": integer(ball["level"], 0, 5)}
            for field in ("x", "y", "vx", "vy", "age"):
                value = ball[field]
                if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1e12:
                    raise ValueError
                item[field] = value
            if not 0 <= item["x"] <= 360 or not 0 <= item["y"] <= 260 or item["age"] < 0:
                raise ValueError
            model["balls"].append(item)
        snapshot["marbles"] = model
    vault = data["vault"]
    if vault is not None:
        if not isinstance(vault, dict) or vault.get("challengeId") != challenge_id:
            raise ValueError
        last = vault["last"]
        if not isinstance(last, list) or len(last) > 12:
            raise ValueError
        snapshot["vault"] = {"challengeId": challenge_id,
            "safe": integer(vault["safe"]), "claims": integer(vault["claims"]),
            "net": integer(vault["net"], -MAX_INTEGER),
            "last": numbers(last, len(last), signed=True)}
    return snapshot


@never_cache
@login_required
@require_http_methods(["GET", "POST"])
def casino_progress(request):
    if request.method == "GET":
        progress = CasinoProgress.objects.filter(owner=request.user).first()
        return JsonResponse({"account_id": request.user.pk, "username": request.user.username,
            "csrf_token": get_token(request), "revision": progress.revision if progress else 0,
            "snapshot": progress.snapshot if progress else None})
    if request.content_type != "application/json":
        return JsonResponse({"error": "请以正确格式保存进度。"}, status=415)
    if len(request.body) > 65536:
        return JsonResponse({"error": "存档过大，未覆盖账号进度。"}, status=413)
    try:
        def reject_constant(value):
            raise ValueError
        data = json.loads(request.body, parse_constant=reject_constant)
        if not isinstance(data, dict):
            raise ValueError
        account_id = integer(data["account_id"], 1)
        revision = integer(data["revision"], 0, MAX_INTEGER - 1)
        snapshot = validate_snapshot(data["snapshot"])
    except (ValueError, TypeError, KeyError, UnicodeDecodeError, RecursionError):
        return JsonResponse({"error": "存档格式不正确，原有进度已保留。"}, status=400)
    if account_id != request.user.pk:
        return JsonResponse({"error": "登录账号已经变化，请重新打开挑战。"}, status=403)
    digest = salted_hmac("members.casino-save", str(request.user.pk)).hexdigest()
    if not consume_limit(f"casino-save:{digest}", 120, 60):
        response = JsonResponse({"error": "保存较频繁，正在等待重试。"}, status=429)
        response["Retry-After"] = "60"
        return response
    try:
        with transaction.atomic():
            if revision == 0:
                CasinoProgress.objects.create(owner=request.user, snapshot=snapshot, revision=1)
            elif CasinoProgress.objects.filter(owner=request.user, revision=revision).update(
                snapshot=snapshot, revision=revision + 1, updated_at=timezone.now(),
            ) != 1:
                return JsonResponse({"error": "另一个页面已更新进度，请重新读取账号存档。"}, status=409)
    except IntegrityError:
        return JsonResponse({"error": "账号已有新进度，请重新读取存档。"}, status=409)
    except OperationalError:
        return JsonResponse({"error": "保存暂时繁忙，请稍后重试。"}, status=503)
    return JsonResponse({"revision": revision + 1, "account_id": request.user.pk})
