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
  validateOtpPayload
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
  const sessions = createCollection(dataDir, "sessions.jsonl");
  const audit = createCollection(dataDir, "audit.jsonl");
  const notifications = createCollection(dataDir, "notifications.jsonl"); // outbound queue (SMS/email/SSE plug in under infra/)

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
    const session = sessions.find(payload.sid);
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
      for (const s of sessions.findWhere((s) => s.contactId === contact.id && !s.revoked)) {
        sessions.update(s.id, { revoked: true });
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
        events = events.filter((e) => e.objectId === tripId || cids.includes(e.objectId) || (e.detail && e.detail.tripId === tripId));
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
      sessions.add({ id: sid, contactId: contact.id, tripId: trip.id, tokenHash: sec.sha256hex(sessionToken), expiresAt, revoked: false });
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
      sessions.update(auth.session.id, { expiresAt });
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
      sessions.update(auth.session.id, { revoked: true });
      auditEvent(req, "portal", auth.session.contactId, "login.logout", "session", auth.session.id, {});
      return send(res, 200, { ok: true }, cors);
    }

    return notFound(res, cors);
  }

  return { handle, collections: { waitlist, trips, contacts, sessions, audit, notifications } };
}
