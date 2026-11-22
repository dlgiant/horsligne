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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-admin-"));
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

test("admin list endpoints require the admin token", async () => {
  for (const p of ["/api/admin/overview", "/api/admin/venues", "/api/admin/trips", "/api/admin/runs", "/api/admin/bookings", "/api/admin/waitlist", "/api/admin/revenue"]) {
    const res = await fetch(base + p); // no auth
    assert.equal(res.status, 401, p);
    const wrong = await fetch(base + p, { headers: { authorization: "Bearer nope" } });
    assert.equal(wrong.status, 401, p);
  }
});

test("overview + lists reflect seeded data; revenue sums paid bookings", async () => {
  await post("/api/waitlist", { name: "Waiter", email: "wait@example.com" }, {});
  const trip = (await (await post("/api/trips", { travelerFirstName: "Ana", destination: "Chapada", city: "L", startDate: "2026-12-01", endDate: "2026-12-06" })).json()).trip;
  const venue = (await (await post("/api/venues", { name: "V", city: "L", destination: "Chapada", emergencyChannel: { type: "landline", contact: "+55 75 3000-0000" }, approxLat: -12.56, approxLng: -41.31 })).json()).venue;
  const off = (await (await post(`/api/venues/${venue.id}/sessions`, {
    title: "Hike", kind: "hike",
    startAt: new Date(Date.now() + 3600000).toISOString(), endAt: new Date(Date.now() + 4 * 3600000).toISOString(),
    capacity: 5, priceCentsBRL: 9000, risk: "low"
  })).json()).session;
  const b1 = (await (await post(`/api/sessions/${off.id}/book`, { tripId: trip.id })).json()).booking;
  const b2 = (await (await post(`/api/sessions/${off.id}/book`, { tripId: trip.id })).json()).booking;
  await post("/api/webhooks/revenuecat", { bookingId: b1.id, event: "payment.succeeded" }, {});
  await post(`/api/bookings/${b2.id}/no-show`, undefined); // wait, b2 unpaid → 409; pay first
  await post("/api/webhooks/revenuecat", { bookingId: b2.id, event: "payment.succeeded" }, {});
  await post(`/api/bookings/${b2.id}/no-show`, undefined);
  const run = (await (await post(`/api/bookings/${b1.id}/check-in`, { custody: "accommodation_safe" })).json()).run;

  const ov = await (await get("/api/admin/overview")).json();
  assert.equal(ov.waitlistCount, 1);
  assert.equal(ov.counts.trips, 1);
  assert.equal(ov.counts.venues, 1);
  assert.equal(ov.counts.offerings, 1);
  assert.equal(ov.counts.activeRuns, 1);
  assert.equal(ov.bookingsByStatus.paid, 1);
  assert.equal(ov.bookingsByStatus.no_show, 1);
  assert.equal(ov.revenueCentsBRL, 9000, "no-show does not count as revenue");

  const venues = await (await get("/api/admin/venues")).json();
  assert.equal(venues.venues[0].offerings, 1);
  assert.ok(venues.venues[0].emergencyChannel.contact);
  assert.equal(venues.venues[0].approxLat, -12.56, "city-level coords exposed for the fuzzed map area");
  assert.equal(venues.venues[0].approxLng, -41.31);

  const trips = await (await get("/api/admin/trips")).json();
  assert.equal(trips.trips[0].bookings, 2);
  assert.equal(trips.trips[0].runs, 1);

  const runs = await (await get("/api/admin/runs")).json();
  assert.equal(runs.runs[0].id, run.id);
  assert.equal(runs.runs[0].overdue, false);

  const bookings = await (await get("/api/admin/bookings?status=no_show")).json();
  assert.equal(bookings.count, 1);
  assert.equal(bookings.bookings[0].noShowFee, undefined); // public view hides fee internals? (bookingPublic has no noShowFee) — just check status
  assert.equal(bookings.bookings[0].status, "no_show");

  const wl = await (await get("/api/admin/waitlist")).json();
  assert.equal(wl.entries[0].email, "wait@example.com");

  const rev = await (await get("/api/admin/revenue")).json();
  assert.equal(rev.totalCentsBRL, 9000);
  assert.equal(rev.perOffering[0].title, "Hike");
});
