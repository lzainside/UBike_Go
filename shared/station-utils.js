(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.UBikeUtils = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DATA_URL = "https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json";
  const DEFAULT_CACHE_TTL_MS = 55_000;
  const PREFIX_RE = /^youbike2\.0[_-]?/i;

  function normalizeText(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[()（）]/g, "")
      .replace(PREFIX_RE, "");
  }

  function stripBikePrefix(name) {
    return String(name ?? "").replace(/^YouBike2\.0_/, "");
  }

  function formatStationView(station) {
    return {
      name: stripBikePrefix(station.sna),
      raw_name: station.sna,
      bikes: Number(station.sbi ?? station.available_rent_bikes ?? 0),
      slots: Number(station.bemp ?? station.available_return_bikes ?? 0),
      lat: Number(station.lat ?? station.latitude ?? 0),
      lng: Number(station.lng ?? station.longitude ?? 0),
      active: String(station.act ?? "1") === "1"
    };
  }

  function scoreStationMatch(station, queryNorm) {
    const displayName = normalizeText(stripBikePrefix(station.sna));
    const rawName = normalizeText(station.sna);

    if (!queryNorm) {
      return Number.POSITIVE_INFINITY;
    }

    if (displayName === queryNorm || rawName === queryNorm) {
      return 0;
    }

    const variants = [displayName, rawName].filter(Boolean);
    let best = Number.POSITIVE_INFINITY;

    for (const variant of variants) {
      const index = variant.indexOf(queryNorm);
      if (index !== -1) {
        const lengthPenalty = Math.abs(variant.length - queryNorm.length);
        const prefixPenalty = index === 0 ? 0 : 250;
        const activePenalty = String(station.act ?? "1") === "1" ? 0 : 100;
        const score = prefixPenalty + lengthPenalty + activePenalty + index;
        if (score < best) {
          best = score;
        }
      }
    }

    return best;
  }

  function findBestStation(stations, query) {
    const queryNorm = normalizeText(query);
    if (!queryNorm) {
      return null;
    }

    let bestStation = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const station of stations) {
      const score = scoreStationMatch(station, queryNorm);
      if (score < bestScore) {
        bestScore = score;
        bestStation = station;
      }
    }

    if (!bestStation || !Number.isFinite(bestScore)) {
      return null;
    }

    return { station: bestStation, score: bestScore };
  }

  function toRadians(value) {
    return (value * Math.PI) / 180;
  }

  function distanceMeters(a, b) {
    const lat1 = Number(a.lat);
    const lon1 = Number(a.lng);
    const lat2 = Number(b.lat);
    const lon2 = Number(b.lng);

    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) {
      return Number.POSITIVE_INFINITY;
    }

    const earthRadius = 6_371_000;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const aValue =
      sinLat * sinLat +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * sinLon * sinLon;
    const c = 2 * Math.atan2(Math.sqrt(aValue), Math.sqrt(1 - aValue));
    return earthRadius * c;
  }

  function buildNearbyStations(stations, targetStation, count = 2) {
    if (!targetStation) {
      return [];
    }

    return stations
      .filter((station) => station.sno !== targetStation.sno)
      .map((station) => {
        const view = formatStationView(station);
        return {
          station: view.name,
          bikes: view.bikes,
          slots: view.slots,
          distance_m: Math.round(distanceMeters(targetStation, station))
        };
      })
      .filter((item) => Number.isFinite(item.distance_m))
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, count);
  }

  function makeDecision(startStation, endStation) {
    const startBikes = Number(startStation?.sbi ?? startStation?.available_rent_bikes ?? 0);
    const endSlots = Number(endStation?.bemp ?? endStation?.available_return_bikes ?? 0);
    const ride = startBikes >= 1 && endSlots >= 1;

    return {
      start_station: stripBikePrefix(startStation?.sna ?? ""),
      start_bikes: startBikes,
      end_station: stripBikePrefix(endStation?.sna ?? ""),
      end_slots: endSlots,
      decision: ride ? "ride" : "walk",
      message: ride ? "可騎Ubike" : "建議步行",
      reasons: ride
        ? []
        : [
            ...(startBikes >= 1 ? [] : [`起點車輛不足（${startBikes}）`]),
            ...(endSlots >= 1 ? [] : [`終點車位不足（${endSlots}）`])
          ]
    };
  }

  function createStationCache(fetchImpl, dataUrl = DATA_URL, ttlMs = DEFAULT_CACHE_TTL_MS) {
    const cache = {
      data: null,
      fetchedAt: 0,
      pending: null
    };

    return async function loadStations() {
      const isFresh = cache.data && Date.now() - cache.fetchedAt < ttlMs;
      if (isFresh) {
        return cache.data;
      }

      if (cache.pending) {
        return cache.pending;
      }

      cache.pending = (async () => {
        const response = await fetchImpl(dataUrl, {
          headers: {
            accept: "application/json"
          }
        });

        if (!response.ok) {
          throw new Error(`upstream response ${response.status}`);
        }

        const json = await response.json();
        if (!Array.isArray(json)) {
          throw new Error("invalid station payload");
        }

        cache.data = json;
        cache.fetchedAt = Date.now();
        return json;
      })().finally(() => {
        cache.pending = null;
      });

      return cache.pending;
    };
  }

  function serializeStationCatalog(stations) {
    return stations.map((station) => {
      const view = formatStationView(station);
      return {
        sno: station.sno,
        name: view.name,
        raw_name: view.raw_name,
        bikes: view.bikes,
        slots: view.slots,
        lat: view.lat,
        lng: view.lng,
        active: view.active
      };
    });
  }

  function jsonResponse(statusCode, body) {
    return {
      statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "content-type"
      },
      body: JSON.stringify(body)
    };
  }

  function createCheckHandler(options = {}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const dataUrl = options.dataUrl ?? DATA_URL;
    const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    const loadStations = createStationCache(fetchImpl, dataUrl, ttlMs);

    return async function handler(event) {
      const rawUrl = event?.rawUrl || event?.url || event?.path || "https://example.com/check";
      const url = new URL(rawUrl, "https://example.com");
      const start = url.searchParams.get("start") || "";
      const end = url.searchParams.get("end") || "";
      const watch = url.searchParams.get("watch") === "1";
      const listOnly = url.searchParams.get("list") === "1";

      try {
        const stations = await loadStations();

        if (listOnly) {
          return jsonResponse(200, {
            stations: serializeStationCatalog(stations),
            updated_at: new Date().toISOString()
          });
        }

        const startMatch = findBestStation(stations, start);
        const endMatch = findBestStation(stations, end);

        if (!startMatch || !endMatch) {
          return jsonResponse(404, {
            error: "station_not_found",
            message: "站點不存在",
            found_start: Boolean(startMatch),
            found_end: Boolean(endMatch)
          });
        }

        const startView = formatStationView(startMatch.station);
        const endView = formatStationView(endMatch.station);
        const decision = makeDecision(startMatch.station, endMatch.station);

        const response = {
          ...decision,
          start_station: startView.name,
          start_bikes: startView.bikes,
          end_station: endView.name,
          end_slots: endView.slots,
          updated_at: new Date().toISOString()
        };

        if (watch || response.end_slots === 0) {
          response.nearby_stations = buildNearbyStations(stations, endMatch.station, 2);
        }

        return jsonResponse(200, response);
      } catch (error) {
        return jsonResponse(503, {
          error: "fetch_failed",
          message: "系統暫時無法取得資料"
        });
      }
    };
  }

  return {
    DATA_URL,
    normalizeText,
    stripBikePrefix,
    formatStationView,
    scoreStationMatch,
    findBestStation,
    distanceMeters,
    buildNearbyStations,
    makeDecision,
    createStationCache,
    serializeStationCatalog,
    createCheckHandler,
    jsonResponse
  };
});
