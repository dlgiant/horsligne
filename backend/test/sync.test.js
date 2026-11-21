import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";

let server;
let base;
let dataDir;
const ADMIN = "Bearer adm";

const post = (p, body, headers = {}) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: ADMIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
const get = (p, headers = {}) => fetch(base + p, { headers: { authorization: ADMIN, ...headers } });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-sync-"));
  server = createApp({
    dataDir, adminToken: "adm", sessionSecret: "s", publicDir: "none",
    otpDevReveal: true, loginMax: 1000, messageMax: 1000
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function seedPaidBooking() {
  const trip = (await (await post("/api/trips", { travelerFirstName: "Ana", destination: "Chapada", city: "Lençóis", startDate: "2026-12-01", endDate: "2026-12-06" })).json()).trip;
  const venue = (await (await post("/api/venues", { name: "Pousada", city: "Lençóis", destination: "Chapada", emergencyChannel: { type: "landline", contact: "+55 75 3000-0000" } })).json()).venue;
  const off = (await (await post(`/api/venues/${venue.id}/sessions`, {
    title: "Hike", kind: "hike",
    startAt: new Date(Date.now() + 3600000).toISOString(), endAt: new Date(Date.now() + 4 * 3600000).toISOString(),
    capacity: 5, priceCentsBRL: 9000, risk: "low"
  })).json()).session;
  const b = (await (await post(`/api/sessions/${off.id}/book`, { tripId: trip.id })).json()).booking;
  await post("/api/webhooks/revenuecat", { bookingId: b.id, event: "payment.succeeded" }, {});
  return b;
}

test("POST /api/sync requires the admin token and a valid batch", async () => {
  const noAuth = await fetch(base + "/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops: [] }) });
  assert.equal(noAuth.status, 401);
  const bad = await post("/api/sync", { ops: [] });
  assert.equal(bad.status, 400);
  const badPath = await post("/api/sync", { ops: [{ id: "x", method: "POST", path: "not-api" }] });
  assert.equal(badPath.status, 400);
});

test("sync applies queued staff ops through the real router, whitelisted paths only", async () => {
  const b = await seedPaidBooking();
  const batch = {
    ops: [
      { id: "op-1", method: "POST", path: `/api/bookings/${b.id}/check-in`, body: { custody: "sealed_pouch", claimCode: "HD-1234" } },
      { id: "op-2", method: "POST", path: "/api/trips", body: { travelerFirstName: "Evil" } } // not whitelisted
    ]
  };
  const res = await post("/api/sync", batch);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.count, 2);
  assert.equal(out.applied, 1);
  assert.equal(out.results[0].ok, true);
  assert.equal(out.results[0].status, 201);
  assert.ok(out.results[0].response.run.id);
  assert.equal(out.results[1].ok, false);
  assert.equal(out.results[1].status, 403);
  assert.equal(out.results[1].error.code, "path_not_allowed");
  // run really exists with the synced custody
  const runs = await (await get("/api/admin/runs")).json();
  assert.equal(runs.count, 1);
  assert.equal(runs.runs[0].phoneCustody.claimCode, "HD-1234");
});

test("sync is idempotent: replaying the same client op id returns the stored response, never re-applies", async () => {
  const b = await seedPaidBooking();
  const batch = { ops: [{ id: "op-dup", method: "POST", path: `/api/bookings/${b.id}/check-in`, body: { custody: "accommodation_safe" } }] };
  const first = await (await post("/api/sync", batch)).json();
  assert.equal(first.results[0].ok, true);
  assert.equal(first.results[0].replayed, undefined);
  const runId = first.results[0].response.run.id;

  const second = await (await post("/api/sync", batch)).json();
  assert.equal(second.results[0].ok, true);
  assert.equal(second.results[0].replayed, true);
  assert.equal(second.results[0].response.run.id, runId);

  const runs = await (await get("/api/admin/runs")).json();
  const forThisBooking = runs.runs.filter((r) => r.bookingId === b.id);
  assert.equal(forThisBooking.length, 1, "check-in replay must not create a second run");
});

test("sync chains ops in order: check-in then extend then check-out", async () => {
  const b = await seedPaidBooking();
  const res = await post("/api/sync", { ops: [{ id: "c1", method: "POST", path: `/api/bookings/${b.id}/check-in`, body: { custody: "accommodation_safe" } }] });
  const runId = (await res.json()).results[0].response.run.id;
  const res2 = await post("/api/sync", { ops: [
    { id: "c2", method: "POST", path: `/api/runs/${runId}/extend`, body: { minutes: 30 } },
    { id: "c3", method: "POST", path: `/api/runs/${runId}/check-out` }
  ] });
  const out = await res2.json();
  assert.ok(out.results.every((r) => r.ok), JSON.stringify(out.results));
  const run = (await (await get(`/api/runs/${runId}`)).json()).run;
  assert.equal(run.status, "checked_out");
  assert.ok(run.extendedCheckOut);
  assert.ok(run.checkedOutAt);
});
