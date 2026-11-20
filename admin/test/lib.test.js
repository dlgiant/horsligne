import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { apiFetch, createTokenStore, fmtMoney, bookingStatusLabel, runStatusLabel } from "../lib.js";
import { createApp } from "../../backend/src/server.js";

test("helpers: fmtMoney, labels, token store", () => {
  assert.equal(fmtMoney(9000), "R$ 90.00");
  assert.equal(bookingStatusLabel("no_show", "pt"), "No-show");
  assert.equal(runStatusLabel({ status: "in_progress", overdue: true }, "en"), "OVERDUE");
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const s = createTokenStore(storage);
  s.save("tok");
  assert.equal(s.load(), "tok");
  s.clear();
  assert.equal(s.load(), null);
});

test("admin console contract: token gates /api/admin/*, full management flow", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-admin-it-"));
  const srv = createApp({
    dataDir: dir, adminToken: "adm-secret", sessionSecret: "s", publicDir: "none",
    otpDevReveal: true, loginMax: 1000, messageMax: 1000
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const T = "adm-secret";
  const post = (p, body, token = T) => apiFetch(base, p, { method: "POST", token, body });
  try {
    // wrong token -> 401 on every admin list endpoint
    for (const p of ["/api/admin/overview", "/api/admin/venues", "/api/admin/trips", "/api/admin/runs", "/api/admin/bookings", "/api/admin/waitlist", "/api/admin/revenue"]) {
      const r = await apiFetch(base, p, { token: "wrong" });
      assert.equal(r.status, 401, p);
    }

    // seed via admin + traveler paths
    await post("/api/waitlist", { name: "W", email: "w@example.com" }, null);
    await post("/api/travelers/register", { name: "Ana", email: "ana@example.com", password: "sup3r-secret-pw" }, null);
    const login = await post("/api/travelers/login", { email: "ana@example.com", password: "sup3r-secret-pw" }, null);
    const trip = (await post("/api/trips", { travelerFirstName: "Ana", destination: "Chapada", city: "L", startDate: "2026-12-01", endDate: "2026-12-06" }, login.data.session)).data.trip;
    const venue = (await post("/api/venues", { name: "V", city: "L", destination: "Chapada", emergencyChannel: { type: "satellite", contact: "inReach 1" } })).data.venue;
    const off = (await post(`/api/venues/${venue.id}/sessions`, {
      title: "Hike", kind: "hike",
      startAt: new Date(Date.now() + 3600000).toISOString(), endAt: new Date(Date.now() + 4 * 3600000).toISOString(),
      capacity: 2, priceCentsBRL: 9000, risk: "moderate"
    })).data.session;
    const bk = (await post(`/api/sessions/${off.id}/book`, { tripId: trip.id }, login.data.session)).data.booking;
    await post("/api/webhooks/revenuecat", { bookingId: bk.id, event: "payment.succeeded" }, null);
    const run = (await post(`/api/bookings/${bk.id}/check-in`, { custody: "sealed_pouch", claimCode: "HD-4821" })).data.run;

    // admin lists
    const ov = await apiFetch(base, "/api/admin/overview", { token: T });
    assert.equal(ov.data.counts.trips, 1);
    assert.equal(ov.data.counts.activeRuns, 1);
    assert.equal(ov.data.revenueCentsBRL, 9000);

    const runs = await apiFetch(base, "/api/admin/runs", { token: T });
    assert.equal(runs.data.runs[0].id, run.id);

    const log = await apiFetch(base, `/api/runs/${run.id}/messages`, { token: T });
    assert.equal(log.status, 200);

    // staff actions the console performs
    const ext = await post(`/api/runs/${run.id}/extend`, { minutes: 30 });
    assert.equal(ext.status, 200);
    const co = await post(`/api/runs/${run.id}/check-out`, {});
    assert.equal(co.status, 200);
    assert.equal(co.data.summary.phoneFreeMinutes >= 0, true);

    const rev = await apiFetch(base, "/api/admin/revenue", { token: T });
    assert.equal(rev.data.totalCentsBRL, 9000);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
