(() => {
    "use strict";
    const nav = document.createElement("nav");
    nav.className = "site-account-nav";
    nav.setAttribute("aria-label", "账号导航");
    const topBar = document.querySelector(".top-bar");
    if (topBar) topBar.append(nav);
    else { nav.classList.add("is-floating"); document.body.append(nav); }

    const room = document.createElement("a");
    room.href = "/account/";
    room.textContent = "我的小屋";
    nav.append(room);
    const account = document.createElement("a");
    account.href = "/account/info/";
    account.textContent = "账户信息";
    nav.append(account);

    fetch("/api/session/", { credentials: "same-origin", cache: "no-store" })
        .then(response => {
            if (!response.ok || response.redirected) throw new Error("Session unavailable");
            return response.json();
        })
        .then(session => {
            const greeting = document.createElement("span");
            greeting.className = "site-account-name";
            greeting.textContent = session.username;
            greeting.title = session.username;
            nav.prepend(greeting);
            const form = document.createElement("form");
            form.method = "post";
            form.action = "/accounts/logout/";
            const token = document.createElement("input");
            token.type = "hidden";
            token.name = "csrfmiddlewaretoken";
            token.value = session.csrf_token;
            const logout = document.createElement("button");
            logout.type = "submit";
            logout.textContent = "退出";
            form.append(token, logout);
            nav.append(form);
        })
        .catch(() => { room.textContent = "重新登录"; room.href = "/accounts/login/"; });
})();
