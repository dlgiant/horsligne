// Payload validation + sanitizing. Zero deps.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9][0-9 ()-]{7,19}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f]", "g");

function cleanString(value, max) {
  if (typeof value !== "string") return null;
  const v = value.replace(CONTROL_CHARS, "").trim();
  if (v.length > max) return null;
  return v;
}

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Validate a waitlist entry coming from the landing page.
 * Returns { ok: true, value } or { ok: false, errors: [{field, message}] }.
 */
export function validateWaitlist(body) {
  const errors = [];
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "body", message: "JSON object expected" }] };
  }

  const name = cleanString(body.name, 120);
  if (!name) errors.push({ field: "name", message: "name is required (max 120 chars)" });

  const email = cleanString(body.email, 254);
  if (!email || !EMAIL_RE.test(email)) {
    errors.push({ field: "email", message: "valid email is required" });
  }

  let destination = null;
  if (body.destination !== undefined && body.destination !== null && body.destination !== "") {
    destination = cleanString(body.destination, 120);
    if (destination === null) errors.push({ field: "destination", message: "max 120 chars" });
  }

  let lang = "en";
  if (body.lang !== undefined && body.lang !== null && body.lang !== "") {
    const l = cleanString(body.lang, 5);
    if (l !== "en" && l !== "pt") errors.push({ field: "lang", message: "lang must be 'en' or 'pt'" });
    else lang = l;
  }

  let source = "landing";
  if (body.source !== undefined && body.source !== null && body.source !== "") {
    const s = cleanString(body.source, 40);
    if (s) source = s;
  }

  let ts = new Date().toISOString();
  if (body.ts !== undefined && body.ts !== null && body.ts !== "") {
    const t = cleanString(body.ts, 40);
    if (t && !Number.isNaN(Date.parse(t))) ts = new Date(t).toISOString();
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, email: email.toLowerCase(), destination, lang, source, ts } };
}

/** POST /api/trips */
export function validateTrip(body) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "body", message: "JSON object expected" }] };
  }
  const travelerFirstName = cleanString(body.travelerFirstName, 60);
  if (!travelerFirstName) errors.push({ field: "travelerFirstName", message: "required (max 60 chars)" });

  const destination = cleanString(body.destination, 120);
  if (!destination) errors.push({ field: "destination", message: "required (max 120 chars)" });

  let city = null;
  if (body.city) {
    city = cleanString(body.city, 120);
    if (city === null) errors.push({ field: "city", message: "max 120 chars" });
  }

  const startDate = cleanString(body.startDate, 10);
  const endDate = cleanString(body.endDate, 10);
  if (!startDate || !isValidDate(startDate)) errors.push({ field: "startDate", message: "required, ISO date YYYY-MM-DD" });
  if (!endDate || !isValidDate(endDate)) errors.push({ field: "endDate", message: "required, ISO date YYYY-MM-DD" });
  else if (startDate && isValidDate(startDate) && endDate <= startDate) {
    errors.push({ field: "endDate", message: "must be after startDate" });
  }

  let homeTz = "UTC";
  if (body.homeTz) {
    const tz = cleanString(body.homeTz, 64);
    if (tz === null) errors.push({ field: "homeTz", message: "max 64 chars" });
    else homeTz = tz;
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { travelerFirstName, destination, city, startDate, endDate, homeTz } };
}

/** POST /api/trips/:id/contacts */
export function validateContact(body) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "body", message: "JSON object expected" }] };
  }
  const name = cleanString(body.name, 120);
  if (!name) errors.push({ field: "name", message: "required (max 120 chars)" });

  const channel = cleanString(body.channel, 5);
  if (channel !== "sms" && channel !== "email") {
    errors.push({ field: "channel", message: "must be 'sms' or 'email'" });
  }

  const identifier = cleanString(body.identifier, 254);
  if (!identifier) errors.push({ field: "identifier", message: "required (phone for sms, email for email)" });
  else if (channel === "email" && !EMAIL_RE.test(identifier)) {
    errors.push({ field: "identifier", message: "must be a valid email when channel=email" });
  } else if (channel === "sms" && !PHONE_RE.test(identifier)) {
    errors.push({ field: "identifier", message: "must be a valid phone number when channel=sms" });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, channel, identifier: channel === "email" ? identifier.toLowerCase() : identifier } };
}

/** POST /api/portal/start */
export function validatePortalStart(body) {
  const errors = [];
  if (!body || typeof body !== "object") return { ok: false, errors: [{ field: "body", message: "JSON object expected" }] };
  const linkToken = cleanString(body.linkToken, 200);
  if (!linkToken) errors.push({ field: "linkToken", message: "required" });
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 10 || password.length > 200) errors.push({ field: "password", message: "required (10-200 chars)" });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { linkToken, password } };
}

const RISK_LEVELS = ["low", "moderate", "semi-risky"];
const CHANNEL_TYPES = ["satellite", "landline"];
const ISO_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

function isValidDateTime(s) {
  return typeof s === "string" && ISO_DT_RE.test(s) && !Number.isNaN(Date.parse(s));
}

/** POST /api/venues — "no emergency channel = no session" (master plan §5). */
export function validateVenue(body) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "body", message: "JSON object expected" }] };
  }
  const name = cleanString(body.name, 120);
  if (!name) errors.push({ field: "name", message: "required (max 120 chars)" });
  const city = cleanString(body.city, 120);
  if (!city) errors.push({ field: "city", message: "required (max 120 chars)" });
  const destination = cleanString(body.destination, 120);
  if (!destination) errors.push({ field: "destination", message: "required (max 120 chars)" });

  let tz = "America/Bahia";
  if (body.tz) {
    const t = cleanString(body.tz, 64);
    if (t === null) errors.push({ field: "tz", message: "max 64 chars" });
    else tz = t;
  }

  const ec = body.emergencyChannel;
  let emergencyChannel = null;
  if (!ec || typeof ec !== "object") {
    errors.push({ field: "emergencyChannel", message: "required (no channel = no sessions at this venue)" });
  } else {
    const type = cleanString(ec.type, 10);
    const contact = cleanString(ec.contact, 40);
    if (!CHANNEL_TYPES.includes(type)) errors.push({ field: "emergencyChannel.type", message: "must be 'satellite' or 'landline'" });
    if (!contact || contact.length < 5) errors.push({ field: "emergencyChannel.contact", message: "required (phone/address, 5-40 chars)" });
    if (CHANNEL_TYPES.includes(type) && contact && contact.length >= 5) emergencyChannel = { type, contact };
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, city, destination, tz, emergencyChannel } };
}

/** POST /api/venues/:id/sessions */
export function validateSession(body) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "body", message: "JSON object expected" }] };
  }
  const title = cleanString(body.title, 120);
  if (!title) errors.push({ field: "title", message: "required (max 120 chars)" });
  const kind = cleanString(body.kind, 60);
  if (!kind) errors.push({ field: "kind", message: "required, e.g. hike|surf|meditation|paddle|workshop" });

  const startAt = cleanString(body.startAt, 40);
  const endAt = cleanString(body.endAt, 40);
  if (!startAt || !isValidDateTime(startAt)) errors.push({ field: "startAt", message: "required, ISO datetime" });
  if (!endAt || !isValidDateTime(endAt)) errors.push({ field: "endAt", message: "required, ISO datetime (expected check-out)" });
  else if (isValidDateTime(startAt) && Date.parse(endAt) <= Date.parse(startAt)) {
    errors.push({ field: "endAt", message: "must be after startAt" });
  }

  const capacity = Number(body.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    errors.push({ field: "capacity", message: "integer 1-100" });
  }
  const priceCentsBRL = Number(body.priceCentsBRL);
  if (!Number.isInteger(priceCentsBRL) || priceCentsBRL < 0 || priceCentsBRL > 10_000_000) {
    errors.push({ field: "priceCentsBRL", message: "integer cents 0-10,000,000 (R$ 90 = 9000)" });
  }
  const risk = cleanString(body.risk, 12);
  if (!RISK_LEVELS.includes(risk)) errors.push({ field: "risk", message: "must be low|moderate|semi-risky" });

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { title, kind, startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(), capacity, priceCentsBRL, risk } };
}

/** POST /api/sessions/:id/book */
export function validateBook(body) {
  const errors = [];
  if (!body || typeof body !== "object") return { ok: false, errors: [{ field: "body", message: "JSON object expected" }] };
  const tripId = cleanString(body.tripId, 64);
  if (!tripId) errors.push({ field: "tripId", message: "required" });
  const gift = body.gift !== undefined ? Boolean(body.gift) : false;
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { tripId, gift } };
}

/** POST /api/bookings/:id/decide (traveler accept/decline for gifts) */
export function validateDecide(body) {
  if (!body || typeof body !== "object" || typeof body.accept !== "boolean") {
    return { ok: false, errors: [{ field: "accept", message: "boolean required" }] };
  }
  return { ok: true, value: { accept: body.accept } };
}

/** POST /api/webhooks/revenuecat (dev stub; signature check lands with infra/) */
export function validatePaymentWebhook(body) {
  const errors = [];
  if (!body || typeof body !== "object") return { ok: false, errors: [{ field: "body", message: "JSON object expected" }] };
  const bookingId = cleanString(body.bookingId, 64);
  if (!bookingId) errors.push({ field: "bookingId", message: "required" });
  const event = cleanString(body.event, 40);
  if (!["payment.succeeded", "payment.failed"].includes(event)) {
    errors.push({ field: "event", message: "must be payment.succeeded|payment.failed" });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { bookingId, event } };
}

/** POST /api/portal/verify and /api/portal/resend-otp */
export function validateOtpPayload(body, { requireOtp } = { requireOtp: true }) {
  const errors = [];
  if (!body || typeof body !== "object") return { ok: false, errors: [{ field: "body", message: "JSON object expected" }] };
  const otpId = cleanString(body.otpId, 64);
  if (!otpId) errors.push({ field: "otpId", message: "required" });
  let otp = null;
  if (requireOtp) {
    otp = typeof body.otp === "string" ? body.otp.trim() : "";
    if (!/^\d{6}$/.test(otp)) errors.push({ field: "otp", message: "must be 6 digits" });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { otpId, otp } };
}
