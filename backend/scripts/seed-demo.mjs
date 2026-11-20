#!/usr/bin/env node
// seed-demo.mjs — seeds the fictional demo data from docs/02-demo-script-30min.md:
// traveler "Ana Lima", trip "Chapada Diamantina, 5 days", venue with landline,
// sunrise hike (in progress, pouch HD-4821), paddleboarding gift option, and
// portal contact "Carlos (brother, Lisbon)" whose invite link + password are printed.
//
// Usage:
//   ADMIN_TOKEN=devtoken node scripts/seed-demo.mjs
//   API_BASE=http://localhost:3000 ADMIN_TOKEN=devtoken node scripts/seed-demo.mjs

import { setTimeout as sleep } from "node:timers/promises";

const API = process.env.API_BASE || "http://localhost:3000";
const ADMIN = process.env.ADMIN_TOKEN || "";
const PORTAL_BASE = process.env.PORTAL_BASE_URL || "http://localhost:8124/#";

const post = async (p, body, token) => {
  const res = await fetch(API + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`POST ${p} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
};

const day = (offset, h = 0, m = 0) => {
  const d = new Date(Date.now() + offset * 86400000);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

async function main() {
  // health check
  const health = await fetch(API + "/api/health").then((r) => r.json());
  console.log("API:", JSON.stringify(health));

  // traveler + trip
  await post("/api/travelers/register", { name: "Ana Lima", email: "ana@demo.horslign.earth", password: "demo-password-1" })
    .catch((e) => { if (!String(e.message).includes("409")) throw e; });
  const login = await post("/api/travelers/login", { email: "ana@demo.horslign.earth", password: "demo-password-1" });
  const T = login.session;
  const trip = (await post("/api/trips", {
    travelerFirstName: "Ana",
    destination: "Chapada Diamantina",
    city: "Lençóis",
    startDate: day(1).slice(0, 10),
    endDate: day(6).slice(0, 10),
    homeTz: "Europe/Lisbon"
  }, T)).trip;
  console.log("trip:", trip.id, trip.destination);

  // venue (landline) + two offerings
  const venue = (await post("/api/venues", {
    name: "Pousada Chapada",
    city: "Lençóis",
    destination: "Chapada Diamantina",
    tz: "America/Bahia",
    emergencyChannel: { type: "landline", contact: "+55 75 3xxx-xxxx" }
  }, ADMIN)).venue;
  const hike = (await post(`/api/venues/${venue.id}/sessions`, {
    title: "Sunrise hike + meditation",
    kind: "hike",
    startAt: day(2, 6, 0),
    endAt: day(2, 9, 0),
    capacity: 8,
    priceCentsBRL: 9000,
    risk: "moderate"
  }, ADMIN)).session;
  const paddle = (await post(`/api/venues/${venue.id}/sessions`, {
    title: "Paddleboarding on Rio Lençóis",
    kind: "paddle",
    startAt: day(5, 10, 0),
    endAt: day(5, 12, 0),
    capacity: 6,
    priceCentsBRL: 12000,
    risk: "low"
  }, ADMIN)).session;
  console.log("offerings:", hike.title, "/", paddle.title);

  // portal contact (Carlos, Lisbon) — prints invite link + one-time password
  const issued = await post(`/api/trips/${trip.id}/contacts`, {
    name: "Carlos (brother, Lisbon)",
    channel: "sms",
    identifier: "+351 912 345 678"
  }, T);
  console.log("\n=== PORTAL ACCESS FOR DEMO ===");
  console.log("link:     ", issued.portalUrl.replace(/^.*?#/, PORTAL_BASE + "p/") === issued.portalUrl ? issued.portalUrl : issued.portalUrl);
  console.log("password: ", issued.password);
  console.log("(OTP appears in API response with OTP_DEV_REVEAL=1)\n");

  // book + pay + check-in the hike so the demo starts "in progress"
  const booking = (await post(`/api/sessions/${hike.id}/book`, { tripId: trip.id }, T)).booking;
  await post("/api/webhooks/revenuecat", { bookingId: booking.id, event: "payment.succeeded" });
  const run = (await post(`/api/bookings/${booking.id}/check-in`, { custody: "sealed_pouch", claimCode: "HD-4821" }, ADMIN)).run;
  console.log("run:", run.id, run.status, "| expected check-out:", run.expectedCheckOut);
  console.log("\nDemo ready. Portal: serve portal/ statically (e.g. python3 -m http.server 8124) and open the link above.");
  await sleep(50);
}

main().catch((e) => { console.error(e); process.exit(1); });
