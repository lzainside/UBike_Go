(function () {
  const utils = window.UBikeUtils;
  const form = document.getElementById("check-form");
  const startInput = document.getElementById("start-input");
  const endInput = document.getElementById("end-input");
  const swapBtn = document.getElementById("swap-btn");
  const saveBtn = document.getElementById("save-btn");
  const gpsBtn = document.getElementById("gps-btn");
  const useLastBtn = document.getElementById("use-last-btn");
  const rideToggle = document.getElementById("ride-toggle");
  const presetList = document.getElementById("preset-list");
  const resultCard = document.getElementById("result-card");
  const resultMain = document.getElementById("result-main");
  const resultDetails = document.getElementById("result-details");
  const statusLine = document.getElementById("status-line");
  const liveIndicator = document.getElementById("live-indicator");
  const gpsHint = document.getElementById("gps-hint");
  const startSuggestions = document.getElementById("start-suggestions");
  const endSuggestions = document.getElementById("end-suggestions");

  const LAST_KEY = "ubike-go:last";
  const PRESET_KEY = "ubike-go:presets";
  const RIDE_KEY = "ubike-go:ride-mode";

  const state = {
    stations: [],
    rideMode: localStorage.getItem(RIDE_KEY) === "1",
    rideTimer: null,
    activeField: null,
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

  function setRideVisuals(enabled) {
    rideToggle.textContent = enabled ? "已騎乘模式：開啟" : "已騎乘模式：關閉";
    liveIndicator.hidden = !enabled;
    resultCard.classList.toggle("watching", enabled);
  }

  function renderPresets() {
    const presets = readJSON(PRESET_KEY, []);
    presetList.innerHTML = presets.length
      ? presets
          .map(
            (preset, index) => `
              <button class="preset-item" type="button" data-index="${index}">
                <strong>${escapeHTML(preset.name)}</strong>
                <small>${escapeHTML(preset.start)} → ${escapeHTML(preset.end)}</small>
              </button>
            `
          )
          .join("")
      : '<div class="preset-item"><small>尚未儲存配置</small></div>';
  }

  function normalize(value) {
    return utils.normalizeText(value)
      .replace(/捷運/g, "")
      .replace(/車站/g, "")
      .replace(/站$/g, "");
  }

  function catalogVariants(query) {
    const base = normalize(query);
    const variants = new Set();
    if (!base) {
      return [];
    }

    variants.add(base);
    variants.add(base.replace(/站$/g, ""));
    variants.add(base.replace(/^捷運/, ""));
    variants.add(base.replace(/^台北/, ""));
    variants.add(base.replace(/^臺北/, ""));

    if (base.length > 2) {
      variants.add(base.slice(0, -1));
    }

    return [...variants].filter(Boolean);
  }

  function scoreCatalogStation(station, query) {
    const name = normalize(station.name || station.raw_name);
    const rawName = normalize(station.raw_name || station.name);
    const variants = catalogVariants(query);
    if (!variants.length) {
      return Number.POSITIVE_INFINITY;
    }

    let best = Number.POSITIVE_INFINITY;

    for (const variant of variants) {
      if (!variant) {
        continue;
      }

      if (name === variant || rawName === variant) {
        return 0;
      }

      const haystacks = [name, rawName].filter(Boolean);
      for (const haystack of haystacks) {
        const index = haystack.indexOf(variant);
        if (index !== -1) {
          const score =
            (index === 0 ? 0 : 180) +
            Math.abs(haystack.length - variant.length) +
            (station.active ? 0 : 90);
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
    const normalized = normalize(query);

    if (!state.stations.length || normalized.length < 1) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }

    const candidates = state.stations
      .map((station) => ({ station, score: scoreCatalogStation(station, query) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => a.score - b.score)
      .slice(0, 7);

    if (!candidates.length) {
      panel.innerHTML = `<div class="suggestion-empty">找不到符合的站點</div>`;
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

  function setInputValue(field, value) {
    const input = field === "start" ? startInput : endInput;
    input.value = value;
    renderSuggestions(field, value);
  }

  function getSuggestionAnchor(input) {
    return input === startInput ? "start" : "end";
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
    } catch (error) {
      setStatus("站點提示載入失敗，仍可直接查詢。", "warn");
      return [];
    } finally {
      state.loadingCatalog = false;
    }
  }

  function renderResult(payload) {
    if (payload.error) {
      resultMain.textContent = payload.message || "查詢失敗";
      resultMain.className = "result-main bad";
      resultDetails.textContent = "";
      return;
    }

    const ride = payload.decision === "ride";
    resultMain.className = `result-main ${ride ? "good" : "bad"}`;
    resultMain.textContent = ride ? "🚴 可騎車" : "🚶 不建議騎車";

    const lines = [
      `起點：${payload.start_station}（車輛 ${payload.start_bikes}）`,
      `終點：${payload.end_station}（車位 ${payload.end_slots}）`
    ];

    if (payload.reasons?.length) {
      lines.push("");
      lines.push("原因：");
      for (const reason of payload.reasons) {
        lines.push(`- ${reason}`);
      }
    }

    if (payload.nearby_stations?.length) {
      lines.push("");
      lines.push("附近站點：");
      for (const station of payload.nearby_stations.slice(0, 2)) {
        lines.push(`- ${station.station}（剩餘車位 ${station.slots}，距離約 ${station.distance_m}m）`);
      }
    }

    if (payload.updated_at) {
      const updated = new Date(payload.updated_at);
      if (!Number.isNaN(updated.getTime())) {
        lines.push("");
        lines.push(`更新時間：${updated.toLocaleString("zh-TW")}`);
      }
    }

    resultDetails.textContent = lines.join("\n");
  }

  async function checkRoute({ silent = false } = {}) {
    const start = startInput.value.trim();
    const end = endInput.value.trim();

    if (!start || !end) {
      setStatus("請先輸入起點與終點", "warn");
      resultMain.textContent = "尚未查詢";
      resultDetails.textContent = "請輸入兩個站點名稱後開始判斷。";
      return;
    }

    if (!silent) {
      setStatus(state.rideMode ? "更新中..." : "查詢中...", "warn");
    }

    const url = new URL("/check", window.location.origin);
    url.searchParams.set("start", start);
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
        return;
      }

      writeJSON(LAST_KEY, { start, end });
      renderResult(payload);
      setStatus(
        state.rideMode ? "已騎乘模式：每 30 秒自動更新" : payload.message || "查詢完成",
        payload.decision === "ride" ? "good" : "bad"
      );
    } catch {
      renderResult({
        error: "fetch_failed",
        message: "系統暫時無法取得資料"
      });
      setStatus("系統暫時無法取得資料", "bad");
    }
  }

  function swapStations() {
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
    const presetName = `${start} → ${end}`;
    const next = [
      { name: presetName, start, end },
      ...presets.filter((item) => item.name !== presetName)
    ].slice(0, 8);
    writeJSON(PRESET_KEY, next);
    renderPresets();
    setStatus("已儲存配置", "good");
  }

  function loadLast() {
    const last = readJSON(LAST_KEY, null);
    if (!last) {
      setStatus("尚無上次使用紀錄", "warn");
      return;
    }

    startInput.value = last.start || "";
    endInput.value = last.end || "";
    setStatus("已載入上次使用的站點");
  }

  async function applyGpsStart(force = false) {
    if (!navigator.geolocation) {
      gpsHint.textContent = "此裝置不支援定位，請手動輸入起點。";
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
          gpsHint.textContent = `已預設最近站點：${nearest.name}`;
          renderSuggestions("start", startInput.value);
          if (!endInput.value.trim()) {
            setStatus(`已使用目前位置預設起點：${nearest.name}`);
          }
        } else {
          gpsHint.textContent = "已取得定位，但找不到可用站點。";
        }
      },
      () => {
        gpsHint.textContent = "定位被拒絕或失敗，請手動輸入起點。";
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
      state.rideTimer = setInterval(() => {
        if (startInput.value.trim() && endInput.value.trim()) {
          checkRoute({ silent: true });
        }
      }, 30_000);
    }
  }

  function bindSuggestions(input, field) {
    input.addEventListener("input", () => renderSuggestions(field, input.value));
    input.addEventListener("focus", () => renderSuggestions(field, input.value));
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
    checkRoute();
  });

  swapBtn.addEventListener("click", swapStations);
  saveBtn.addEventListener("click", savePreset);
  gpsBtn.addEventListener("click", () => applyGpsStart(true));
  useLastBtn.addEventListener("click", loadLast);
  rideToggle.addEventListener("click", () => setRideMode(!state.rideMode));

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
    setStatus(`已載入配置：${preset.name}`);
  });

  bindSuggestions(startInput, "start");
  bindSuggestions(endInput, "end");
  bindSuggestionPanel(startSuggestions);
  bindSuggestionPanel(endSuggestions);

  renderPresets();
  setRideMode(state.rideMode);

  const last = readJSON(LAST_KEY, null);
  if (last) {
    startInput.value = last.start || "";
    endInput.value = last.end || "";
  }

  Promise.resolve()
    .then(loadStationCatalog)
    .then(() => {
      if (!startInput.value.trim()) {
        return applyGpsStart(false);
      }
      renderSuggestions("start", startInput.value);
      renderSuggestions("end", endInput.value);
      gpsHint.textContent = "站點清單已載入，可直接輸入查詢。";
      return null;
    })
    .catch(() => {
      gpsHint.textContent = "站點清單載入失敗，但仍可直接查詢。";
    });

  window.addEventListener("beforeunload", () => {
    if (state.rideTimer) {
      clearInterval(state.rideTimer);
    }
  });

  if (!utils) {
    setStatus("載入失敗：共享工具未初始化", "bad");
  }
})();
