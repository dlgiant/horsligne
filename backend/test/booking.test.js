import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";

let server;
let base;
let dataDir;
const ADMIN = "Bearer test-admin";

const post = (p, body, headers = {}) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: ADMIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
const get = (p, headers = {}) => fetch(base + p, { headers: { authorization: ADMIN, ...headers } });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-booking-"));
  server = createApp({
    dataDir,
    adminToken: "test-admin",
    sessionSecret: "test-secret",
    otpDevReveal: true,
    publicDir: "none",
    portalBaseUrl: "https://portal.horslign.earth",
    loginMax: 1000
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function makeTrip() {
  const res = await post("/api/trips", {
    travelerFirstName: "Ana", destination: "Chapada Diamantina", city: "Lençóis",
    startDate: "2026-12-01", endDate: "2026-12-06", homeTz: "Europe/Lisbon"
  });
  return (await res.json()).trip;
}

async function makeVenue() {
  const res = await post("/api/venues", {
    name: "Pousada Chapada",
    city: "Lençóis",
    destination: "Chapada Diamantina",
    tz: "America/Bahia",
    emergencyChannel: { type: "landline", contact: "+55 75 3xxx-xxxx" }
  });
  assert.equal(res.status, 201);
  return (await res.json()).venue;
}

async function makeOffering(venueId, overrides = {}) {
  const res = await post(`/api/venues/${venueId}/sessions`, {
    title: "Sunrise hike + meditation",
    kind: "hike",
    startAt: "2026-12-03T06:00:00-03:00",
    endAt: "2026-12-03T09:00:00-03:00",
    capacity: 2,
    priceCentsBRL: 9000,
    risk: "moderate",
    ...overrides
  });
  assert.equal(res.status, 201);
  return (await res.json()).session;
}

async function makePortalSession(tripId) {
  const cRes = await post(`/api/trips/${tripId}/contacts`, { name: "Carlos", channel: "email", identifier: "carlos@example.com" });
  const issued = await cRes.json();
  const token = issued.portalUrl.split("/p/")[1];
  const startRes = await post("/api/portal/start", { linkToken: token, password: issued.password }, {});
  const start = await startRes.json();
  const vRes = await post("/api/portal/verify", { otpId: start.otpId, otp: start.devOtp }, {});
  const login = await vRes.json();
  return { session: login.session, contact: login.contact };
}

test("venue requires an emergency channel (no channel = no sessions)", async () => {
  const res = await post("/api/venues", { name: "V", city: "C", destination: "D" });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.details.some((d) => d.field === "emergencyChannel"));
});

test("session validation: endAt after startAt, risk enum, capacity bounds", async () => {
  const venue = await makeVenue();
  let res = await post(`/api/venues/${venue.id}/sessions`, {
    title: "X", kind: "hike", startAt: "2026-12-03T09:00:00Z", endAt: "2026-12-03T06:00:00Z",
    capacity: 2, priceCentsBRL: 9000, risk: "low"
  });
  assert.equal(res.status, 400);
  res = await post(`/api/venues/${venue.id}/sessions`, {
    title: "X", kind: "hike", startAt: "2026-12-03T06:00:00Z", endAt: "2026-12-03T09:00:00Z",
    capacity: 0, priceCentsBRL: 9000, risk: "extreme"
  });
  assert.equal(res.status, 400);
});

test("catalog is public, risk-labeled, venue+city only (no GPS/phone of traveler)", async () => {
  const venue = await makeVenue();
  const o = await makeOffering(venue.id);
  const res = await fetch(`${base}/api/catalog?destination=Chapada`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const item = body.catalog.find((c) => c.id === o.id);
  assert.equal(item.risk, "moderate");
  assert.equal(item.priceBRL, "90.00");
  assert.equal(item.spotsLeft, 2);
  assert.equal(item.venue.name, "Pousada Chapada");
  assert.equal(item.venue.emergencyChannel.type, "landline");
  assert.ok(!JSON.stringify(item).includes("gps") && !JSON.stringify(item).includes("lat"));
});

test("booking flow: capacity, waitlist, payment webhook, cancel promotes waitlist", async () => {
  const venue = await makeVenue();
  const o = await makeOffering(venue.id, { capacity: 2 });
  const trip = await makeTrip();

  // two bookings fill capacity (capacity 2)
  let res = await post(`/api/sessions/${o.id}/book`, { tripId: trip.id });
  const b1 = (await res.json()).booking;
  assert.equal(res.status, 201);
  assert.equal(b1.status, "pending_payment");

  res = await post(`/api/sessions/${o.id}/book`, { tripId: trip.id });
  const b2 = (await res.json()).booking;

  // third -> waitlisted
  res = await post(`/api/sessions/${o.id}/book`, { tripId: trip.id });
  const b3 = await res.json();
  assert.equal(b3.booking.status, "waitlisted");
  assert.equal(b3.waitlisted, true);

  // session now full
  res = await fetch(`${base}/api/sessions/${o.id}`);
  const s = (await res.json()).session;
  assert.equal(s.status, "full");
  assert.equal(s.spotsLeft, 0);

  // payment webhook pays b1 and b2
  for (const b of [b1, b2]) {
    res = await post("/api/webhooks/revenuecat", { bookingId: b.id, event: "payment.succeeded" }, {});
    assert.equal((await res.json()).status, "paid");
  }

  // cancel b1 -> waitlisted b3 promoted to pending_payment
  res = await post(`/api/bookings/${b1.id}/cancel`, undefined);
  assert.equal(res.status, 200);
  res = await fetch(`${base}/api/sessions/${o.id}`);
  assert.equal((await res.json()).session.status, "full", "promoted booking re-fills the spot");
  res = await get(`/api/trips/${trip.id}/bookings`);
  const list = (await res.json()).bookings;
  assert.equal(list.find((b) => b.id === b3.booking.id).status, "pending_payment");

  // payment.failed cancels and promotes again
  res = await post("/api/webhooks/revenuecat", { bookingId: b3.booking.id, event: "payment.failed" }, {});
  assert.equal((await res.json()).status, "cancelled");
});

test("portal gift booking: contact books for traveler's trip, traveler decides", async () => {
  const venue = await makeVenue();
  const o = await makeOffering(venue.id, { capacity: 5, title: "Paddleboarding Rio Lençóis", risk: "low", priceCentsBRL: 12000 });
  const trip = await makeTrip();
  const { session } = await makePortalSession(trip.id);

  // portal catalog requires session
  let res = await fetch(`${base}/api/portal/catalog?destination=Chapada`, { headers: { authorization: `Bearer ${session}` } });
  assert.equal(res.status, 200);
  const cat = await res.json();
  assert.equal(cat.homeTz, "Europe/Lisbon");
  assert.ok(cat.catalog.some((c) => c.id === o.id));

  // book as gift
  res = await post("/api/portal/book", { offeringId: o.id, gift: true }, { authorization: `Bearer ${session}` });
  assert.equal(res.status, 201);
  const gift = (await res.json()).booking;
  assert.equal(gift.gift, true);
  assert.equal(gift.bookedBy.type, "contact");
  assert.equal(gift.decision, "pending");

  // contact cannot book for someone else's trip via generic route
  const otherTrip = await makeTrip();
  res = await post(`/api/sessions/${o.id}/book`, { tripId: otherTrip.id }, { authorization: `Bearer ${session}` });
  assert.equal(res.status, 403);

  // traveler accepts (admin stand-in)
  res = await post(`/api/bookings/${gift.id}/decide`, { accept: true });
  assert.equal((await res.json()).decision, "accepted");

  // decide on non-gift -> 400
  res = await post(`/api/sessions/${o.id}/book`, { tripId: trip.id, gift: false });
  const plain = (await res.json()).booking;
  res = await post(`/api/bookings/${plain.id}/decide`, { accept: true });
  assert.equal(res.status, 400);

  // no-show only on paid
  res = await post(`/api/bookings/${gift.id}/no-show`);
  assert.equal(res.status, 409);
  await post("/api/webhooks/revenuecat", { bookingId: gift.id, event: "payment.succeeded" }, {});
  res = await post(`/api/bookings/${gift.id}/no-show`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).noShowFee, true);
});

test("bookings require an existing trip; unknown session -> 404", async () => {
  const venue = await makeVenue();
  const o = await makeOffering(venue.id);
  let res = await post(`/api/sessions/${o.id}/book`, { tripId: "does-not-exist" });
  assert.equal(res.status, 400);
  res = await post(`/api/sessions/nope/book`, { tripId: "x" });
  assert.equal(res.status, 404);
});

test("audit contains booking lifecycle actions", async () => {
  const venue = await makeVenue();
  const o = await makeOffering(venue.id);
  const trip = await makeTrip();
  let res = await post(`/api/sessions/${o.id}/book`, { tripId: trip.id });
  const b = (await res.json()).booking;
  await post("/api/webhooks/revenuecat", { bookingId: b.id, event: "payment.succeeded" }, {});
  await post(`/api/bookings/${b.id}/cancel`, undefined);

  res = await get(`/api/audit?tripId=${trip.id}`);
  const actions = (await res.json()).events.map((e) => e.action);
  for (const a of ["booking.created", "payment.succeeded", "booking.cancelled"]) {
    assert.ok(actions.includes(a), `audit should contain ${a}`);
  }
});
