const assert = require("node:assert/strict");
const {
  findBestStation,
  makeDecision,
  createCheckHandler,
  normalizeText
} = require("../shared/station-utils");

const stations = [
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
  },
  {
    sno: "3",
    sna: "YouBike2.0_六張犁",
    sbi: 6,
    bemp: 0,
    lat: 25.0238,
    lng: 121.552,
    act: "1"
  }
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
    await run("fuzzy match finds partial station name", () => {
      const match = findBestStation(stations, "科技");
      assert.ok(match.station.sna.includes("科技"));
    })
  );

  results.push(
    await run("decision is ride when bikes and slots are available", () => {
      const result = makeDecision(stations[0], stations[1]);
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
      const result = makeDecision(stations[0], stations[2]);
      assert.equal(result.decision, "walk");
      assert.deepEqual(result.reasons, ["終點車位不足（0）"]);
    })
  );

  results.push(
    await run("handler returns station_not_found for unknown station", async () => {
      const handler = createCheckHandler({
        fetchImpl: async () => ({
          ok: true,
          json: async () => stations
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
    await run("handler returns api failure when upstream fails", async () => {
      const handler = createCheckHandler({
        fetchImpl: async () => {
          throw new Error("network down");
        },
        ttlMs: 0
      });

      const response = await handler({
        rawUrl: "https://example.com/check?start=科技&end=六張犁"
      });

      assert.equal(response.statusCode, 503);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "fetch_failed");
    })
  );

  results.push(
    await run("handler returns station catalog for list mode", async () => {
      const handler = createCheckHandler({
        fetchImpl: async () => ({
          ok: true,
          json: async () => stations
        }),
        ttlMs: 0
      });

      const response = await handler({
        rawUrl: "https://example.com/check?list=1"
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.stations.length, stations.length);
      assert.equal(body.stations[0].name, "捷運科技大樓站");
    })
  );

  if (results.every(Boolean)) {
    console.log("All UBike GO tests passed.");
    process.exit(0);
  }

  process.exit(1);
}

main();
