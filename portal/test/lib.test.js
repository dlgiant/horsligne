import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apiFetch, parseInviteToken, fmtDual, statusLabel, riskLabel, createSessionStore } from "../lib.js";
import { createApp } from "../../backend/src/server.js";

test("parseInviteToken extracts 128-bit token from url or hash", () => {
  const tok = "NcF-M8JAHPsm67-Rfee_Bg";
  assert.equal(parseInviteToken(`https://portal.horslign.earth/p/${tok}`), tok);
  assert.equal(parseInviteToken(`http://localhost:8124/#/p/${tok}`), tok);
  assert.equal(parseInviteToken("http://localhost:8124/#/"), null);
  assert.equal(parseInviteToken("garbage"), null);
});

test("fmtDual renders venue tz + home tz", () => {
  // 2026-12-03T06:00:00-03:00 = 09:00 UTC = 10:00 Lisbon (winter, CET=UTC+1... Lisbon is WET=UTC+0 in winter!) 
  const out = fmtDual("2026-12-03T06:00:00-03:00", "America/Bahia", "Europe/Lisbon", "en");
  assert.match(out, /06:00/); // Bahia
  assert.match(out, /09:00/); // Lisbon (WET, UTC+0 in December)
  assert.match(out, /your time/);
  const pt = fmtDual("2026-12-03T06:00:00-03:00", "America/Bahia", "Europe/Lisbon", "pt");
  assert.match(pt, /seu fuso/);
});

test("labels PT/EN", () => {
  assert.equal(statusLabel("overdue", "en"), "Overdue");
  assert.equal(statusLabel("overdue", "pt"), "Atrasada");
  assert.equal(riskLabel("semi-risky", "pt"), "Semi-arriscado — proteções completas");
});

test("session store roundtrip with injected storage", () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const s = createSessionStore(storage);
  assert.equal(s.load(), null);
  s.save({ token: "abc" });
  assert.deepEqual(s.load(), { token: "abc" });
  s.clear();
  assert.equal(s.load(), null);
});

test("API contract used by the portal: start → verify → status → messages → catalog → book", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-portal-it-"));
  const srv = createApp({
    dataDir: dir, adminToken: "adm", sessionSecret: "s", publicDir: "none",
    otpDevReveal: true, loginMax: 1000, messageMax: 1000,
    portalBaseUrl: "http://localhost:8124/#"
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const admin = { authorization: "Bearer adm" };
  const post = (p, body, h = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...admin, ...h }, body: JSON.stringify(body) });
  try {
    // seed: traveler → trip → venue → offering → contact → booking paid → check-in
    await post("/api/travelers/register", { name: "Ana", email: "ana@example.com", password: "sup3r-secret-pw" });
    const login = await (await post("/api/travelers/login", { email: "ana@example.com", password: "sup3r-secret-pw" })).json();
    const trip = (await (await post("/api/trips", { travelerFirstName: "Ana", destination: "Chapada Diamantina", city: "Lençóis", startDate: "2026-12-01", endDate: "2026-12-06", homeTz: "Europe/Lisbon" }, { authorization: `Bearer ${login.session}` })).json()).trip;
    const venue = (await (await post("/api/venues", { name: "Pousada Chapada", city: "Lençóis", destination: "Chapada Diamantina", emergencyChannel: { type: "landline", contact: "+55 75 3xxx-xxxx" } })).json()).venue;
    const off = (await (await post(`/api/venues/${venue.id}/sessions`, {
      title: "Sunrise hike + meditation", kind: "hike",
      startAt: "2026-12-03T06:00:00-03:00", endAt: "2026-12-03T09:00:00-03:00",
      capacity: 5, priceCentsBRL: 9000, risk: "moderate"
    })).json()).session;
    const issued = await (await post(`/api/trips/${trip.id}/contacts`, { name: "Carlos", channel: "sms", identifier: "+351 912 345 678" }, { authorization: `Bearer ${login.session}` })).json();
    const bk = (await (await post(`/api/sessions/${off.id}/book`, { tripId: trip.id }, { authorization: `Bearer ${login.session}` })).json()).booking;
    await post("/api/webhooks/revenuecat", { bookingId: bk.id, event: "payment.succeeded" });
    const run = (await (await post(`/api/bookings/${bk.id}/check-in`, { custody: "sealed_pouch", claimCode: "HD-4821" })).json()).run;

    // portal login exactly as app.js does it
    const token = parseInviteToken(issued.portalUrl);
    assert.ok(token, "issued portalUrl must parse with parseInviteToken");
    const start = await apiFetch(base, "/api/portal/start", { method: "POST", body: { linkToken: token, password: issued.password } });
    assert.equal(start.status, 200);
    const ver = await apiFetch(base, "/api/portal/verify", { method: "POST", body: { otpId: start.data.otpId, otp: start.data.devOtp } });
    assert.equal(ver.status, 200);
    const sess = ver.data.session;

    const status = await apiFetch(base, "/api/portal/status", { token: sess });
    assert.equal(status.status, 200);
    assert.equal(status.data.run.status, "in_progress");
    assert.equal(status.data.run.offering.title, "Sunrise hike + meditation");
    assert.equal(status.data.homeTz, "Europe/Lisbon");
    assert.equal(status.data.run.venue.city, "Lençóis");

    const sent = await apiFetch(base, "/api/portal/messages", { method: "POST", token: sess, body: { text: "Mom fell — call us", urgency: "urgent" } });
    assert.equal(sent.status, 201);
    assert.equal(sent.data.message.verification, "pending");

    const cat = await apiFetch(base, "/api/portal/catalog", { token: sess });
    assert.equal(cat.status, 200);
    assert.ok(cat.data.catalog.some((c) => c.id === off.id && c.risk === "moderate"));

    const booked = await apiFetch(base, "/api/portal/book", { method: "POST", token: sess, body: { offeringId: off.id, gift: true } });
    assert.equal(booked.status, 201);
    assert.equal(booked.data.booking.gift, true);

    const myBookings = await apiFetch(base, "/api/portal/bookings", { token: sess });
    assert.equal(myBookings.data.bookings.length, 2);

    // check-out → summary visible to portal
    await post(`/api/runs/${run.id}/check-out`, {});
    const sum = await apiFetch(base, `/api/runs/${run.id}/summary`, { token: sess });
    assert.equal(sum.status, 200);
    assert.equal(sum.data.summary.messages.length, 1);
    assert.equal(sum.data.summary.messages[0].delivered, true);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
