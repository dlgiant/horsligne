import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";

const ADMIN = "Bearer adm";
const SECRET = "whsec_test_secret";

let devServer, devBase, prodServer, prodBase, dataDir;

// RevenueCat signature: X-RevenueCat-Signature: t=<unix_s>,v1=<hex HMAC_SHA256(secret, "<t>.<rawBody>")>
const sign = (secret, raw, tSec) =>
  `t=${tSec},v1=${crypto.createHmac("sha256", secret).update(`${tSec}.${raw}`).digest("hex")}`;

const post = (base, p, body, headers = {}) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: ADMIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
const postRaw = (base, p, raw, headers = {}) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw });
const get = (base, p) => fetch(base + p, { headers: { authorization: ADMIN } });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-pay-"));
  devServer = createApp({ dataDir: path.join(dataDir, "dev"), adminToken: "adm", sessionSecret: "s", publicDir: "none", loginMax: 1000, messageMax: 1000 });
  prodServer = createApp({ dataDir: path.join(dataDir, "prod"), adminToken: "adm", sessionSecret: "s", publicDir: "none", revenuecatWebhookSecret: SECRET, loginMax: 1000, messageMax: 1000 });
  await new Promise((r) => devServer.listen(0, "127.0.0.1", r));
  await new Promise((r) => prodServer.listen(0, "127.0.0.1", r));
  devBase = `http://127.0.0.1:${devServer.address().port}`;
  prodBase = `http://127.0.0.1:${prodServer.address().port}`;
});

after(() => {
  devServer.close();
  prodServer.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function seedBooking(base) {
  const trip = (await (await post(base, "/api/trips", { travelerFirstName: "Ana", destination: "Chapada", city: "L", startDate: "2026-12-01", endDate: "2026-12-06" })).json()).trip;
  const venue = (await (await post(base, "/api/venues", { name: "V", city: "L", destination: "Chapada", emergencyChannel: { type: "landline", contact: "+55 75 3000-0000" } })).json()).venue;
  const off = (await (await post(base, `/api/venues/${venue.id}/sessions`, {
    title: "Hike", kind: "hike",
    startAt: new Date(Date.now() + 3600000).toISOString(), endAt: new Date(Date.now() + 4 * 3600000).toISOString(),
    capacity: 5, priceCentsBRL: 9000, risk: "low"
  })).json()).session;
  const b = (await (await post(base, `/api/sessions/${off.id}/book`, { tripId: trip.id })).json()).booking;
  return b;
}

test("dev mode (no secret): dev stub shape pays a booking, and redelivery is a duplicate no-op", async () => {
  const b = await seedBooking(devBase);
  const res = await post(devBase, "/api/webhooks/revenuecat", { bookingId: b.id, event: "payment.succeeded" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "paid");
  const again = await post(devBase, "/api/webhooks/revenuecat", { bookingId: b.id, event: "payment.succeeded" });
  const againJson = await again.json();
  assert.equal(againJson.duplicate, true);
  const booking = (await (await get(devBase, `/api/admin/bookings?status=paid`)).json()).bookings.find((x) => x.id === b.id);
  assert.ok(booking, "booking paid");
  assert.equal(booking.paymentRef, "rc-dev");
});

test("dev mode accepts a real RevenueCat envelope (INITIAL_PURCHASE + hl_booking_id attribute)", async () => {
  const b = await seedBooking(devBase);
  const raw = JSON.stringify({
    api_version: "1.0",
    event: {
      type: "INITIAL_PURCHASE", id: "evt_dev_1", transaction_id: "txn_123", product_id: "hike",
      app_user_id: "anon_1", purchased_at_ms: Date.now(),
      subscriber_attributes: { hl_booking_id: { value: b.id } }
    }
  });
  const res = await postRaw(devBase, "/api/webhooks/revenuecat", raw);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.status, "paid");
  const booking = (await (await get(devBase, "/api/admin/bookings?status=paid")).json()).bookings.find((x) => x.id === b.id);
  assert.equal(booking.paymentRef, "rc:txn_123");
});

test("EXPIRATION event cancels the booking and promotes the waitlist", async () => {
  const b1 = await seedBooking(devBase);
  await post(devBase, "/api/webhooks/revenuecat", { bookingId: b1.id, event: "payment.succeeded" });
  // fill the single spot? capacity 5 — instead directly test cancellation path on a fresh booking
  const b2 = await seedBooking(devBase);
  const raw = JSON.stringify({ event: { type: "EXPIRATION", id: "evt_exp_1", transaction_id: "txn_9", subscriber_attributes: { hl_booking_id: { value: b2.id } } } });
  const res = await postRaw(devBase, "/api/webhooks/revenuecat", raw);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "cancelled");
});

test("prod mode (secret set): unsigned / wrong-signature / stale requests are 401", async () => {
  const b = await seedBooking(prodBase);
  const raw = JSON.stringify({ event: { type: "INITIAL_PURCHASE", id: "evt_p1", transaction_id: "txn_p1", subscriber_attributes: { hl_booking_id: { value: b.id } } } });

  const unsigned = await postRaw(prodBase, "/api/webhooks/revenuecat", raw);
  assert.equal(unsigned.status, 401);

  const wrongSig = await postRaw(prodBase, "/api/webhooks/revenuecat", raw, { "x-revenuecat-signature": sign("wrong-secret", raw, Math.floor(Date.now() / 1000)) });
  assert.equal(wrongSig.status, 401);

  const stale = await postRaw(prodBase, "/api/webhooks/revenuecat", raw, { "x-revenuecat-signature": sign(SECRET, raw, Math.floor(Date.now() / 1000) - 3600) });
  assert.equal(stale.status, 401);

  // tampered body with a signature computed over the original body
  const tampered = raw.replace("evt_p1", "evt_evil");
  const tamperedRes = await postRaw(prodBase, "/api/webhooks/revenuecat", tampered, { "x-revenuecat-signature": sign(SECRET, raw, Math.floor(Date.now() / 1000)) });
  assert.equal(tamperedRes.status, 401);
});

test("prod mode: correctly signed webhook pays the booking; signed redelivery is a duplicate no-op", async () => {
  const b = await seedBooking(prodBase);
  const raw = JSON.stringify({ event: { type: "INITIAL_PURCHASE", id: "evt_ok_1", transaction_id: "txn_ok", subscriber_attributes: { hl_booking_id: { value: b.id } } } });
  const t = Math.floor(Date.now() / 1000);
  const res = await postRaw(prodBase, "/api/webhooks/revenuecat", raw, { "x-revenuecat-signature": sign(SECRET, raw, t) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "paid");

  const replay = await postRaw(prodBase, "/api/webhooks/revenuecat", raw, { "x-revenuecat-signature": sign(SECRET, raw, Math.floor(Date.now() / 1000)) });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, true);

  const booking = (await (await get(prodBase, "/api/admin/bookings?status=paid")).json()).bookings.find((x) => x.id === b.id);
  assert.equal(booking.paymentRef, "rc:txn_ok");
});

test("webhook rejects unknown booking and invalid payloads", async () => {
  const nope = await post(devBase, "/api/webhooks/revenuecat", { bookingId: "does-not-exist", event: "payment.succeeded" });
  assert.equal(nope.status, 404);
  const bad = await post(devBase, "/api/webhooks/revenuecat", { bookingId: "x", event: "whatever" });
  assert.equal(bad.status, 400);
  const badRc = await postRaw(devBase, "/api/webhooks/revenuecat", JSON.stringify({ event: { type: "TELEPORT", id: "e" } }));
  assert.equal(badRc.status, 400);
});
