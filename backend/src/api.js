// API routes: waitlist, trips, portal auth (link + password + OTP), audit.
// Implements docs/04-portal-security-spec.md on top of JSONL collections.
//
// Deviation from spec §1, documented: credentials are usable from issuance
// (not only from trip start) until trip end + 24h, because families log in
// pre-trip to book gifts (master plan §4 "Explore & book").

import crypto from "node:crypto";
import { createCollection } from "./collections.js";
import { createStore } from "./store.js";
import * as sec from "./security.js";
import {
  validateWaitlist,
  validateTrip,
  validateContact,
  validatePortalStart,
  validateOtpPayload,
  validateVenue,
  validateSession,
  validateBook,
  validateDecide,
  validatePaymentWebhook
} from "./validate.js";

const OTP_TTL_MS = 10 * 60 * 1000;      // spec §1: 10-min expiry
const OTP_MAX_ATTEMPTS = 5;             // spec §1: 5 attempts then lockout
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // spec §1: 24h sliding
const GRACE_MS = 24 * 60 * 60 * 1000;   // spec §1: trip end + 24h

export function createApi(opts = {}) {
  const dataDir = opts.dataDir;
  const adminToken = opts.adminToken ?? null;
  const portalBaseUrl = String(opts.portalBaseUrl || "http://localhost:8080").replace(/\/+$/, "");
  const sessionSecret = opts.sessionSecret || "dev-secret-change-me";
  const otpDevReveal = Boolean(opts.otpDevReveal);

  const waitlist = createStore(dataDir);
  const trips = createCollection(dataDir, "trips.jsonl");
  const contacts = createCollection(dataDir, "contacts.jsonl");
  const portalSessions = createCollection(dataDir, "sessions.jsonl");
  const audit = createCollection(dataDir, "audit.jsonl");
  const notifications = createCollection(dataDir, "notifications.jsonl"); // outbound queue (SMS/email/SSE plug in under infra/)
  const venues = createCollection(dataDir, "venues.jsonl");
  const offerings = createCollection(dataDir, "offerings.jsonl"); // bookable sessions
  const bookings = createCollection(dataDir, "bookings.jsonl");

  const loginLimiter = new sec.RateLimiter({ windowMs: 15 * 60 * 1000, max: opts.loginMax ?? 5 });   // spec §5: 5/15min
  const otpResendLimiter = new sec.RateLimiter({ windowMs: 10 * 60 * 1000, max: opts.otpResendMax ?? 3 }); // spec §5: 3/10min

  function send(res, status, obj, cors) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), ...cors });
    res.end(body);
  }

  function auditEvent(req, actorType, actorId, action, objectType, objectId, detail) {
    return audit.add({
      actorType, actorId, action, objectType, objectId,
      ip: req.socket.remoteAddress || "",
      userAgent: req.headers["user-agent"] || "",
      detail: detail || {}
    });
  }

  function isAdmin(req) {
    if (!adminToken) return true;
    return (req.headers.authorization || "") === `Bearer ${adminToken}`;
  }

  function notFound(res, cors) {
    send(res, 404, { error: { code: "not_found", message: "Route not found" } }, cors);
  }

  function badRequest(res, cors, errors) {
    send(res, 400, { error: { code: "validation", message: "Invalid payload", details: errors } }, cors);
  }

  // ---- portal helpers ----

  function findContactByToken(linkToken) {
    const hash = sec.sha256hex(linkToken);
    return contacts.findWhere((c) => c.linkTokenHash === hash)[0] || null;
  }

  function tripOf(contact) {
    return trips.find(contact.tripId);
  }

  function contactUsable(contact, trip) {
    if (contact.revoked) return { code: "revoked", status: 403, message: "Credential revoked by traveler" };
    if (contact.expiresAt && Date.now() > Date.parse(contact.expiresAt)) {
      return { code: "expired", status: 410, message: "Credential expired (trip end + 24h)" };
    }
    if (!trip) return { code: "trip_gone", status: 410, message: "Trip no longer exists" };
    return null;
  }

  /** Data minimization (spec §3): never phone/GPS/payment. */
  function safeTrip(trip) {
    return {
      id: trip.id,
      travelerFirstName: trip.travelerFirstName,
      destination: trip.destination,
      city: trip.city,
      startDate: trip.startDate,
      endDate: trip.endDate,
      homeTz: trip.homeTz,
      status: trip.status
    };
  }

  function safeContactPublic(c) {
    return { id: c.id, name: c.name, channel: c.channel };
  }

  function safeContactForAdmin(c) {
    return {
      id: c.id, name: c.name, channel: c.channel,
      identifier: sec.maskIdentifier(c.identifier),
      revoked: !!c.revoked, expiresAt: c.expiresAt, lastLoginAt: c.lastLoginAt || null
    };
  }

  function issueCredentials(contact) {
    const password = sec.genPassword(12); // spec: min 10 chars
    const token = sec.genToken(16);       // spec: single 128-bit token, URL path only
    contacts.update(contact.id, {
      passwordHash: sec.hashSecret(password),
      linkTokenHash: sec.sha256hex(token) // store hash only; raw token never persisted
    });
    return { portalUrl: `${portalBaseUrl}/p/${token}`, password };
  }

  function notify(type, payload) {
    return notifications.add({ type, ...payload, ts: new Date().toISOString() });
  }

  function sendOtp(req, res, cors, contact, trip) {
    const otp = sec.genOtp6();
    const salt = crypto.randomUUID();
    const pendingOtp = {
      id: crypto.randomUUID(),
      salt,
      hash: sec.hashOtp(otp, salt),
      expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      attempts: 0
    };
    contacts.update(contact.id, { pendingOtp });
    notify("otp.send", {
      tripId: trip.id, contactId: contact.id,
      channel: contact.channel, to: sec.maskIdentifier(contact.identifier)
    });
    auditEvent(req, "portal", contact.id, "otp.sent", "contact", contact.id, { channel: contact.channel });
    const out = { ok: true, otpId: pendingOtp.id, channel: contact.channel, expiresAt: pendingOtp.expiresAt };
    if (otpDevReveal) out.devOtp = otp; // dev/demo only — real delivery via SMS/email provider (infra/)
    send(res, 200, out, cors);
  }

  function authSession(req) {
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const payload = sec.verifySession(token, sessionSecret);
    if (!payload || !payload.sid) return null;
    const session = portalSessions.find(payload.sid);
    if (!session || session.revoked) return null;
    if (Date.now() > Date.parse(session.expiresAt) || payload.exp * 1000 < Date.now()) return null;
    return { session, token };
  }

  // ---- router ----

  async function handle(req, res, pathname, body, cors) {
    const seg = pathname.split("/").filter(Boolean); // e.g. ["api","trips",":id","contacts"]

    // health
    if (pathname === "/api/health" && req.method === "GET") {
      return send(res, 200, { ok: true, service: "horsligne-backend", ts: new Date().toISOString() }, cors);
    }

    // waitlist
    if (pathname === "/api/waitlist" && req.method === "POST") {
      const r = validateWaitlist(body || {});
      if (!r.ok) return badRequest(res, cors, r.errors);
      if (waitlist.has(r.value.email)) {
        return send(res, 200, { ok: true, duplicate: true, message: "Email already on the list" }, cors);
      }
      const entry = waitlist.add(r.value);
      return send(res, 201, { ok: true, id: entry.id }, cors);
    }
    if (pathname === "/api/waitlist/count" && req.method === "GET") {
      if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
      return send(res, 200, { ok: true, count: waitlist.count() }, cors);
    }

    // trips (management; admin token stands in for traveler/staff auth until the client app lands)
    if (pathname === "/api/trips" && req.method === "POST") {
      if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
      const r = validateTrip(body);
      if (!r.ok) return badRequest(res, cors, r.errors);
      const trip = trips.add({ ...r.value, status: "planned" });
      auditEvent(req, "admin", "admin", "trip.created", "trip", trip.id, { destination: trip.destination });
      return send(res, 201, { ok: true, trip: safeTrip(trip) }, cors);
    }
    if (seg[1] === "trips" && seg[2] && seg.length === 3 && req.method === "GET") {
      if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
      const trip = trips.find(seg[2]);
      if (!trip) return notFound(res, cors);
      const tripContacts = contacts.findWhere((c) => c.tripId === trip.id).map(safeContactForAdmin);
      return send(res, 200, { ok: true, trip: safeTrip(trip), contacts: tripContacts }, cors);
    }

    // contacts: issue per-trip credentials
    if (seg[1] === "trips" && seg[2] && seg[3] === "contacts" && seg.length === 4 && req.method === "POST") {
      if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
      const trip = trips.find(seg[2]);
      if (!trip) return notFound(res, cors);
      const r = validateContact(body);
      if (!r.ok) return badRequest(res, cors, r.errors);
      const expiresAt = new Date(Date.parse(`${trip.endDate}T23:59:59Z`) + GRACE_MS).toISOString();
      const contact = contacts.add({ tripId: trip.id, ...r.value, revoked: false, expiresAt, pendingOtp: null, lastLoginAt: null });
      const creds = issueCredentials(contact);
      auditEvent(req, "admin", "admin", "credential.issued", "contact", contact.id, { tripId: trip.id, channel: contact.channel });
      return send(res, 201, {
        ok: true,
        contact: safeContactPublic(contact),
        portalUrl: creds.portalUrl,
        password: creds.password, // shown once — never stored raw
        expiresAt: contact.expiresAt
      }, cors);
    }

    // revoke a contact (traveler action; admin token stands in for now) — kills sessions immediately
    if (seg[1] === "trips" && seg[2] && seg[3] === "contacts" && seg[4] && seg[5] === "revoke" && req.method === "POST") {
      if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
      const contact = contacts.find(seg[4]);
      if (!contact || contact.tripId !== seg[2]) return notFound(res, cors);
      contacts.update(contact.id, { revoked: true, pendingOtp: null });
      for (const s of portalSessions.findWhere((s) => s.contactId === contact.id && !s.revoked)) {
        portalSessions.update(s.id, { revoked: true });
      }
      auditEvent(req, "admin", "admin", "credential.revoked", "contact", contact.id, { tripId: contact.tripId });
      return send(res, 200, { ok: true, revoked: true }, cors);
    }

    // audit log (admin read-only)
    if (pathname === "/api/audit" && req.method === "GET") {
      if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
      const tripId = new URL(req.url, "http://localhost").searchParams.get("tripId");
      let events = audit.list();
      if (tripId) {
        const cids = contacts.findWhere((c) => c.tripId === tripId).map((c) => c.id);
        const bids = bookings.findWhere((b) => b.tripId === tripId).map((b) => b.id);
        events = events.filter((e) =>
          e.objectId === tripId || cids.includes(e.objectId) || bids.includes(e.objectId) ||
          (e.detail && (e.detail.tripId === tripId || bids.includes(e.detail.bookingId))));
      }
      events.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      return send(res, 200, { ok: true, count: events.length, events }, cors);
    }

    // ---- portal auth (public; link + password + OTP) ----

    if (pathname === "/api/portal/start" && req.method === "POST") {
      const r = validatePortalStart(body);
      if (!r.ok) return badRequest(res, cors, r.errors);
      const { linkToken, password } = r.value;
      const ip = req.socket.remoteAddress || "";
      for (const key of [`start:token:${sec.sha256hex(linkToken).slice(0, 24)}`, `start:ip:${ip}`]) {
        const lim = loginLimiter.check(key);
        if (!lim.allowed) {
          return send(res, 429, { error: { code: "rate_limited", message: "Too many login attempts, try later", retryAfterMs: lim.retryAfterMs } }, cors);
        }
      }
      const contact = findContactByToken(linkToken);
      if (!contact) {
        auditEvent(req, "portal", "unknown", "login.fail", "contact", "unknown", { reason: "bad_link" });
        return send(res, 401, { error: { code: "invalid_link", message: "Invalid invite link" } }, cors);
      }
      const trip = tripOf(contact);
      const unusable = contactUsable(contact, trip);
      if (unusable) {
        auditEvent(req, "portal", contact.id, "login.fail", "contact", contact.id, { reason: unusable.code });
        return send(res, unusable.status, { error: { code: unusable.code, message: unusable.message } }, cors);
      }
      if (!sec.verifySecret(password, contact.passwordHash)) {
        auditEvent(req, "portal", contact.id, "login.fail", "contact", contact.id, { reason: "bad_password" });
        return send(res, 401, { error: { code: "invalid_password", message: "Wrong password" } }, cors);
      }
      return sendOtp(req, res, cors, contact, trip);
    }

    if (pathname === "/api/portal/resend-otp" && req.method === "POST") {
      const r = validateOtpPayload(body, { requireOtp: false });
      if (!r.ok) return badRequest(res, cors, r.errors);
      const contact = contacts.findWhere((c) => c.pendingOtp && c.pendingOtp.id === r.value.otpId)[0];
      if (!contact) return notFound(res, cors);
      const trip = tripOf(contact);
      const unusable = contactUsable(contact, trip);
      if (unusable) return send(res, unusable.status, { error: { code: unusable.code, message: unusable.message } }, cors);
      const lim = otpResendLimiter.check(`resend:${contact.id}`);
      if (!lim.allowed) {
        return send(res, 429, { error: { code: "rate_limited", message: "Too many OTP resends, try later", retryAfterMs: lim.retryAfterMs } }, cors);
      }
      return sendOtp(req, res, cors, contact, trip);
    }

    if (pathname === "/api/portal/verify" && req.method === "POST") {
      const r = validateOtpPayload(body, { requireOtp: true });
      if (!r.ok) return badRequest(res, cors, r.errors);
      const contact = contacts.findWhere((c) => c.pendingOtp && c.pendingOtp.id === r.value.otpId)[0];
      if (!contact) {
        return send(res, 404, { error: { code: "otp_session", message: "No pending OTP session" } }, cors);
      }
      const trip = tripOf(contact);
      const unusable = contactUsable(contact, trip);
      if (unusable) return send(res, unusable.status, { error: { code: unusable.code, message: unusable.message } }, cors);

      const pending = contact.pendingOtp;
      if (Date.now() > Date.parse(pending.expiresAt)) {
        contacts.update(contact.id, { pendingOtp: null });
        auditEvent(req, "portal", contact.id, "otp.locked", "contact", contact.id, { reason: "expired" });
        return send(res, 410, { error: { code: "otp_expired", message: "OTP expired, request a new one" } }, cors);
      }
      if (pending.attempts >= OTP_MAX_ATTEMPTS) {
        contacts.update(contact.id, { pendingOtp: null });
        auditEvent(req, "portal", contact.id, "otp.locked", "contact", contact.id, { reason: "too_many_attempts" });
        notify("traveler.notify", { tripId: trip.id, reason: "otp_locked", contactId: contact.id }); // spec §1: notify traveler via app
        return send(res, 423, { error: { code: "otp_locked", message: "Too many wrong attempts — locked, traveler notified" } }, cors);
      }
      if (sec.hashOtp(r.value.otp, pending.salt) !== pending.hash) {
        const attempts = pending.attempts + 1;
        contacts.update(contact.id, { pendingOtp: { ...pending, attempts } });
        if (attempts >= OTP_MAX_ATTEMPTS) {
          contacts.update(contact.id, { pendingOtp: null });
          auditEvent(req, "portal", contact.id, "otp.locked", "contact", contact.id, { reason: "too_many_attempts" });
          notify("traveler.notify", { tripId: trip.id, reason: "otp_locked", contactId: contact.id });
          return send(res, 423, { error: { code: "otp_locked", message: "Too many wrong attempts — locked, traveler notified" } }, cors);
        }
        auditEvent(req, "portal", contact.id, "login.fail", "contact", contact.id, { reason: "bad_otp", attempts });
        return send(res, 401, { error: { code: "invalid_otp", message: "Wrong code", attemptsRemaining: OTP_MAX_ATTEMPTS - attempts } }, cors);
      }

      // success: rotate link token (spec §1), create 24h sliding session
      const newToken = sec.genToken(16);
      contacts.update(contact.id, {
        pendingOtp: null,
        linkTokenHash: sec.sha256hex(newToken),
        lastLoginAt: new Date().toISOString()
      });
      const sid = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const sessionToken = sec.signSession({ sid, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_MS / 1000 }, sessionSecret);
      portalSessions.add({ id: sid, contactId: contact.id, tripId: trip.id, tokenHash: sec.sha256hex(sessionToken), expiresAt, revoked: false });
      auditEvent(req, "portal", contact.id, "login.success", "contact", contact.id, { tripId: trip.id });
      auditEvent(req, "portal", contact.id, "credential.rotated", "contact", contact.id, {});
      return send(res, 200, {
        ok: true,
        session: sessionToken,
        expiresAt,
        portalUrl: `${portalBaseUrl}/p/${newToken}`, // new link; old one is now invalid
        contact: safeContactPublic(contact),
        trip: safeTrip(trip)
      }, cors);
    }

    if (pathname === "/api/portal/me" && req.method === "GET") {
      const auth = authSession(req);
      if (!auth) return send(res, 401, { error: { code: "unauthorized", message: "Valid session required" } }, cors);
      const contact = contacts.find(auth.session.contactId);
      const trip = tripOf(contact);
      const unusable = contactUsable(contact, trip);
      if (unusable) return send(res, unusable.status, { error: { code: unusable.code, message: unusable.message } }, cors);
      // sliding session (spec §1: 24h sliding)
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      portalSessions.update(auth.session.id, { expiresAt });
      auditEvent(req, "portal", contact.id, "status.viewed", "trip", trip.id, {});
      return send(res, 200, {
        ok: true,
        contact: safeContactPublic(contact),
        trip: safeTrip(trip),
        sessionExpiresAt: expiresAt
      }, cors);
    }

    if (pathname === "/api/portal/logout" && req.method === "POST") {
      const auth = authSession(req);
      if (!auth) return send(res, 401, { error: { code: "unauthorized", message: "Valid session required" } }, cors);
      portalSessions.update(auth.session.id, { revoked: true });
      auditEvent(req, "portal", auth.session.contactId, "login.logout", "session", auth.session.id, {});
      return send(res, 200, { ok: true }, cors);
    }

    // ---- venues & offerings (admin manages; public reads via catalog) ----

    if (pathname === "/api/venues" && req.method === "POST") {
      if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
      const r = validateVenue(body);
      if (!r.ok) return badRequest(res, cors, r.errors);
      const venue = venues.add({ ...r.value, active: true });
      auditEvent(req, "admin", "admin", "venue.created", "venue", venue.id, { destination: venue.destination });
      return send(res, 201, { ok: true, venue: venuePublic(venue) }, cors);
    }

    if (seg[1] === "venues" && seg[2] && seg[3] === "sessions" && seg.length === 4 && req.method === "POST") {
      if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
      const venue = venues.find(seg[2]);
      if (!venue || !venue.active) return notFound(res, cors);
      const r = validateSession(body);
      if (!r.ok) return badRequest(res, cors, r.errors);
      const offering = offerings.add({ venueId: venue.id, ...r.value, status: "open" });
      auditEvent(req, "admin", "admin", "session.created", "offering", offering.id, { venueId: venue.id, risk: offering.risk });
      return send(res, 201, { ok: true, session: offeringPublic(offering) }, cors);
    }

    // public catalog ("Explore & book" source) — risk-labeled, venue+city only, never GPS
    if (pathname === "/api/catalog" && req.method === "GET") {
      const destination = new URL(req.url, "http://localhost").searchParams.get("destination");
      const vs = venues.findWhere((v) => v.active && (!destination || v.destination.toLowerCase().includes(destination.toLowerCase())));
      const catalog = [];
      for (const v of vs) {
        for (const o of offerings.findWhere((x) => x.venueId === v.id && (x.status === "open" || x.status === "full"))) {
          catalog.push(offeringPublic(o));
        }
      }
      catalog.sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
      return send(res, 200, { ok: true, count: catalog.length, catalog }, cors);
    }

    if (seg[1] === "sessions" && seg[2] && seg.length === 3 && req.method === "GET") {
      const offering = offerings.find(seg[2]);
      if (!offering) return notFound(res, cors);
      return send(res, 200, { ok: true, session: offeringPublic(offering) }, cors);
    }

    // book a session: traveler side (admin stand-in) or portal contact (gift/propose)
    if (seg[1] === "sessions" && seg[2] && seg[3] === "book" && req.method === "POST") {
      const offering = offerings.find(seg[2]);
      if (!offering || offering.status === "cancelled") return notFound(res, cors);
      const r = validateBook(body);
      if (!r.ok) return badRequest(res, cors, r.errors);
      const trip = trips.find(r.value.tripId);
      if (!trip) return send(res, 400, { error: { code: "validation", message: "Invalid payload", details: [{ field: "tripId", message: "trip not found" }] } }, cors);

      const auth = authSession(req);
      let bookedBy;
      if (auth) {
        const contact = contacts.find(auth.session.contactId);
        bookedBy = { type: "contact", id: auth.session.contactId };
        if (contact && contact.tripId !== trip.id) {
          return send(res, 403, { error: { code: "forbidden", message: "Can only book for your own trip" } }, cors);
        }
      } else {
        if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token or portal session required" } }, cors);
        bookedBy = { type: "traveler", id: trip.id };
      }
      return createBooking(req, res, cors, offering, trip.id, bookedBy, r.value.gift);
    }

    // portal: catalog with trip context (dual timezone source)
    if (pathname === "/api/portal/catalog" && req.method === "GET") {
      const auth = authSession(req);
      if (!auth) return send(res, 401, { error: { code: "unauthorized", message: "Valid session required" } }, cors);
      const contact = contacts.find(auth.session.contactId);
      const trip = tripOf(contact);
      const destination = new URL(req.url, "http://localhost").searchParams.get("destination") || trip.destination;
      const vs = venues.findWhere((v) => v.active && v.destination.toLowerCase().includes(destination.toLowerCase()));
      const catalog = [];
      for (const v of vs) {
        for (const o of offerings.findWhere((x) => x.venueId === v.id && (x.status === "open" || x.status === "full"))) {
          catalog.push(offeringPublic(o));
        }
      }
      catalog.sort((a, b) => (a.startAt < b.startAt ? -1 : 1));
      auditEvent(req, "portal", contact.id, "catalog.viewed", "trip", trip.id, {});
      return send(res, 200, { ok: true, trip: safeTrip(trip), homeTz: trip.homeTz, count: catalog.length, catalog }, cors);
    }

    // portal: book as gift or proposal (family's card; traveler accepts/declines)
    if (pathname === "/api/portal/book" && req.method === "POST") {
      const auth = authSession(req);
      if (!auth) return send(res, 401, { error: { code: "unauthorized", message: "Valid session required" } }, cors);
      const contact = contacts.find(auth.session.contactId);
      const trip = tripOf(contact);
      const offeringId = body && typeof body.offeringId === "string" ? body.offeringId.trim() : null;
      const offering = offeringId && offerings.find(offeringId);
      if (!offering || offering.status === "cancelled") return notFound(res, cors);
      const gift = body && body.gift !== undefined ? Boolean(body.gift) : true;
      auditEvent(req, "portal", contact.id, "booking.created", "booking", "pending", { offeringId: offering.id, gift });
      return createBooking(req, res, cors, offering, trip.id, { type: "contact", id: contact.id }, gift);
    }

    if (pathname === "/api/portal/bookings" && req.method === "GET") {
      const auth = authSession(req);
      if (!auth) return send(res, 401, { error: { code: "unauthorized", message: "Valid session required" } }, cors);
      const contact = contacts.find(auth.session.contactId);
      const list = bookings.findWhere((b) => b.tripId === contact.tripId).map(bookingPublic);
      return send(res, 200, { ok: true, count: list.length, bookings: list }, cors);
    }

    if (seg[1] === "trips" && seg[2] && seg[3] === "bookings" && seg.length === 4 && req.method === "GET") {
      if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
      const trip = trips.find(seg[2]);
      if (!trip) return notFound(res, cors);
      const list = bookings.findWhere((b) => b.tripId === trip.id).map(bookingPublic);
      return send(res, 200, { ok: true, trip: safeTrip(trip), count: list.length, bookings: list }, cors);
    }

    // RevenueCat webhook (dev stub — signature verification lands with infra/)
    if (pathname === "/api/webhooks/revenuecat" && req.method === "POST") {
      const r = validatePaymentWebhook(body);
      if (!r.ok) return badRequest(res, cors, r.errors);
      const booking = bookings.find(r.value.bookingId);
      if (!booking) return notFound(res, cors);
      if (r.value.event === "payment.succeeded") {
        if (booking.status === "pending_payment") {
          bookings.update(booking.id, { status: "paid", paymentRef: "rc-dev" });
          auditEvent(req, "system", "revenuecat", "payment.succeeded", "booking", booking.id, { offeringId: booking.offeringId });
          return send(res, 200, { ok: true, status: "paid" }, cors);
        }
        return send(res, 200, { ok: true, status: booking.status, note: "idempotent" }, cors);
      }
      // payment.failed → cancel + promote waitlist
      bookings.update(booking.id, { status: "cancelled", paymentRef: "rc-dev-failed" });
      auditEvent(req, "system", "revenuecat", "payment.failed", "booking", booking.id, {});
      const offering = offerings.find(booking.offeringId);
      const promoted = offering ? promoteWaitlist(offering.id) : null;
      if (promoted) {
        auditEvent(req, "system", "revenuecat", "waitlist.promoted", "booking", promoted.id, { offeringId: offering.id });
        notify("booking.promoted", { bookingId: promoted.id, tripId: promoted.tripId });
      }
      return send(res, 200, { ok: true, status: "cancelled" }, cors);
    }

    if (seg[1] === "bookings" && seg[2] && seg[3] === "cancel" && req.method === "POST") {
      const booking = bookings.find(seg[2]);
      if (!booking) return notFound(res, cors);
      const auth = authSession(req);
      if (!auth && !isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token or owning session required" } }, cors);
      if (auth && booking.tripId !== contacts.find(auth.session.contactId)?.tripId) {
        return send(res, 403, { error: { code: "forbidden", message: "Not your booking" } }, cors);
      }
      if (!["pending_payment", "paid", "waitlisted"].includes(booking.status)) {
        return send(res, 409, { error: { code: "bad_state", message: `Cannot cancel booking in status ${booking.status}` } }, cors);
      }
      const wasOccupying = booking.status === "pending_payment" || booking.status === "paid";
      bookings.update(booking.id, { status: "cancelled", decision: booking.decision === "pending" ? "declined" : booking.decision });
      auditEvent(req, auth ? "portal" : "admin", auth ? auth.session.contactId : "admin", "booking.cancelled", "booking", booking.id, { offeringId: booking.offeringId });
      if (wasOccupying) {
        const offering = offerings.find(booking.offeringId);
        if (offering) {
          if (spotsLeft(offering) > 0) offerings.update(offering.id, { status: "open" });
          const promoted = promoteWaitlist(offering.id);
          if (promoted) {
            auditEvent(req, "system", "backend", "waitlist.promoted", "booking", promoted.id, { offeringId: offering.id });
            notify("booking.promoted", { bookingId: promoted.id, tripId: promoted.tripId });
          }
        }
      }
      return send(res, 200, { ok: true, status: "cancelled" }, cors);
    }

    // traveler accepts/declines a gift booking (admin token stands in for traveler)
    if (seg[1] === "bookings" && seg[2] && seg[3] === "decide" && req.method === "POST") {
      if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
      const booking = bookings.find(seg[2]);
      if (!booking) return notFound(res, cors);
      if (!booking.gift || booking.decision !== "pending") {
        return send(res, 400, { error: { code: "not_a_gift", message: "Only pending gift bookings can be decided" } }, cors);
      }
      const r = validateDecide(body);
      if (!r.ok) return badRequest(res, cors, r.errors);
      if (r.value.accept) {
        bookings.update(booking.id, { decision: "accepted" });
        auditEvent(req, "traveler", booking.tripId, "booking.accepted", "booking", booking.id, {});
        return send(res, 200, { ok: true, decision: "accepted" }, cors);
      }
      bookings.update(booking.id, { decision: "declined", status: "cancelled" });
      auditEvent(req, "traveler", booking.tripId, "booking.declined", "booking", booking.id, {});
      const offering = offerings.find(booking.offeringId);
      const promoted = offering && (booking.status === "pending_payment" || booking.status === "paid") ? promoteWaitlist(offering.id) : null;
      if (promoted) auditEvent(req, "system", "backend", "waitlist.promoted", "booking", promoted.id, { offeringId: offering.id });
      return send(res, 200, { ok: true, decision: "declined" }, cors);
    }

    // staff marks no-show (no-show fee applies; charged via RevenueCat later)
    if (seg[1] === "bookings" && seg[2] && seg[3] === "no-show" && req.method === "POST") {
      if (!isAdmin(req)) return send(res, 401, { error: { code: "unauthorized", message: "Admin token required" } }, cors);
      const booking = bookings.find(seg[2]);
      if (!booking) return notFound(res, cors);
      if (booking.status !== "paid") {
        return send(res, 409, { error: { code: "bad_state", message: "Only paid bookings can be marked no-show" } }, cors);
      }
      bookings.update(booking.id, { status: "no_show", noShowFee: true });
      auditEvent(req, "admin", "admin", "booking.no_show", "booking", booking.id, { offeringId: booking.offeringId });
      return send(res, 200, { ok: true, status: "no_show", noShowFee: true }, cors);
    }

    return notFound(res, cors);
  }

  // ---- booking engine helpers ----

  function activeBookings(offeringId) {
    return bookings.findWhere((b) => b.offeringId === offeringId && (b.status === "pending_payment" || b.status === "paid"));
  }

  function spotsLeft(offering) {
    return Math.max(0, offering.capacity - activeBookings(offering.id).length);
  }

  function venuePublic(v) {
    return { id: v.id, name: v.name, city: v.city, destination: v.destination, tz: v.tz, emergencyChannel: v.emergencyChannel };
  }

  function offeringPublic(o, withVenue = true) {
    const venue = venues.find(o.venueId);
    return {
      id: o.id, title: o.title, kind: o.kind,
      startAt: o.startAt, endAt: o.endAt,
      capacity: o.capacity, spotsLeft: spotsLeft(o),
      priceCentsBRL: o.priceCentsBRL,
      priceBRL: (o.priceCentsBRL / 100).toFixed(2),
      risk: o.risk, status: o.status,
      venue: withVenue && venue ? venuePublic(venue) : o.venueId
    };
  }

  function bookingPublic(b) {
    return {
      id: b.id, offeringId: b.offeringId, tripId: b.tripId,
      gift: !!b.gift, bookedBy: b.bookedBy, status: b.status,
      decision: b.decision || null,
      priceCentsBRL: b.priceCentsBRL, paymentRef: b.paymentRef || null,
      createdAt: b.createdAt
    };
  }

  function promoteWaitlist(offeringId) {
    const waiting = bookings
      .findWhere((b) => b.offeringId === offeringId && b.status === "waitlisted")
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
    if (!waiting) return null;
    const promoted = bookings.update(waiting.id, { status: "pending_payment" });
    const o = offerings.find(offeringId);
    if (o && spotsLeft(o) <= 0) offerings.update(o.id, { status: "full" });
    return promoted;
  }

  function createBooking(req, res, cors, offering, tripId, bookedBy, gift) {
    const active = activeBookings(offering.id).length;
    const full = active >= offering.capacity;
    if (full && offering.status !== "cancelled") offerings.update(offering.id, { status: "full" });
    const status = full ? "waitlisted" : "pending_payment";
    const booking = bookings.add({
      offeringId: offering.id, tripId, bookedBy, gift: !!gift,
      status, decision: gift ? "pending" : null,
      priceCentsBRL: offering.priceCentsBRL, paymentRef: null
    });
    auditEvent(req, bookedBy.type === "contact" ? "portal" : "admin", bookedBy.id,
      full ? "waitlist.joined" : "booking.created", "booking", booking.id, { offeringId: offering.id, tripId });
    return send(res, 201, {
      ok: true,
      booking: bookingPublic(booking),
      paymentRequired: status === "pending_payment",
      waitlisted: status === "waitlisted",
      priceCentsBRL: offering.priceCentsBRL,
      priceBRL: (offering.priceCentsBRL / 100).toFixed(2),
      currency: "BRL"
    }, cors);
  }

  return { handle, collections: { waitlist, trips, contacts, portalSessions, audit, notifications, venues, offerings, bookings } };
}
