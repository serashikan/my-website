(() => {
    "use strict";
    const form = document.getElementById("email-verification-form");
    if (!form) return;
    const token = form.elements.namedItem("token");
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const supplied = fragment.get("token");
    if (supplied && supplied.length <= 512) token.value = supplied;
    // fragment 不随 HTTP 请求发送；读取后从地址栏与当前历史条目移除。
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!token.value) {
        document.getElementById("email-token-status").textContent = "未找到确认信息，请重新打开邮件中的完整链接。";
        form.querySelector('[type="submit"]').disabled = true;
    }
})();
