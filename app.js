(function () {
  const utils = window.UBikeUtils;
  const form = document.getElementById("check-form");
  const startField = document.getElementById("start-field");
  const startInput = document.getElementById("start-input");
  const endInput = document.getElementById("end-input");
  const swapBtn = document.getElementById("swap-btn");
  const saveBtn = document.getElementById("save-btn");
  const gpsBtn = document.getElementById("gps-btn");
  const goBtn = document.getElementById("go-btn");
  const rideToggle = document.getElementById("ride-toggle");
  const presetList = document.getElementById("preset-list");
  const resultCard = document.getElementById("result-card");
  const resultMain = document.getElementById("result-main");
  const resultDetails = document.getElementById("result-details");
  const statusLine = document.getElementById("status-line");
  const liveIndicator = document.getElementById("live-indicator");
  const liveText = document.getElementById("live-text");
  const gpsHint = document.getElementById("gps-hint");
  const startSuggestions = document.getElementById("start-suggestions");
  const endSuggestions = document.getElementById("end-suggestions");

  const LAST_KEY = "ubike-go:last";
  const PRESET_KEY = "ubike-go:presets";
  const RIDE_KEY = "ubike-go:ride-mode";
  const MOBILE_SCROLL_QUERY = window.matchMedia("(max-width: 767px)");
  const RIDE_REFRESH_MS = 60_000;

  const state = {
    stations: [],
    rideMode: localStorage.getItem(RIDE_KEY) === "1",
    rideTimer: null,
    loadingCatalog: false
  };

  function readJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function setStatus(text, tone = "") {
    statusLine.textContent = text;
    statusLine.className = `status ${tone}`.trim();
  }

  function triggerGoEffect() {
    goBtn.classList.remove("burst");
    void goBtn.offsetWidth;
    goBtn.classList.add("burst");
  }

  function setRideVisuals(enabled) {
    rideToggle.textContent = enabled ? "騎乘中" : "騎車";
    rideToggle.classList.toggle("active", enabled);
    liveIndicator.hidden = !enabled;
    liveText.textContent = enabled ? "更新中" : "";
    resultCard.classList.toggle("watching", enabled);
    resultCard.classList.toggle("riding", enabled);
    startField.classList.toggle("is-hidden", enabled);
  }

  function renderPresets() {
    const presets = readJSON(PRESET_KEY, []);
    presetList.innerHTML = presets.length
      ? presets
          .map(
            (preset, index) => `
              <button class="preset-item" type="button" data-index="${index}">
                <strong>${escapeHTML(preset.start)}</strong>
                <small>${escapeHTML(preset.end)}</small>
              </button>
            `
          )
          .join("")
      : '<div class="preset-item"><small>尚未儲存配置</small></div>';
  }

  function normalizeStationText(value) {
    return utils.normalizeText(value)
      .replace(/^捷運/, "")
      .replace(/^台北/, "")
      .replace(/^臺北/, "")
      .replace(/車站$/g, "")
      .replace(/站$/g, "")
      .replace(/號出口/g, "號出口")
      .replace(/出口/g, "出口")
      .replace(/[.-]/g, "");
  }

  function normalizeQuery(value) {
    return normalizeStationText(value)
      .replace(/路$/g, "")
      .replace(/街$/g, "")
      .replace(/巷$/g, "")
      .replace(/弄$/g, "");
  }

  function splitChunks(value) {
    return String(value || "").match(/[\u4e00-\u9fff]+|\d+|[a-zA-Z]+/g) || [];
  }

  function buildQueryVariants(query) {
    const base = normalizeQuery(query);
    const variants = new Set();

    if (!base) {
      return [];
    }

    variants.add(base);
    variants.add(base.replace(/號$/g, ""));
    variants.add(base.replace(/號出口$/g, ""));

    const chunks = splitChunks(base);
    if (chunks.length > 1) {
      variants.add(chunks.join(""));
      variants.add(chunks.join(" "));
    }

    const numberMatch = base.match(/(\d+)/);
    if (numberMatch) {
      const number = numberMatch[1];
      const stem = base.replace(number, "");
      variants.add(`${stem}${number}`);
      variants.add(`${stem}${number}號`);
      variants.add(`${stem}${number}號出口`);
      variants.add(`${stem}${number}出口`);
    }

    return [...variants].filter(Boolean);
  }

  function buildStationSearchTexts(station) {
    const texts = new Set();
    const raw = normalizeStationText(station.raw_name || station.name || "");
    const name = normalizeStationText(station.name || "");
    const compact = raw.replace(/\(.*?\)/g, "");
    const noStopWord = compact.replace(/(捷運|車站|站)/g, "");

    [raw, name, compact, noStopWord].forEach((value) => {
      if (value) {
        texts.add(value);
      }
    });

    splitChunks(`${raw}${name}${compact}${noStopWord}`).forEach((chunk) => {
      texts.add(chunk);
    });

    return [...texts].filter(Boolean);
  }

  function scoreCatalogStation(station, query) {
    const queryVariants = buildQueryVariants(query);
    if (!queryVariants.length) {
      return Number.POSITIVE_INFINITY;
    }

    const stationTexts = buildStationSearchTexts(station);
    let best = Number.POSITIVE_INFINITY;

    for (const variant of queryVariants) {
      const variantChunks = splitChunks(variant);

      for (const stationText of stationTexts) {
        if (stationText === variant) {
          return 0;
        }

        if (stationText.includes(variant)) {
          const index = stationText.indexOf(variant);
          const score = index * 3 + Math.abs(stationText.length - variant.length);
          if (score < best) {
            best = score;
          }
          continue;
        }

        if (variantChunks.length > 1 && variantChunks.every((chunk) => stationText.includes(chunk))) {
          const score = 32 + variantChunks.length * 7 + stationText.indexOf(variantChunks[0]);
          if (score < best) {
            best = score;
          }
        }
      }
    }

    return best;
  }

  function renderSuggestions(field, query) {
    const panel = field === "start" ? startSuggestions : endSuggestions;
    const normalized = normalizeQuery(query);

    if (!state.stations.length || normalized.length < 1) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }

    const candidates = state.stations
      .map((station) => ({ station, score: scoreCatalogStation(station, query) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => a.score - b.score)
      .slice(0, 8);

    if (!candidates.length) {
      panel.innerHTML = '<div class="suggestion-empty">找不到符合的站點</div>';
      panel.hidden = false;
      return;
    }

    panel.innerHTML = candidates
      .map(
        ({ station }) => `
          <button
            type="button"
            class="suggestion-item"
            data-value="${escapeHTML(station.name)}"
            data-field="${field}"
          >
            <span class="suggestion-name">${escapeHTML(station.name)}</span>
            <span class="suggestion-meta">${station.bikes} 車 / ${station.slots} 位</span>
          </button>
        `
      )
      .join("");
    panel.hidden = false;
  }

  function hideSuggestions(field) {
    const panel = field === "start" ? startSuggestions : endSuggestions;
    panel.hidden = true;
  }

  function nearestStationByGPS(lat, lng) {
    if (!state.stations.length) {
      return null;
    }

    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const station of state.stations) {
      const distance = utils.distanceMeters({ lat, lng }, station);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = station;
      }
    }

    return best;
  }

  async function loadStationCatalog() {
    if (state.stations.length) {
      return state.stations;
    }

    if (state.loadingCatalog) {
      return new Promise((resolve) => {
        const timer = setInterval(() => {
          if (!state.loadingCatalog) {
            clearInterval(timer);
            resolve(state.stations);
          }
        }, 50);
      });
    }

    state.loadingCatalog = true;
    try {
      const response = await fetch("/check?list=1", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || "catalog load failed");
      }

      state.stations = Array.isArray(payload.stations) ? payload.stations : [];
      return state.stations;
    } catch {
      setStatus("站點提示載入失敗，仍可直接查詢。", "warn");
      return [];
    } finally {
      state.loadingCatalog = false;
    }
  }

  function scrollToResultIfNeeded(force = false) {
    if (!force || !MOBILE_SCROLL_QUERY.matches) {
      return;
    }

    window.requestAnimationFrame(() => {
      resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function formatBikeCounts(payload) {
    const regularBikes = Number(payload.start_regular_bikes ?? payload.start_bikes ?? 0);
    const electricBikes = payload.start_electric_bikes;

    if (electricBikes === null || electricBikes === undefined) {
      return `一般車 ${regularBikes} 台`;
    }

    return `一般車 ${regularBikes} 台 電動車 ${Number(electricBikes ?? 0)} 台`;
  }

  function renderResult(payload) {
    if (payload.error) {
      resultMain.textContent = payload.message || "查詢失敗";
      resultMain.className = "result-main bad";
      resultDetails.textContent = "";
      return;
    }

    const rideAllowed = payload.decision === "ride";
    resultMain.className = `result-main ${rideAllowed ? "good" : "bad"}`;

    if (state.rideMode) {
      resultMain.textContent = `終點 ${payload.end_station}`;
      const lines = [`剩餘車位：${payload.end_slots}`];

      if (payload.end_slots <= 0) {
        lines.push("");
        lines.push("最近備案：");
        for (const station of payload.nearby_stations || []) {
          lines.push(`- ${station.station}（剩餘車位 ${station.slots}，距離約 ${station.distance_m}m）`);
        }
      }

      if (payload.updated_at) {
        const updated = new Date(payload.updated_at);
        if (!Number.isNaN(updated.getTime())) {
          lines.push("");
          lines.push(`更新時間：${updated.toLocaleTimeString("zh-TW")}`);
        }
      }

      resultDetails.textContent = lines.join("\n");
      return;
    }

    resultMain.textContent = rideAllowed ? "可騎車" : "不建議騎車";
    const lines = [
      `起點：${payload.start_station}（${formatBikeCounts(payload)}）`,
      `終點：${payload.end_station}（車位 ${payload.end_slots}）`
    ];

    if (payload.reasons?.length) {
      lines.push("");
      lines.push("原因：");
      for (const reason of payload.reasons) {
        lines.push(`- ${reason}`);
      }
    }

    if (payload.nearby_stations?.length && payload.end_slots <= 0) {
      lines.push("");
      lines.push("最近備案：");
      for (const station of payload.nearby_stations.slice(0, 2)) {
        lines.push(`- ${station.station}（剩餘車位 ${station.slots}，距離約 ${station.distance_m}m）`);
      }
    }

    resultDetails.textContent = lines.join("\n");
  }

  async function checkRoute({ silent = false, scrollToResult = false } = {}) {
    const start = startInput.value.trim();
    const end = endInput.value.trim();

    if (!end || (!state.rideMode && !start)) {
      setStatus("請先輸入起點與終點", "warn");
      resultMain.textContent = "輸入起點與終點後，按下 GO!!";
      resultDetails.textContent = "";
      return;
    }

    if (!silent) {
      setStatus(state.rideMode ? "更新中..." : "查詢中...", "warn");
    }

    const url = new URL("/check", window.location.origin);
    url.searchParams.set("start", state.rideMode ? start || end : start);
    url.searchParams.set("end", end);
    if (state.rideMode) {
      url.searchParams.set("watch", "1");
    }

    try {
      const response = await fetch(url.toString(), { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        renderResult(payload);
        setStatus(payload.message || "查詢失敗", "bad");
        scrollToResultIfNeeded(scrollToResult);
        return;
      }

      writeJSON(LAST_KEY, { start, end });
      renderResult(payload);
      setStatus(
        state.rideMode ? "騎乘中，依官方更新頻率同步" : payload.message || "查詢完成",
        payload.decision === "ride" ? "good" : "bad"
      );
      scrollToResultIfNeeded(scrollToResult);
    } catch {
      renderResult({
        error: "fetch_failed",
        message: "系統暫時無法取得資料"
      });
      setStatus("系統暫時無法取得資料", "bad");
      scrollToResultIfNeeded(scrollToResult);
    }
  }

  function swapStations() {
    if (state.rideMode) {
      return;
    }

    const start = startInput.value;
    startInput.value = endInput.value;
    endInput.value = start;
    setStatus("已交換起點與終點");
  }

  function savePreset() {
    const start = startInput.value.trim();
    const end = endInput.value.trim();

    if (!start || !end) {
      setStatus("請先輸入起點與終點", "warn");
      return;
    }

    const presets = readJSON(PRESET_KEY, []);
    const next = [
      { start, end },
      ...presets.filter((item) => !(item.start === start && item.end === end))
    ].slice(0, 8);
    writeJSON(PRESET_KEY, next);
    renderPresets();
    setStatus("已儲存配置", "good");
  }

  function applyGpsStart(force = false) {
    if (!navigator.geolocation) {
      gpsHint.textContent = "此裝置不支援定位。";
      return;
    }

    if (!force && startInput.value.trim()) {
      return;
    }

    gpsHint.textContent = "正在取得目前位置...";

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nearest = nearestStationByGPS(position.coords.latitude, position.coords.longitude);
        if (nearest) {
          startInput.value = nearest.name;
          gpsHint.textContent = `已帶入最近起點：${nearest.name}`;
        } else {
          gpsHint.textContent = "已定位，但找不到最近站點。";
        }
      },
      () => {
        gpsHint.textContent = "定位失敗，請手動輸入起點。";
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
    );
  }

  function setRideMode(enabled) {
    state.rideMode = enabled;
    localStorage.setItem(RIDE_KEY, enabled ? "1" : "0");
    setRideVisuals(enabled);

    if (state.rideTimer) {
      clearInterval(state.rideTimer);
      state.rideTimer = null;
    }

    if (enabled) {
      hideSuggestions("start");
      state.rideTimer = setInterval(() => {
        if (endInput.value.trim()) {
          checkRoute({ silent: true });
        }
      }, RIDE_REFRESH_MS);
    }
  }

  function bindSuggestions(input, field) {
    input.addEventListener("input", () => renderSuggestions(field, input.value));
    input.addEventListener("focus", () => {
      hideSuggestions(field);
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => hideSuggestions(field), 120);
    });
  }

  function bindSuggestionPanel(panel) {
    panel.addEventListener("pointerdown", (event) => {
      const button = event.target.closest("[data-value]");
      if (!button) {
        return;
      }

      const field = button.dataset.field;
      const value = button.dataset.value;
      if (field === "start") {
        startInput.value = value;
        hideSuggestions("start");
        setStatus(`已選擇起點：${value}`);
      } else {
        endInput.value = value;
        hideSuggestions("end");
        setStatus(`已選擇終點：${value}`);
      }
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    triggerGoEffect();
    checkRoute({ scrollToResult: true });
  });

  swapBtn.addEventListener("click", swapStations);
  saveBtn.addEventListener("click", savePreset);
  gpsBtn.addEventListener("click", () => applyGpsStart(true));
  rideToggle.addEventListener("click", () => {
    setRideMode(!state.rideMode);
    if (state.rideMode && endInput.value.trim()) {
      checkRoute({ scrollToResult: true });
    }
  });

  presetList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-index]");
    if (!button) {
      return;
    }

    const presets = readJSON(PRESET_KEY, []);
    const preset = presets[Number(button.dataset.index)];
    if (!preset) {
      return;
    }

    startInput.value = preset.start;
    endInput.value = preset.end;
    setStatus(`已載入配置：${preset.start} → ${preset.end}`);
    checkRoute({ scrollToResult: true });
  });

  bindSuggestions(startInput, "start");
  bindSuggestions(endInput, "end");
  bindSuggestionPanel(startSuggestions);
  bindSuggestionPanel(endSuggestions);

  renderPresets();
  setRideVisuals(state.rideMode);

  const last = readJSON(LAST_KEY, null);
  if (last) {
    startInput.value = last.start || "";
    endInput.value = last.end || "";
  }

  Promise.resolve()
    .then(loadStationCatalog)
    .then(() => {
      if (!startInput.value.trim()) {
        applyGpsStart(false);
      } else {
        gpsHint.textContent = "已載入上次使用的站點。";
      }
      return null;
    })
    .catch(() => {
      gpsHint.textContent = "站點清單載入失敗，但仍可直接查詢。";
    });

  if (state.rideMode && endInput.value.trim()) {
    state.rideTimer = setInterval(() => {
      checkRoute({ silent: true });
    }, RIDE_REFRESH_MS);
  }

  window.addEventListener("beforeunload", () => {
    if (state.rideTimer) {
      clearInterval(state.rideTimer);
    }
  });

  if (!utils) {
    setStatus("載入失敗：共享工具未初始化", "bad");
  }
})();
