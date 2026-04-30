const assert = require("node:assert/strict");
const {
  findBestStation,
  makeDecision,
  createCheckHandler,
  normalizeText,
  normalizeUpstreamStation
} = require("../shared/station-utils");

const taipeiStations = [
  {
    sno: "1",
    sna: "YouBike2.0_捷運科技大樓站",
    sbi: 8,
    bemp: 4,
    lat: 25.02605,
    lng: 121.5436,
    act: "1"
  },
  {
    sno: "2",
    sna: "YouBike2.0_科技大樓東側",
    sbi: 0,
    bemp: 5,
    lat: 25.02655,
    lng: 121.544,
    act: "1"
  }
];

const newTaipeiStations = [
  {
    sno: "500501001",
    sna: "YouBike2.0_捷運大坪林站(5號出口)",
    sbi_quantity: 6,
    yb2_quantity: 5,
    eyb_quantity: 1,
    bemp: 7,
    lat: 24.9821,
    lng: 121.5415,
    act: "1"
  },
  {
    sno: "500501002",
    sna: "YouBike2.0_捷運七張站",
    sbi_quantity: 2,
    yb2_quantity: 2,
    eyb_quantity: 0,
    bemp: 0,
    lat: 24.9757,
    lng: 121.5421,
    act: "1"
  }
];

const stations = [
  ...taipeiStations.map((station) => normalizeUpstreamStation(station, "taipei")),
  ...newTaipeiStations.map((station) => normalizeUpstreamStation(station, "newTaipei"))
];

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
    return true;
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    return false;
  }
}

async function main() {
  const results = [];

  results.push(
    await run("normalizeText removes spaces and case", () => {
      assert.equal(normalizeText(" 科技 大樓 "), "科技大樓");
      assert.equal(normalizeText("YouBike2.0_ABC"), "abc");
    })
  );

  results.push(
    await run("fuzzy match finds Taipei partial station name", () => {
      const match = findBestStation(stations, "科技");
      assert.ok(match.station.sna.includes("科技"));
    })
  );

  results.push(
    await run("fuzzy match finds New Taipei station name", () => {
      const match = findBestStation(stations, "大坪林");
      assert.ok(match.station.sna.includes("大坪林"));
    })
  );

  results.push(
    await run("decision is ride when bikes and slots are available", () => {
      const result = makeDecision(stations[0], stations[2]);
      assert.equal(result.decision, "ride");
      assert.equal(result.message, "可騎Ubike");
    })
  );

  results.push(
    await run("decision is walk when no bikes", () => {
      const result = makeDecision(stations[1], stations[0]);
      assert.equal(result.decision, "walk");
      assert.deepEqual(result.reasons, ["起點車輛不足（0）"]);
    })
  );

  results.push(
    await run("decision is walk when no slots", () => {
      const result = makeDecision(stations[0], stations[3]);
      assert.equal(result.decision, "walk");
      assert.deepEqual(result.reasons, ["終點車位不足（0）"]);
    })
  );

  results.push(
    await run("decision excludes electric bikes from start availability", () => {
      const electricOnlyStart = normalizeUpstreamStation(
        {
          sno: "500501003",
          sna: "YouBike2.0_電動車示範站",
          sbi_quantity: 1,
          yb2_quantity: 0,
          eyb_quantity: 1,
          bemp: 4,
          lat: 24.98,
          lng: 121.54,
          act: "1"
        },
        "newTaipei"
      );

      const result = makeDecision(electricOnlyStart, stations[0]);
      assert.equal(result.decision, "walk");
      assert.equal(result.start_bikes, 0);
      assert.equal(result.start_electric_bikes, 1);
      assert.deepEqual(result.reasons, ["起點車輛不足（0）"]);
    })
  );

  results.push(
    await run("handler returns station_not_found for unknown station", async () => {
      const handler = createCheckHandler({
        fetchImpl: async (url) => ({
          ok: true,
          json: async () => (url.includes("ntpc") ? newTaipeiStations : taipeiStations)
        }),
        ttlMs: 0
      });

      const response = await handler({
        rawUrl: "https://example.com/check?start=不存在&end=科技"
      });

      assert.equal(response.statusCode, 404);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "station_not_found");
    })
  );

  results.push(
    await run("handler response exposes regular and electric bike counts", async () => {
      const handler = createCheckHandler({
        fetchImpl: async (url) => ({
          ok: true,
          json: async () => (url.includes("ntpc") ? newTaipeiStations : taipeiStations)
        }),
        ttlMs: 0
      });

      const response = await handler({
        rawUrl: "https://example.com/check?start=大坪林&end=科技"
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.start_bikes, 5);
      assert.equal(body.start_regular_bikes, 5);
      assert.equal(body.start_electric_bikes, 1);
      assert.equal(body.start_total_bikes, 6);
    })
  );

  results.push(
    await run("handler returns api failure when upstream fails", async () => {
      const handler = createCheckHandler({
        fetchImpl: async () => {
          throw new Error("network down");
        },
        ttlMs: 0
      });

      const response = await handler({
        rawUrl: "https://example.com/check?start=科技&end=大坪林"
      });

      assert.equal(response.statusCode, 503);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "fetch_failed");
    })
  );

  results.push(
    await run("handler returns station catalog for list mode", async () => {
      const handler = createCheckHandler({
        fetchImpl: async (url) => ({
          ok: true,
          json: async () => (url.includes("ntpc") ? newTaipeiStations : taipeiStations)
        }),
        ttlMs: 0
      });

      const response = await handler({
        rawUrl: "https://example.com/check?list=1"
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.stations.length, 4);
      assert.equal(body.stations[2].name, "捷運大坪林站(5號出口)");
      assert.equal(body.stations[2].city, "newTaipei");
      assert.equal(body.stations[2].regular_bikes, 5);
      assert.equal(body.stations[2].electric_bikes, 1);
    })
  );

  if (results.every(Boolean)) {
    console.log("All UBike GO tests passed.");
    process.exit(0);
  }

  process.exit(1);
}

main();
