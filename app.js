(function () {
  "use strict";

  const API_URL =
    "https://script.google.com/macros/s/AKfycbxD4YVp1TUW6uZmbZHgsp6XJiKWUOk7k-BqwzHMYiYeFu3CbFcYWnDD9y-5w1Go7xOSsA/exec";
  const QUEUE_STORAGE_KEY = "impr-checkin-pending-v1";
  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 900;
  const LOOKUP_CACHE_KEY = "impr-checkin-lookup-v1";
  const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;

  const EVENTS = {
    sig206: {
      name: "2026 科技主權論壇",
      description: "會議報到、伴手禮與午餐領取",
      apiUrl: API_URL,
    },
    forum: {
      name: "2026 科技主權論壇",
      description: "第二會議報到、伴手禮與午餐領取",
      apiUrl: API_URL,
    },
  };

  const app = document.getElementById("app");
  const state = {
    eventKey: "sig206",
    eventName: EVENTS.sig206.name,
    mode: "checkin",
    scannerControls: null,
    handled: false,
    lastScannedId: "",
    lastScannedAt: 0,
    pendingQueue: [],
    queueTimer: 0,
    syncingQueue: false,
    retryDelay: 2000,
    lastQueuedClientId: "",
    dashboardPin: "",
    dashboardRows: [],
    dashboardFilter: "attended",
    dashboardQuery: "",
    selectedBadgeIds: new Set(),
    lookupRows: [],
    lookupReady: false,
    lookupLoadPromise: null,
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pageUrl(params) {
    const url = new URL(window.location.href);
    url.search = "";
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
    return url.toString();
  }

  function jsonp(apiUrl, parameters) {
    return new Promise((resolve, reject) => {
      const callback = `imprCb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("後台回應逾時"));
      }, 15000);

      function cleanup() {
        window.clearTimeout(timeout);
        script.remove();
        try {
          delete window[callback];
        } catch (_) {
          window[callback] = undefined;
        }
      }

      window[callback] = (payload) => {
        cleanup();
        resolve(payload || {});
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("無法連線至活動後台"));
      };

      const url = new URL(apiUrl);
      Object.entries({ ...parameters, callback, t: Date.now() }).forEach(
        ([key, value]) => url.searchParams.set(key, String(value)),
      );
      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  function frameApi(apiUrl, parameters) {
    return new Promise((resolve, reject) => {
      const requestId = `imprFrame_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const iframe = document.createElement("iframe");
      iframe.hidden = true;
      iframe.setAttribute("aria-hidden", "true");
      iframe.title = "活動後台連線";

      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("後台回應逾時"));
      }, 20000);

      function cleanup() {
        window.clearTimeout(timeout);
        window.removeEventListener("message", receiveMessage);
        iframe.remove();
      }

      function receiveMessage(event) {
        const data = event.data;
        if (
          !data ||
          data.source !== "impr-checkin-api" ||
          data.requestId !== requestId
        ) return;
        cleanup();
        resolve(data.payload || {});
      }

      window.addEventListener("message", receiveMessage);
      iframe.onerror = () => {
        cleanup();
        reject(new Error("無法連線至活動後台"));
      };

      const url = new URL(apiUrl);
      Object.entries({
        ...parameters,
        transport: "frame",
        requestId,
        t: Date.now(),
      }).forEach(([key, value]) => url.searchParams.set(key, String(value)));
      iframe.src = url.toString();
      document.body.appendChild(iframe);
    });
  }

  function callApi(action, params = {}, eventKey = state.eventKey) {
    const event = EVENTS[eventKey] || EVENTS.sig206;
    if (action === "config") {
      return jsonp(event.apiUrl, { action, ...params });
    }
    const url = new URL(event.apiUrl);
    Object.entries({ action, ...params, t: Date.now() }).forEach(
      ([key, value]) => url.searchParams.set(key, String(value)),
    );
    return fetch(url.toString(), {
      cache: "no-store",
      mode: "cors",
      redirect: "follow",
    }).then((response) => {
      if (!response.ok) throw new Error(`後台回應錯誤（${response.status}）`);
      return response.json();
    });
  }

  function footer() {
    return '<div class="footer">GitHub Pages 安全連線 · 不需登入 Google 帳號</div>';
  }

  async function loadConfig() {
    try {
      const payload = await callApi("config", {}, "sig206");
      const eventName = String(payload.eventName || "").trim();
      return {
        eventName: eventName || EVENTS.sig206.name,
        showSecondaryEvent: payload.showSecondaryEvent === true,
      };
    } catch (_) {
      return {
        eventName: EVENTS.sig206.name,
        showSecondaryEvent: false,
      };
    }
  }

  function renderChooser(config) {
    const visibleKeys = config.showSecondaryEvent
      ? ["sig206", "forum"]
      : ["sig206"];

    const cards = visibleKeys
      .map((key) => {
        const event = EVENTS[key];
        const name = key === "sig206" ? config.eventName : event.name;
        return `
          <a class="event-option" href="${escapeHtml(pageUrl({ event: key }))}">
            <span>進入報到</span>
            <strong>${escapeHtml(name)}</strong>
            <small>${escapeHtml(event.description)}</small>
          </a>`;
      })
      .join("");

    app.innerHTML = `
      <section class="checkin-card">
        <img class="brand-logo" src="./impr-logo.png" alt="iMPR 新加坡公眾關係顧問服務有限公司" />
        <div class="eyebrow"><span class="signal-dot"></span>活動行動報到</div>
        <h1>請選擇會議</h1>
        <p class="message">選擇後可掃描 QR Code、查詢姓名／公司或手動輸入序號。</p>
        <div class="event-list">${cards}</div>
        <a class="staff-entry" href="${escapeHtml(pageUrl({ event: "sig206", view: "dashboard" }))}">
          <span>工作人員專用</span>
          <strong>查看現場清單與出席統計</strong>
        </a>
      </section>
      ${footer()}`;
  }

  function renderEventPage(eventKey, eventName) {
    state.eventKey = eventKey;
    state.eventName = eventName;

    app.innerHTML = `
      <section class="checkin-card">
        <img class="brand-logo" src="./impr-logo.png" alt="iMPR 新加坡公眾關係顧問服務有限公司" />
        <div class="eyebrow"><span class="signal-dot"></span>手機快速報到</div>
        <div class="page-links">
          <a class="change-event" href="${escapeHtml(pageUrl({}))}">切換會議</a>
          <a class="change-event" href="${escapeHtml(pageUrl({ event: eventKey, view: "dashboard" }))}">現場清單</a>
        </div>
        <h1>${escapeHtml(eventName)}</h1>
        <p class="message">可搜尋姓名或公司、手動輸入序號，或使用手機相機掃描 QR Code。</p>

        <div id="status-panel" class="status-panel hidden" role="status">
          <strong id="status-title"></strong>
          <p id="status-message"></p>
        </div>

        <fieldset class="mode-picker" id="mode-picker">
          <legend>請先選擇本次掃描用途</legend>
          <label class="mode-option is-selected">
            <input type="radio" name="mode" value="checkin" checked />
            <span class="mode-icon">✓</span><span>活動報到</span>
          </label>
          <label class="mode-option">
            <input type="radio" name="mode" value="gift" />
            <span class="mode-icon">◆</span><span>伴手禮</span>
          </label>
          <label class="mode-option">
            <input type="radio" name="mode" value="lunch" />
            <span class="mode-icon">☕</span><span>午餐</span>
          </label>
        </fieldset>

        <div class="tools">
          <form class="tool-block" id="lookup-form">
            <label for="lookup-input">姓名或公司查詢</label>
            <div class="input-row">
              <input id="lookup-input" type="search" maxlength="80" placeholder="輸入任一文字，例如：王、銀行" autocomplete="off" />
              <button id="lookup-button" class="small-button" type="submit">查詢</button>
            </div>
            <div class="lookup-cache-row">
              <small id="lookup-cache-status" class="lookup-cache-status">正在背景同步名單；同步期間仍可查詢。</small>
              <button id="lookup-refresh" type="button">更新名單</button>
            </div>
            <div id="lookup-results" class="lookup-results"></div>
          </form>

          <form class="tool-block" id="manual-form">
            <label for="manual-input">直接輸入報到序號</label>
            <div class="input-row">
              <input id="manual-input" type="text" maxlength="80" placeholder="例如 SPK-001" autocapitalize="characters" autocomplete="off" />
              <button class="small-button" type="submit">確認登記</button>
            </div>
          </form>
        </div>

        <div class="method-divider"><span>或掃描 QR Code</span></div>
        <div id="camera-frame" class="camera-frame">
          <video id="camera-video" muted playsinline aria-label="QR Code 相機預覽"></video>
          <span class="scan-line"></span>
          <p id="camera-hint" class="camera-hint">掃描活動報到</p>
          <div id="result-overlay" class="result-overlay hidden" role="status">
            <strong id="overlay-title"></strong>
            <span id="overlay-message"></span>
            <code id="overlay-id"></code>
          </div>
        </div>
        <button id="scanner-button" class="primary-button" type="button">▣　開啟相機掃描</button>
        <p id="scanner-error" class="error-text hidden" role="alert"></p>
      </section>
      ${footer()}`;

    bindEventPage();
  }

  function renderDashboardPage(eventKey, eventName) {
    state.eventKey = eventKey;
    state.eventName = eventName;
    app.classList.add("dashboard-page");
    app.innerHTML = `
      <section class="dashboard-card">
        <header class="dashboard-header">
          <div class="dashboard-brand">
            <img class="dashboard-logo" src="./impr-logo.png" alt="iMPR 新加坡公眾關係顧問服務有限公司" />
            <div>
              <div class="eyebrow"><span class="signal-dot"></span>現場人員快速管理</div>
              <h1>${escapeHtml(eventName)}</h1>
            </div>
          </div>
          <a class="dashboard-back" href="${escapeHtml(pageUrl({ event: eventKey }))}">返回報到</a>
        </header>

        <section id="dashboard-login" class="dashboard-login">
          <div class="dashboard-login-icon" aria-hidden="true">✓</div>
          <h2>開啟現場清單</h2>
          <p>請輸入活動設定中的「現場管理 PIN」。</p>
          <form id="dashboard-login-form" class="dashboard-login-form">
            <label for="dashboard-pin">管理 PIN</label>
            <div class="input-row">
              <input id="dashboard-pin" type="password" inputmode="numeric" maxlength="12" autocomplete="off" required />
              <button id="dashboard-login-button" class="small-button" type="submit">開啟清單</button>
            </div>
          </form>
          <p id="dashboard-login-error" class="error-text hidden" role="alert"></p>
        </section>

        <section id="dashboard-content" class="dashboard-content hidden">
          <div class="dashboard-stats" aria-label="出席統計">
            <article><span>已報到</span><strong id="stat-attended">0</strong></article>
            <article><span>未報到</span><strong id="stat-not-attended">0</strong></article>
            <article><span>午餐已領</span><strong id="stat-lunch">0</strong></article>
            <article><span>伴手禮已領</span><strong id="stat-gift">0</strong></article>
          </div>

          <div class="dashboard-controls">
            <label class="dashboard-search" for="dashboard-search">
              <span>搜尋姓名、公司或序號</span>
              <input id="dashboard-search" type="search" placeholder="輸入任一文字" autocomplete="off" />
            </label>
            <button id="dashboard-refresh" class="refresh-button" type="button">重新整理</button>
          </div>

          <div class="dashboard-filters" aria-label="清單篩選">
            <button class="is-selected" type="button" data-filter="attended">報到</button>
            <button type="button" data-filter="not-attended">沒報到</button>
            <button type="button" data-filter="lunch">已領午餐</button>
            <button type="button" data-filter="gift">已領伴手禮</button>
          </div>

          <div class="dashboard-batch-bar">
            <div>
              <strong id="dashboard-selected-count">尚未選取</strong>
              <span id="dashboard-badge-total">點選人員加入識別證批次</span>
            </div>
            <div class="dashboard-batch-actions">
              <button id="dashboard-clear-selection" type="button" disabled>取消選取</button>
              <button id="dashboard-submit-batch" type="button" disabled>OK 批次寫入</button>
            </div>
          </div>

          <div class="dashboard-list-meta">
            <strong id="dashboard-count">0 筆</strong>
            <span id="dashboard-updated-at"></span>
          </div>
          <p id="dashboard-message" class="dashboard-message hidden" role="status"></p>
          <div id="dashboard-list" class="dashboard-list"></div>
        </section>
      </section>
      ${footer()}`;

    document.getElementById("dashboard-login-form").addEventListener("submit", (event) => {
      event.preventDefault();
      loadDashboard(document.getElementById("dashboard-pin").value);
    });
    document.getElementById("dashboard-search").addEventListener("input", (event) => {
      state.dashboardQuery = event.target.value.trim().toLowerCase();
      renderDashboardList();
    });
    document.getElementById("dashboard-refresh").addEventListener("click", () => {
      loadDashboard(state.dashboardPin, true);
    });
    document.getElementById("dashboard-clear-selection").addEventListener("click", () => {
      state.selectedBadgeIds.clear();
      renderDashboardList();
    });
    document.getElementById("dashboard-submit-batch").addEventListener("click", submitBadgeBatch);
    document.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.dashboardFilter = button.dataset.filter;
        document.querySelectorAll("[data-filter]").forEach((item) => {
          item.classList.toggle("is-selected", item === button);
        });
        renderDashboardList();
      });
    });
  }

  async function loadDashboard(pin, refreshing = false) {
    const normalizedPin = String(pin || "").trim();
    const loginButton = document.getElementById("dashboard-login-button");
    const refreshButton = document.getElementById("dashboard-refresh");
    const error = document.getElementById("dashboard-login-error");
    const activeButton = refreshing ? refreshButton : loginButton;
    if (!normalizedPin) return;

    activeButton.disabled = true;
    activeButton.textContent = refreshing ? "更新中…" : "讀取中…";
    error.classList.add("hidden");
    try {
      const payload = await callApi("dashboard", { pin: normalizedPin });
      if (!payload.success || !Array.isArray(payload.results)) {
        throw new Error(payload.message || "無法讀取現場清單");
      }
      state.dashboardPin = normalizedPin;
      state.dashboardRows = payload.results;
      state.selectedBadgeIds.clear();
      document.getElementById("dashboard-login").classList.add("hidden");
      document.getElementById("dashboard-content").classList.remove("hidden");
      document.getElementById("dashboard-updated-at").textContent = payload.updatedAt
        ? `更新：${payload.updatedAt}`
        : "";
      renderDashboardStats();
      renderDashboardList();
      if (refreshing) setDashboardMessage("清單已更新。", false);
    } catch (requestError) {
      if (refreshing) {
        setDashboardMessage(requestError.message || "更新失敗，請稍後再試。", true);
      } else {
        error.textContent = requestError.message || "PIN 不正確或後台暫時無法連線。";
        error.classList.remove("hidden");
      }
    } finally {
      activeButton.disabled = false;
      activeButton.textContent = refreshing ? "重新整理" : "開啟清單";
    }
  }

  function renderDashboardStats() {
    const total = state.dashboardRows.length;
    const attended = state.dashboardRows.filter((row) => row.attended === "是").length;
    const lunchReceived = state.dashboardRows.filter((row) => row.lunchReceived === "是").length;
    const giftReceived = state.dashboardRows.filter((row) => row.giftReceived === "是").length;
    const badgeReceived = state.dashboardRows.filter((row) => row.badgeReceived === "是").length;
    document.getElementById("stat-attended").textContent = attended;
    document.getElementById("stat-not-attended").textContent = Math.max(0, total - attended);
    document.getElementById("stat-lunch").textContent = lunchReceived;
    document.getElementById("stat-gift").textContent = giftReceived;
    document.getElementById("dashboard-badge-total").textContent = `識別證已領 ${badgeReceived} 人`;
  }

  function renderDashboardList() {
    const list = document.getElementById("dashboard-list");
    if (!list) return;
    const rows = state.dashboardRows.filter((row) => {
      const attended = row.attended === "是";
      const filterMatches =
        (state.dashboardFilter === "attended" && attended) ||
        (state.dashboardFilter === "not-attended" && !attended) ||
        (state.dashboardFilter === "lunch" && row.lunchReceived === "是") ||
        (state.dashboardFilter === "gift" && row.giftReceived === "是");
      const haystack = [row.id, row.name, row.company, row.title]
        .join("\n")
        .toLowerCase();
      return filterMatches && (!state.dashboardQuery || haystack.includes(state.dashboardQuery));
    });

    document.getElementById("dashboard-count").textContent = `${rows.length} 筆`;
    renderBatchControls();
    if (!rows.length) {
      list.innerHTML = '<div class="dashboard-empty">目前沒有符合條件的資料。</div>';
      return;
    }

    list.innerHTML = rows.map((row) => {
      const attended = row.attended === "是";
      const badgeReceived = row.badgeReceived === "是";
      const selected = state.selectedBadgeIds.has(row.id);
      return `
        <article class="dashboard-row${badgeReceived ? " has-badge" : ""}${selected ? " is-selected" : ""}">
          <div class="dashboard-person">
            <div class="dashboard-person-title">
              <strong>${escapeHtml(row.name || "未填姓名")}</strong>
              <code>${escapeHtml(row.id || "")}</code>
            </div>
            <span>${escapeHtml([row.company, row.title].filter(Boolean).join(" · "))}</span>
            <small>${escapeHtml(row.attendeeType || "一般與會者")}</small>
          </div>
          <div class="dashboard-statuses">
            <span class="attendance-pill ${attended ? "is-attended" : "is-absent"}">
              ${attended ? `已報到${row.checkinAt ? ` · ${escapeHtml(row.checkinAt)}` : ""}` : "未報到"}
            </span>
            <div class="dashboard-receipts">
              ${row.lunchReceived === "是" ? "<span>午餐已領</span>" : ""}
              ${row.giftReceived === "是" ? "<span>伴手禮已領</span>" : ""}
            </div>
            <button class="badge-button${badgeReceived ? " is-received" : ""}${selected ? " is-pending" : ""}" type="button"
              data-badge-id="${escapeHtml(row.id || "")}" ${badgeReceived ? "disabled" : ""}>
              ${badgeReceived ? "✓ 識別證已領" : selected ? "✓ 已加入批次" : "加入識別證批次"}
            </button>
            ${badgeReceived && row.badgeReceivedAt ? `<small>領取時間 ${escapeHtml(row.badgeReceivedAt)}</small>` : ""}
          </div>
        </article>`;
    }).join("");

    list.querySelectorAll("[data-badge-id]:not(:disabled)").forEach((button) => {
      button.addEventListener("click", () => toggleBadgeSelection(button.dataset.badgeId));
    });
  }

  function toggleBadgeSelection(id) {
    if (state.selectedBadgeIds.has(id)) state.selectedBadgeIds.delete(id);
    else state.selectedBadgeIds.add(id);
    renderDashboardList();
  }

  function renderBatchControls() {
    const count = state.selectedBadgeIds.size;
    const countElement = document.getElementById("dashboard-selected-count");
    const clearButton = document.getElementById("dashboard-clear-selection");
    const submitButton = document.getElementById("dashboard-submit-batch");
    if (!countElement || !clearButton || !submitButton) return;
    countElement.textContent = count ? `已選取 ${count} 人，尚未寫入` : "尚未選取";
    clearButton.disabled = count === 0;
    submitButton.disabled = count === 0;
  }

  async function submitBadgeBatch() {
    const ids = Array.from(state.selectedBadgeIds);
    if (!ids.length) return;
    const submitButton = document.getElementById("dashboard-submit-batch");
    const clearButton = document.getElementById("dashboard-clear-selection");
    submitButton.disabled = true;
    clearButton.disabled = true;
    submitButton.textContent = "批次寫入中…";
    setDashboardMessage("");
    try {
      const payload = await callApi("dashboardBatchRecord", {
        ids: JSON.stringify(ids),
        pin: state.dashboardPin,
      });
      if (!payload.success) throw new Error(payload.message || "批次寫入失敗");
      const completed = new Set([...(payload.updatedIds || []), ...(payload.alreadyIds || [])]);
      state.dashboardRows.forEach((row) => {
        if (!completed.has(row.id)) return;
        row.badgeReceived = "是";
        if (!row.badgeReceivedAt) row.badgeReceivedAt = payload.badgeReceivedAt || "";
      });
      state.selectedBadgeIds.clear();
      renderDashboardStats();
      renderDashboardList();
      setDashboardMessage(payload.message || `已批次寫入 ${completed.size} 人。`, false);
    } catch (requestError) {
      renderBatchControls();
      setDashboardMessage(requestError.message || "批次寫入失敗，請稍後再試。", true);
    } finally {
      submitButton.textContent = "OK 批次寫入";
    }
  }

  function setDashboardMessage(message, isError = false) {
    const element = document.getElementById("dashboard-message");
    if (!element) return;
    element.textContent = message || "";
    element.className = `dashboard-message${isError ? " is-error" : ""}${message ? "" : " hidden"}`;
  }

  function bindEventPage() {
    document.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.addEventListener("change", () => {
        state.mode = input.value;
        document.querySelectorAll(".mode-option").forEach((label) => {
          label.classList.toggle(
            "is-selected",
            label.querySelector("input").checked,
          );
        });
        updateCameraHint();
      });
    });

    document.getElementById("lookup-form").addEventListener("submit", lookupAttendees);
    document.getElementById("lookup-refresh").addEventListener("click", () => prepareLookupIndex(true));
    document.getElementById("manual-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById("manual-input");
      recordById(input.value);
    });
    prepareLookupIndex();
    document.getElementById("scanner-button").addEventListener("click", toggleScanner);
  }

  function modeLabel() {
    if (state.mode === "gift") return "伴手禮領取";
    if (state.mode === "lunch") return "午餐領取";
    return "活動報到";
  }

  function updateCameraHint() {
    const hint = document.getElementById("camera-hint");
    if (hint) hint.textContent = `掃描${modeLabel()}`;
  }

  function validId(value) {
    return /^[A-Za-z0-9_-]{1,80}$/.test(String(value || "").trim());
  }

  function loadPendingQueue() {
    try {
      const value = JSON.parse(window.localStorage.getItem(QUEUE_STORAGE_KEY) || "[]");
      if (!Array.isArray(value)) return [];
      return value.filter(
        (item) =>
          item &&
          validId(item.id) &&
          ["checkin", "gift", "lunch"].includes(item.mode) &&
          item.clientId,
      );
    } catch (_) {
      return [];
    }
  }

  function savePendingQueue() {
    try {
      window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(state.pendingQueue));
    } catch (_) {}
  }

  function readLookupCache() {
    try {
      const cached = JSON.parse(window.localStorage.getItem(LOOKUP_CACHE_KEY) || "null");
      if (!cached || !Array.isArray(cached.rows) || !cached.rows.length) return null;
      return cached;
    } catch (_) {
      return null;
    }
  }

  function saveLookupCache(rows) {
    try {
      window.localStorage.setItem(LOOKUP_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), rows }));
    } catch (_) {}
  }

  function setLookupReadyStatus(message, ready) {
    state.lookupReady = Boolean(ready);
    const button = document.getElementById("lookup-button");
    const status = document.getElementById("lookup-cache-status");
    if (button) {
      button.disabled = false;
      button.textContent = "查詢";
    }
    if (status) status.textContent = message;
  }

  function setLookupRefreshBusy(busy) {
    const button = document.getElementById("lookup-refresh");
    if (!button) return;
    button.disabled = Boolean(busy);
    button.textContent = busy ? "更新中…" : "更新名單";
  }

  function prepareLookupIndex(force = false) {
    if (!force && state.lookupRows.length && state.lookupReady) {
      if (state.lookupLoadPromise) {
        setLookupReadyStatus("使用已載入名單，正在背景更新。", true);
        setLookupRefreshBusy(true);
        return state.lookupLoadPromise;
      }
      setLookupReadyStatus("名單已載入，本機快速查詢已啟用。", true);
      return Promise.resolve(state.lookupRows);
    }
    const cached = readLookupCache();
    if (cached) {
      if (!state.lookupRows.length) state.lookupRows = cached.rows;
      setLookupReadyStatus(force ? "使用已載入名單，正在背景更新。" : "名單已載入，本機快速查詢已啟用。", true);
      if (!force && Date.now() - Number(cached.savedAt || 0) <= LOOKUP_CACHE_TTL_MS) {
        return Promise.resolve(state.lookupRows);
      }
    } else if (!state.lookupRows.length) {
      setLookupReadyStatus("正在預先載入名單，完成後查詢會立即顯示。", false);
    }
    if (state.lookupLoadPromise) {
      setLookupRefreshBusy(true);
      return state.lookupLoadPromise;
    }

    setLookupRefreshBusy(true);
    state.lookupLoadPromise = callApi("lookupIndex", { refresh: force ? "1" : "0" })
      .then((payload) => {
        const rows = Array.isArray(payload.results) ? payload.results : [];
        if (!payload.success || !rows.length) throw new Error(payload.error || "名單載入失敗");
        state.lookupRows = rows;
        saveLookupCache(rows);
        setLookupReadyStatus("名單已更新，本機快速查詢已啟用。", true);
        return rows;
      })
      .catch(() => {
        if (state.lookupRows.length) {
          setLookupReadyStatus("使用手機內已載入的名單快速查詢。", true);
          return state.lookupRows;
        }
        setLookupReadyStatus("快速名單尚未完成，查詢會直接讀取最新後台資料。", false);
        return [];
      })
      .finally(() => {
        state.lookupLoadPromise = null;
        setLookupRefreshBusy(false);
      });
    return state.lookupLoadPromise;
  }

  function scheduleQueueSync(delay = BATCH_DELAY_MS) {
    if (!state.pendingQueue.length || state.syncingQueue) return;
    window.clearTimeout(state.queueTimer);
    state.queueTimer = window.setTimeout(flushPendingQueue, delay);
  }

  function enqueueRecord(id, includeOverlay) {
    const mode = state.mode;
    const existing = state.pendingQueue.find((item) => item.id === id && item.mode === mode);
    if (existing) {
      state.lastQueuedClientId = existing.clientId;
      showResult(
        {
          success: true,
          title: "已在等待同步",
          message: `${id} 已經在暫存佇列中，目前共有 ${state.pendingQueue.length} 筆等待同步。`,
        },
        id,
        includeOverlay,
      );
      scheduleQueueSync(0);
      return;
    }

    const item = {
      clientId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      id,
      mode,
      eventKey: state.eventKey,
      includeOverlay: Boolean(includeOverlay),
      queuedAt: Date.now(),
    };
    state.pendingQueue.push(item);
    const lookupRow = state.lookupRows.find((row) => row.id === id);
    if (lookupRow) {
      if (mode === "gift") lookupRow.giftReceived = "是";
      else if (mode === "lunch") lookupRow.lunchReceived = "是";
      else lookupRow.attended = "是";
      saveLookupCache(state.lookupRows);
    }
    state.lastQueuedClientId = item.clientId;
    savePendingQueue();
    showResult(
      {
        success: true,
        title: "已暫存・等待同步",
        message: `${id} 已存入本機；可立即處理下一位。目前 ${state.pendingQueue.length} 筆等待同步。`,
      },
      id,
      includeOverlay,
    );
    scheduleQueueSync(state.pendingQueue.length >= 5 ? 0 : BATCH_DELAY_MS);
  }

  async function flushPendingQueue() {
    if (state.syncingQueue || !state.pendingQueue.length || !navigator.onLine) return;
    state.syncingQueue = true;
    window.clearTimeout(state.queueTimer);
    state.queueTimer = 0;
    const batch = state.pendingQueue.slice(0, BATCH_SIZE);
    let syncSucceeded = false;

    try {
      const payload = await callApi("batchRecord", {
        items: JSON.stringify(
          batch.map(({ clientId, id, mode }) => ({ clientId, id, mode })),
        ),
      });
      if (!payload.success || !Array.isArray(payload.results)) {
        throw new Error(payload.message || "批次同步失敗");
      }

      const completed = new Set(payload.results.map((result) => result.clientId));
      state.pendingQueue = state.pendingQueue.filter((item) => !completed.has(item.clientId));
      savePendingQueue();
      state.retryDelay = 2000;
      syncSucceeded = true;

      const currentResult =
        payload.results.find((result) => result.clientId === state.lastQueuedClientId) ||
        payload.results[payload.results.length - 1];
      if (currentResult) {
        const queuedItem = batch.find((item) => item.clientId === currentResult.clientId);
        showResult(currentResult, currentResult.id, Boolean(queuedItem && queuedItem.includeOverlay));
      }
    } catch (error) {
      const latest = state.pendingQueue[state.pendingQueue.length - 1];
      if (latest) {
        showResult(
          {
            success: true,
            title: "已暫存・等待網路同步",
            message: `資料仍安全保留在手機，系統將自動重試。目前 ${state.pendingQueue.length} 筆等待同步。`,
          },
          latest.id,
          Boolean(latest.includeOverlay),
        );
      }
      state.retryDelay = Math.min(state.retryDelay * 2, 30000);
    } finally {
      state.syncingQueue = false;
      if (state.pendingQueue.length) scheduleQueueSync(syncSucceeded ? 0 : state.retryDelay);
    }
  }

  function setError(message) {
    const element = document.getElementById("scanner-error");
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("hidden", !message);
  }

  function resultKind(payload) {
    const title = String(payload.title || "");
    if (title === "已完成報到" || title.endsWith("已領取")) return "duplicate";
    if (payload.success) return "success";
    return "error";
  }

  function showResult(payload, id, includeOverlay = false) {
    const kind = resultKind(payload);
    const panel = document.getElementById("status-panel");
    const title = String(payload.title || "登記結果");
    const message = String(payload.message || "請由現場工作人員確認名單。");

    panel.className = `status-panel${kind === "error" ? " is-error" : kind === "duplicate" ? " is-duplicate" : ""}`;
    document.getElementById("status-title").textContent = title;
    document.getElementById("status-message").textContent = message;

    if (includeOverlay) {
      const overlay = document.getElementById("result-overlay");
      overlay.className = `result-overlay${kind === "error" ? " is-error" : kind === "duplicate" ? " is-duplicate" : ""}`;
      document.getElementById("overlay-title").textContent = title;
      document.getElementById("overlay-message").textContent = message;
      document.getElementById("overlay-id").textContent = `報到序號：${id}`;
    }
  }

  function recordById(rawId, includeOverlay = false) {
    const id = String(rawId || "").trim();
    if (!validId(id)) {
      setError("請輸入正確的報到序號，例如 SPK-001。");
      return;
    }

    setError("");
    enqueueRecord(id, includeOverlay);
  }

  async function lookupAttendees(event) {
    event.preventDefault();
    const startedAt = performance.now();
    const input = document.getElementById("lookup-input");
    const results = document.getElementById("lookup-results");
    const query = input.value.trim();
    results.replaceChildren();
    if (!query) return;

    if (!state.lookupReady) {
      await Promise.race([
        prepareLookupIndex(),
        new Promise((resolve) => window.setTimeout(resolve, 500)),
      ]);
    }

    const normalized = query.toLowerCase();
    let rows;
    if (state.lookupRows.length) {
      rows = state.lookupRows.filter((row) => {
        return [row.name, row.company, row.title, row.id].join("\n").toLowerCase().includes(normalized);
      }).slice(0, 30);
    } else {
      const loading = document.createElement("div");
      loading.className = "lookup-summary";
      loading.textContent = "正在讀取最新後台資料…";
      results.appendChild(loading);
      try {
        const payload = await callApi("lookup", { q: query });
        rows = Array.isArray(payload.results) ? payload.results : [];
      } catch (_) {
        results.replaceChildren();
        const error = document.createElement("div");
        error.className = "error-text";
        error.textContent = "暫時無法查詢，請按「更新名單」後再試一次。";
        results.appendChild(error);
        return;
      }
      results.replaceChildren();
    }
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(2);
    const summary = document.createElement("div");
    summary.className = "lookup-summary";
    summary.textContent = rows.length
      ? `找到 ${rows.length} 筆資料（${elapsed} 秒）`
      : `查無符合資料（${elapsed} 秒）`;
    results.appendChild(summary);
    rows.forEach((row) => results.appendChild(createLookupCard(row)));
  }

  function createLookupCard(row) {
    const card = document.createElement("article");
    card.className = "lookup-card";

    const person = document.createElement("div");
    person.className = "lookup-person";
    const name = document.createElement("strong");
    name.textContent = row.name || "未填姓名";
    const meta = document.createElement("span");
    meta.textContent = [row.company, row.title].filter(Boolean).join(" · ");
    const code = document.createElement("code");
    code.textContent = row.id || "";
    person.append(name, meta, code);

    const action = document.createElement("div");
    action.className = "lookup-action";
    const badge = document.createElement("span");
    badge.className = "status-badge";
    badge.textContent =
      state.mode === "gift"
        ? row.giftReceived === "是" ? "已領取" : "未領取"
        : state.mode === "lunch"
          ? row.lunchReceived === "是" ? "已領取" : "未領取"
          : row.attended === "是" ? "已報到" : "未報到";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "使用此序號";
    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "已加入 ✓";
      badge.textContent = "等待同步";
      card.classList.add("is-queued");
      recordById(row.id);

      window.setTimeout(() => {
        if (!button.isConnected) return;
        button.disabled = false;
        button.textContent = "使用此序號";
      }, 1500);
    });
    action.append(badge, button);

    card.append(person, action);
    return card;
  }

  function readCheckinId(text) {
    const value = String(text || "").trim();
    try {
      const url = new URL(value);
      return {
        id: String(url.searchParams.get("id") || "").trim(),
        event: String(url.searchParams.get("event") || "").trim() || null,
      };
    } catch (_) {
      return { id: validId(value) ? value : "", event: null };
    }
  }

  async function toggleScanner() {
    if (state.scannerControls) {
      stopScanner();
      return;
    }
    await startScanner();
  }

  async function startScanner() {
    const button = document.getElementById("scanner-button");
    const video = document.getElementById("camera-video");
    const frame = document.getElementById("camera-frame");
    button.disabled = true;
    button.textContent = "正在開啟相機…";
    setError("");
    state.handled = false;
    state.lastScannedId = "";
    state.lastScannedAt = 0;

    try {
      if (!window.ZXingBrowser || !window.ZXingBrowser.BrowserQRCodeReader) {
        throw new Error("掃描元件未載入");
      }

      const reader = new window.ZXingBrowser.BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 50,
        delayBetweenScanSuccess: 120,
      });

      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        video,
        async (result) => {
          if (!result || state.handled) return;
          const scanned = readCheckinId(result.getText());
          if (!scanned.id) {
            setError("這不是有效的活動報到 QR Code，請重新掃描邀請函中的 QR Code。");
            return;
          }
          if (scanned.event && scanned.event !== state.eventKey) {
            setError("此 QR Code 屬於另一個會議，請先切換會議。");
            return;
          }
          const scannedAt = Date.now();
          if (
            scanned.id === state.lastScannedId &&
            scannedAt - state.lastScannedAt < 4000
          ) return;

          state.handled = true;
          state.lastScannedId = scanned.id;
          state.lastScannedAt = scannedAt;
          recordById(scanned.id, true);
          window.setTimeout(() => {
            state.handled = false;
          }, 300);
        },
      );

      state.scannerControls = controls;
      frame.classList.add("is-active");
      button.disabled = false;
      button.className = "secondary-button";
      button.textContent = "暫停掃描";
      document.querySelectorAll('input[name="mode"]').forEach((input) => {
        input.disabled = true;
      });
      updateCameraHint();
    } catch (error) {
      const name = error && error.name ? error.name : "";
      setError(
        name === "NotAllowedError"
          ? "相機權限尚未允許。請在瀏覽器設定中允許此網站使用相機。"
          : "目前無法開啟相機。請使用 Safari 或 Chrome，並允許相機權限。",
      );
      button.disabled = false;
      button.className = "primary-button";
      button.textContent = "▣　開啟相機掃描";
    }
  }

  function stopScanner() {
    if (state.scannerControls) state.scannerControls.stop();
    state.scannerControls = null;
    state.handled = false;
    state.lastScannedId = "";
    state.lastScannedAt = 0;
    document.getElementById("camera-frame").classList.remove("is-active");
    document.getElementById("result-overlay").classList.add("hidden");
    const button = document.getElementById("scanner-button");
    button.className = "primary-button";
    button.textContent = "▣　開啟相機掃描";
    document.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.disabled = false;
    });
  }

  async function initialize() {
    state.pendingQueue = loadPendingQueue();
    const restoredPendingQueue = state.pendingQueue.length > 0;
    if (state.pendingQueue.length) {
      state.lastQueuedClientId = state.pendingQueue[state.pendingQueue.length - 1].clientId;
    }
    const params = new URLSearchParams(window.location.search);
    const earlyEvent = params.get("event");
    if (earlyEvent && EVENTS[earlyEvent] && params.get("view") !== "dashboard") {
      prepareLookupIndex(true);
    }
    const config = await loadConfig();
    EVENTS.sig206.name = config.eventName;
    EVENTS.forum.name = config.eventName;

    const requestedEvent = params.get("event");
    if (!requestedEvent || !EVENTS[requestedEvent]) {
      renderChooser(config);
      return;
    }

    if (params.get("view") === "dashboard") {
      renderDashboardPage(requestedEvent, EVENTS[requestedEvent].name);
      return;
    }

    renderEventPage(requestedEvent, EVENTS[requestedEvent].name);
    const requestedMode = params.get("mode");
    if (["checkin", "gift", "lunch"].includes(requestedMode)) {
      state.mode = requestedMode;
      const input = document.querySelector(`input[name="mode"][value="${requestedMode}"]`);
      if (input) {
        input.checked = true;
        input.dispatchEvent(new Event("change"));
      }
    }

    const id = String(params.get("id") || "").trim();
    if (id) recordById(id);
    if (restoredPendingQueue) scheduleQueueSync(0);
  }

  window.addEventListener("online", () => scheduleQueueSync(0));
  window.setInterval(() => {
    if (state.pendingQueue.length && !state.queueTimer && !state.syncingQueue) {
      scheduleQueueSync(0);
    }
  }, 5000);

  window.addEventListener("beforeunload", () => {
    if (state.scannerControls) state.scannerControls.stop();
    savePendingQueue();
  });

  initialize();
})();
