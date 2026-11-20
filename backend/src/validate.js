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
