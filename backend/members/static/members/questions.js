(() => {
    "use strict";

    const mounted = new WeakMap();
    let instanceNumber = 0;

    class RequestError extends Error {
        constructor(message, options = {}) {
            super(message);
            this.login = Boolean(options.login);
            this.errors = options.errors || null;
            this.uncertain = Boolean(options.uncertain);
        }
    }

    async function requestJSON(url, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            let response;
            try {
                response = await fetch(url, {
                    ...options, credentials: "same-origin", cache: "no-store", signal: controller.signal,
                });
            } catch (error) {
                throw new RequestError(
                    error.name === "AbortError" ? "连接超时，请稍后再试。" : "暂时连不上服务器，请检查网络后重试。",
                    { uncertain: options.method === "POST" },
                );
            }
            if (response.redirected || response.status === 401 || response.status === 403) {
                throw new RequestError("登录状态可能已经变化，请重新登录后再试。", { login: true });
            }
            if (response.status === 429) {
                const seconds = Number(response.headers.get("Retry-After"));
                const wait = Number.isFinite(seconds) && seconds > 0
                    ? (seconds < 60 ? `${Math.ceil(seconds)} 秒` : `${Math.ceil(seconds / 60)} 分钟`)
                    : "一会儿";
                throw new RequestError(`操作有些频繁，请等${wait}后再试。`);
            }
            let data;
            try {
                if (!(response.headers.get("Content-Type") || "").includes("application/json")) {
                    throw new Error("Unexpected content type");
                }
                data = await response.json();
            } catch (_) {
                throw new RequestError("服务器暂时没有返回可用的结果，请稍后重试。", {
                    uncertain: options.method === "POST",
                });
            }
            if (!response.ok) {
                const errorData = data && typeof data === "object" ? data : {};
                throw new RequestError(
                    response.status === 400 && typeof errorData.error === "string"
                        ? errorData.error : "服务器暂时无法处理这次请求，请稍后重试。",
                    { errors: response.status === 400 ? errorData.errors : null },
                );
            }
            return data;
        } finally {
            clearTimeout(timeout);
        }
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function status(node, message = "", options = {}) {
        node.replaceChildren();
        node.classList.toggle("is-error", Boolean(options.error));
        node.classList.toggle("is-success", Boolean(options.success));
        node.setAttribute("role", options.error ? "alert" : "status");
        node.append(document.createTextNode(message));
        if (options.login) {
            const link = element("a", "nq-status-link", "重新登录（新标签页）");
            link.href = "/accounts/login/";
            link.target = "_blank";
            link.rel = "noopener";
            node.append(" ", link);
        }
        if (options.retry) {
            const button = element("button", "nq-text-button", "重试");
            button.type = "button";
            button.addEventListener("click", options.retry);
            node.append(" ", button);
        }
    }

    function displayTime(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleString("zh-CN", {
            year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
        });
    }

    function renderCards(state, items) {
        const fragment = document.createDocumentFragment();
        if (!items.length) {
            fragment.append(element("p", "nq-empty", state.scope === "public"
                ? "还没有审核展示的问答。想问的事，可以先写在上面。"
                : "还没有提问。想问的事，可以写在上面。"));
        }
        items.forEach((item, index) => {
            const answered = typeof item.answer === "string" && item.answer.trim().length > 0;
            const visibility = ["anonymous", "named", "private"].includes(item.visibility) ? item.visibility : "private";
            let progress;
            if (state.scope === "public") progress = visibility === "named" ? "署名展示" : "匿名展示";
            else if (visibility === "private") progress = "仅站主可见";
            else if (item.is_public === true) progress = visibility === "named" ? "已展示 · 署名" : "已展示 · 匿名";
            else progress = answered ? "已回复，未展示" : "待审核";
            const card = element("details", "nq-card");
            card.open = index === 0;
            const summary = element("summary", "nq-card-summary");
            summary.append(
                element("span", "nq-card-title", item.title),
                element("span", `nq-badge${answered ? " is-answered" : ""}`, progress),
            );
            const content = element("div", "nq-card-content");
            const created = displayTime(item.created_at);
            const author = state.scope === "mine" ? "你" : (typeof item.author === "string" ? item.author : "一位朋友");
            content.append(element("p", "nq-meta", `${author}${created ? ` · 提交于 ${created}` : ""}`));
            content.append(element("p", "nq-card-label", state.scope === "mine" ? "你的提问" : "提问"));
            content.append(element("div", "nq-body", item.body));
            const answer = element("section", `nq-answer${answered ? "" : " is-pending"}`);
            answer.append(element("h4", "nq-card-label", "站主回复"));
            answer.append(element("div", "nq-body", answered ? item.answer : "已收到。站主回复后，会显示在这里。"));
            const answeredAt = answered && displayTime(item.answered_at);
            if (answeredAt) answer.append(element("p", "nq-meta", `回复于 ${answeredAt}`));
            content.append(answer);
            card.append(summary, content);
            fragment.append(card);
        });
        state.list.replaceChildren(fragment);
    }

    function updatePagination(state) {
        state.refresh.disabled = state.loading;
        state.previous.disabled = state.loading || !state.hasPrevious;
        state.next.disabled = state.loading || !state.hasNext;
        state.pagination.hidden = state.pages <= 1;
        state.pageLabel.textContent = `第 ${state.page} / ${state.pages} 页`;
        state.list.setAttribute("aria-busy", String(state.loading));
    }

    async function loadQuestions(state, page) {
        const requestId = ++state.requestId;
        const scope = state.scope;
        state.loading = true;
        status(state.listStatus, scope === "public" ? "正在读取问答……" : "正在读取你的小信……");
        updatePagination(state);
        try {
            const data = await requestJSON(`/api/questions/?scope=${scope}&page=${encodeURIComponent(page)}`);
            if (requestId !== state.requestId) return;
            if (!data || !Array.isArray(data.items) || !Number.isInteger(data.page) || data.page < 1
                || !Number.isInteger(data.pages) || data.pages < 1
                || !data.items.every(item => item && typeof item.title === "string" && typeof item.body === "string")) {
                throw new RequestError("暂时无法读取提问列表，请重试。");
            }
            state.page = data.page;
            state.pages = data.pages;
            state.hasPrevious = Boolean(data.has_previous);
            state.hasNext = Boolean(data.has_next);
            state.count.textContent = Number.isInteger(data.total) ? `${data.total} 条` : "";
            renderCards(state, data.items);
            status(state.listStatus);
        } catch (error) {
            if (requestId !== state.requestId) return;
            status(state.listStatus, error.message || "暂时无法读取提问，请重试。", {
                error: true, login: error.login, retry: () => loadQuestions(state, page),
            });
        } finally {
            if (requestId === state.requestId) {
                state.loading = false;
                updatePagination(state);
            }
        }
    }

    function selectScope(state, scope) {
        state.scope = scope;
        state.page = 1;
        state.pages = 1;
        state.hasPrevious = false;
        state.hasNext = false;
        state.count.textContent = "";
        // 切换范围时先移除旧卡片，避免私密提问短暂出现在展示标签下。
        state.list.replaceChildren();
        state.listNote.textContent = scope === "public"
            ? "这里展示经站主审核并回复的问答，本站其他已登录用户也能看到。"
            : "查看自己的提问、站主回复和展示进度。未展示的问题仅你与站主可见。";
        state.tabs.forEach(tab => {
            const selected = tab.dataset.scope === scope;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
            if (selected) state.panel.setAttribute("aria-labelledby", tab.id);
        });
        return loadQuestions(state, 1);
    }

    function applySession(state, session) {
        state.admin.hidden = !session || session.is_staff !== true;
        state.namedOption.textContent = session && typeof session.username === "string"
            ? `署名展示（${session.username}）` : "署名展示（当前昵称）";
    }

    function fieldError(state, name, messages) {
        const field = state.form.elements.namedItem(name);
        const error = state.root.querySelector(`[data-error="${name}"]`);
        const text = Array.isArray(messages) ? messages.filter(value => typeof value === "string").join(" ") : "";
        error.textContent = text;
        error.hidden = !text;
        if (text) field.setAttribute("aria-invalid", "true");
        else field.removeAttribute("aria-invalid");
    }

    async function submitQuestion(state, event) {
        event.preventDefault();
        if (state.submitting) return;
        fieldError(state, "title", []);
        fieldError(state, "body", []);
        fieldError(state, "visibility", []);
        const payload = {
            title: state.form.elements.title.value.trim(),
            body: state.form.elements.body.value.trim(),
            visibility: state.form.elements.visibility.value,
        };
        for (const name of ["title", "body"]) {
            if (!payload[name]) {
                fieldError(state, name, [name === "title" ? "请填写一个标题。" : "请写下想问的事。"]);
                state.form.elements.namedItem(name).focus();
                return;
            }
        }
        if (!["anonymous", "named", "private"].includes(payload.visibility)) {
            fieldError(state, "visibility", ["请选择一种展示方式。"]);
            state.form.elements.visibility.focus();
            return;
        }
        state.submitting = true;
        state.form.setAttribute("aria-busy", "true");
        state.fields.disabled = true;
        state.submit.textContent = "正在送出……";
        status(state.formStatus, "正在提交，请稍等。");
        try {
            // 每次提交前取新令牌，以兼容在另一个标签页重新登录后的会话。
            const session = await requestJSON("/api/session/");
            if (!session || typeof session.csrf_token !== "string" || !session.csrf_token) {
                throw new RequestError("暂时无法确认登录状态，请重新登录后再试。", { login: true });
            }
            applySession(state, session);
            const data = await requestJSON("/api/questions/", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-CSRFToken": session.csrf_token },
                body: JSON.stringify(payload),
            });
            if (!data || !data.question || typeof data.question !== "object") {
                throw new RequestError("服务器没有确认提交结果。", { uncertain: true });
            }
            state.form.reset();
            status(state.formStatus, payload.visibility === "private"
                ? "提问已收到。仅你和站主可见，回复会显示在“我的提问”。"
                : "提问已收到，站主审核并回复后才会展示。可在“我的提问”查看进度。", { success: true });
            await selectScope(state, "mine");
        } catch (error) {
            if (error.errors && typeof error.errors === "object") {
                fieldError(state, "title", error.errors.title);
                fieldError(state, "body", error.errors.body);
                fieldError(state, "visibility", error.errors.visibility);
            }
            const message = error.uncertain
                ? "未能确认是否提交成功。请先到“我的提问”刷新确认，再重试；输入已保留。"
                : `${error.message || "提交暂时没有成功，请重试。"} 输入已保留。`;
            status(state.formStatus, message, { error: true, login: error.login });
        } finally {
            state.submitting = false;
            state.form.setAttribute("aria-busy", "false");
            state.fields.disabled = false;
            state.submit.textContent = "送出提问";
            const invalid = state.form.querySelector('[aria-invalid="true"]');
            if (invalid) invalid.focus();
        }
    }

    function mount(root) {
        if (!root || mounted.has(root)) return;
        const prefix = `sera-question-${++instanceNumber}`;
        root.classList.add("native-questions");
        // 此结构只含固定文案；服务器返回的标题、正文和回复均通过 textContent 渲染。
        root.innerHTML = `
            <section class="nq-intro">
                <p class="nq-eyebrow">留一封小信</p>
                <h2 class="nq-heading">提问与回答</h2>
                <p class="nq-lead">角色设定、故事里的情节，或这个网站本身，都可以问我。我会尽量回复。</p>
                <p class="nq-privacy">可选择匿名、署名或仅站主可见；展示前会先由站主审核并回复。</p>
            </section>
            <form class="nq-form">
                <fieldset class="nq-fields">
                    <legend class="nq-sr-only">写下你的提问</legend>
                    <label for="${prefix}-title">想问什么？<span class="nq-limit">最多 120 字</span></label>
                    <input id="${prefix}-title" name="title" type="text" required maxlength="120"
                        placeholder="给这封小信起个标题" aria-describedby="${prefix}-title-error">
                    <p id="${prefix}-title-error" data-error="title" class="nq-field-error" hidden></p>
                    <label for="${prefix}-body">详细说说<span class="nq-limit">最多 2000 字</span></label>
                    <textarea id="${prefix}-body" name="body" required maxlength="2000" rows="6"
                        placeholder="把想问的事写在这里……" aria-describedby="${prefix}-body-error"></textarea>
                    <p id="${prefix}-body-error" data-error="body" class="nq-field-error" hidden></p>
                    <label for="${prefix}-visibility">展示方式</label>
                    <select id="${prefix}-visibility" name="visibility"
                        aria-describedby="${prefix}-visibility-help ${prefix}-visibility-error">
                        <option value="anonymous" selected>匿名展示</option>
                        <option value="named">署名展示（当前昵称）</option>
                        <option value="private">仅站主可见</option>
                    </select>
                    <p class="nq-visibility-help" id="${prefix}-visibility-help">提交后先由站主查看。选择匿名或署名，表示允许站主审核并回复后，将问题和回复展示给其他本站登录用户。匿名只对其他访客隐藏署名，站主仍能看到提问账号。</p>
                    <p id="${prefix}-visibility-error" data-error="visibility" class="nq-field-error" hidden></p>
                    <div class="nq-form-actions"><button type="submit" class="nq-primary">送出提问</button></div>
                </fieldset>
                <p class="nq-status" data-role="form-status" role="status" aria-live="polite" aria-atomic="true"></p>
            </form>
            <section class="nq-inbox" aria-labelledby="${prefix}-inbox-heading">
                <div class="nq-section-heading">
                    <h3 id="${prefix}-inbox-heading">问答与回复 <span class="nq-count" data-role="count"></span></h3>
                    <div class="nq-list-actions">
                        <a class="nq-admin" href="/admin/members/question/" hidden>管理提问</a>
                        <button type="button" class="nq-secondary" data-role="refresh">刷新</button>
                    </div>
                </div>
                <div class="nq-tabs" role="tablist" aria-label="问答范围">
                    <button type="button" class="nq-tab" role="tab" id="${prefix}-public-tab"
                        aria-controls="${prefix}-panel" aria-selected="true" data-scope="public">问答展示</button>
                    <button type="button" class="nq-tab" role="tab" id="${prefix}-mine-tab"
                        aria-controls="${prefix}-panel" aria-selected="false" tabindex="-1" data-scope="mine">我的提问</button>
                </div>
                <div class="nq-panel" id="${prefix}-panel" role="tabpanel"
                    aria-labelledby="${prefix}-public-tab" tabindex="0">
                <p class="nq-list-note" data-role="list-note"></p>
                <p class="nq-status" data-role="list-status" role="status" aria-live="polite" aria-atomic="true"></p>
                <div class="nq-list" data-role="list"></div>
                <nav class="nq-pagination" aria-label="提问分页" hidden>
                    <button type="button" class="nq-secondary" data-role="previous">上一页</button>
                    <span data-role="page-label"></span>
                    <button type="button" class="nq-secondary" data-role="next">下一页</button>
                </nav>
                </div>
            </section>`;
        const role = name => root.querySelector(`[data-role="${name}"]`);
        const state = {
            root, form: root.querySelector("form"), fields: root.querySelector("fieldset"),
            submit: root.querySelector('[type="submit"]'), formStatus: role("form-status"),
            listStatus: role("list-status"), list: role("list"), count: role("count"),
            refresh: role("refresh"), previous: role("previous"), next: role("next"),
            pageLabel: role("page-label"), pagination: root.querySelector(".nq-pagination"),
            tabs: [...root.querySelectorAll(".nq-tab")], panel: root.querySelector(".nq-panel"),
            listNote: role("list-note"), namedOption: root.querySelector('option[value="named"]'), scope: "public",
            admin: root.querySelector(".nq-admin"), page: 1, pages: 1,
            hasPrevious: false, hasNext: false, loading: false, submitting: false, requestId: 0,
        };
        mounted.set(root, state);
        state.form.addEventListener("submit", event => submitQuestion(state, event));
        state.refresh.addEventListener("click", () => loadQuestions(state, state.page));
        state.previous.addEventListener("click", () => loadQuestions(state, state.page - 1));
        state.next.addEventListener("click", () => loadQuestions(state, state.page + 1));
        state.tabs.forEach((tab, index) => {
            tab.addEventListener("click", () => selectScope(state, tab.dataset.scope));
            tab.addEventListener("keydown", event => {
                const targets = { ArrowLeft: 1 - index, ArrowRight: 1 - index, Home: 0, End: state.tabs.length - 1 };
                if (!Object.prototype.hasOwnProperty.call(targets, event.key)) return;
                event.preventDefault();
                const nextTab = state.tabs[targets[event.key]];
                nextTab.focus();
                selectScope(state, nextTab.dataset.scope);
            });
        });
        for (const name of ["title", "body"]) {
            state.form.elements.namedItem(name).addEventListener("input", () => fieldError(state, name, []));
        }
        state.form.elements.visibility.addEventListener("change", () => fieldError(state, "visibility", []));
        selectScope(state, "public");
        requestJSON("/api/session/").then(session => {
            applySession(state, session);
        }).catch(() => { /* 列表和提交操作会分别展示登录或网络错误。 */ });
    }

    window.SeraQuestions = { mount };
    // 用户若在 defer 脚本下载前已打开问答，脚本就绪后补挂载。
    const mountOpenedSection = () => {
        const root = document.getElementById("qa");
        if (window.SERA_NATIVE_QUESTIONS && location.hash === "#qa") {
            const menu = document.querySelector('.menu a[data-target="qa"]');
            if (menu) menu.click();
        }
        if (window.SERA_NATIVE_QUESTIONS && root && root.classList.contains("active")) mount(root);
    };
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mountOpenedSection, { once: true });
    } else {
        mountOpenedSection();
    }
})();
