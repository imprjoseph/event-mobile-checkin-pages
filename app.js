(function () {
  "use strict";

  const API_URL =
    "https://script.google.com/macros/s/AKfycbwdcYn-IrU3eH91Og7zNB27SdPuqoagb1CujNl7YjyO_54hFycGUvU7lRAPf8dVeDarjA/exec";

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

  function callApi(action, params = {}, eventKey = state.eventKey) {
    const event = EVENTS[eventKey] || EVENTS.sig206;
    return jsonp(event.apiUrl, { action, ...params });
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
        <a class="change-event" href="${escapeHtml(pageUrl({}))}">切換會議</a>
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
              <button class="small-button" type="submit">查詢</button>
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
    document.getElementById("manual-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.getElementById("manual-input");
      recordById(input.value);
    });
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
      document.getElementById("overlay-id").textContent = id;
    }
  }

  async function recordById(rawId, includeOverlay = false) {
    const id = String(rawId || "").trim();
    if (!validId(id)) {
      setError("請輸入正確的報到序號，例如 SPK-001。");
      return;
    }

    setError("");
    if (includeOverlay) {
      showResult(
        { success: true, title: "正在登記…", message: "完成後可直接掃描下一位。" },
        id,
        true,
      );
    }

    try {
      const payload = await callApi("record", { id, mode: state.mode });
      showResult(payload, id, includeOverlay);
    } catch (error) {
      const payload = {
        success: false,
        title: "暫時無法登記",
        message: error && error.message ? error.message : "請稍後再試一次。",
      };
      showResult(payload, id, includeOverlay);
      state.lastScannedId = "";
    }
  }

  async function lookupAttendees(event) {
    event.preventDefault();
    const input = document.getElementById("lookup-input");
    const results = document.getElementById("lookup-results");
    const query = input.value.trim();
    results.replaceChildren();
    if (!query) return;

    const loading = document.createElement("div");
    loading.className = "lookup-summary";
    loading.textContent = "正在查詢…";
    results.appendChild(loading);

    try {
      const payload = await callApi("lookup", { q: query });
      const rows = Array.isArray(payload.results) ? payload.results : [];
      results.replaceChildren();

      const summary = document.createElement("div");
      summary.className = "lookup-summary";
      summary.textContent = rows.length ? `找到 ${rows.length} 筆資料` : "查無符合資料";
      results.appendChild(summary);

      rows.forEach((row) => results.appendChild(createLookupCard(row)));
    } catch (_) {
      results.replaceChildren();
      const error = document.createElement("div");
      error.className = "error-text";
      error.textContent = "暫時無法查詢，請稍後再試一次。";
      results.appendChild(error);
    }
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
    button.addEventListener("click", () => recordById(row.id));
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
    const params = new URLSearchParams(window.location.search);
    const config = await loadConfig();
    EVENTS.sig206.name = config.eventName;
    EVENTS.forum.name = config.eventName;

    const requestedEvent = params.get("event");
    if (!requestedEvent || !EVENTS[requestedEvent]) {
      renderChooser(config);
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
    if (id) await recordById(id);
  }

  window.addEventListener("beforeunload", () => {
    if (state.scannerControls) state.scannerControls.stop();
  });

  initialize();
})();
