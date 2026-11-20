// admin/app.js — internal admin console (hash SPA, no build step).
// Auth: admin token (Bearer) validated against GET /api/admin/overview.
// Views: dashboard, venues, sessions, trips(+detail), runs(+detail),
// bookings, audit, waitlist.

import { apiFetch, createTokenStore, fmtTs, fmtMoney, bookingStatusLabel, runStatusLabel } from "./lib.js";

const API = window.HL_API_BASE || "http://localhost:3000";
const store = createTokenStore(window.sessionStorage);

const I18N = {
  en: {
    logout: "Log out",
    navDash: "Dashboard", navVenues: "Venues", navSessions: "Sessions", navTrips: "Trips",
    navRuns: "Runs", navBookings: "Bookings", navAudit: "Audit", navWaitlist: "Waitlist",
    loginTitle: "Admin console", loginHint: "Internal tool. Enter the admin token.",
    tokenLabel: "Admin token", signIn: "Sign in", badToken: "Invalid token (401).",
    loading: "Loading…", err: "Something went wrong.",
    waitlist: "Waitlist", trips: "Trips", venues: "Venues", offerings: "Sessions",
    bookings: "Bookings", activeRuns: "Active runs", incidents: "Incidents", revenue: "Revenue (paid)",
    recentBookings: "Recent bookings", recentRuns: "Recent runs",
    venueList: "Venues", createVenue: "Create venue",
    fName: "Name", fCity: "City", fDestination: "Destination", fTz: "Timezone", fChannelType: "Emergency channel", fChannelContact: "Channel contact",
    satellite: "Satellite (SOS)", landline: "Landline",
    create: "Create", created: "Created ✓",
    fTitle: "Title", fKind: "Kind", fStart: "Start", fEnd: "End", fCapacity: "Capacity", fPrice: "Price (BRL cents)", fRisk: "Risk",
    riskLow: "low", riskModerate: "moderate", riskSemi: "semi-risky",
    createSession: "Create session", venue: "Venue", spots: "Spots left", status: "Status", when: "When", price: "Price", risk: "Risk",
    tripList: "Trips", traveler: "Traveler", contacts: "Contacts", runs: "Runs",
    issueContact: "Issue portal contact", fContactName: "Contact name", fChannel: "OTP channel", fIdentifier: "Phone (sms) / email",
    sms: "SMS", email: "Email", issue: "Issue", portalLink: "Invite link", portalPw: "Password (show once)", revoke: "Revoke",
    runList: "Session runs", runDetail: "Run", custody: "Phone custody", claimCode: "Claim code",
    expectedCheckOut: "Expected check-out", extend30: "Extend +30 min", checkOut: "Check out", logIncident: "Log incident",
    checkpointLog: "Checkpoint log", noEntries: "No entries.", verify: "Verify", markUnverified: "Mark unverified",
    viaCallback: "callback", viaSecond: "second channel", lifeThreatening: "life-threatening",
    classification: "Class", verification: "Verification", decision: "Decision", sender: "Sender", ts: "Time",
    routine: "routine", urgent: "urgent",
    bookingList: "Bookings", filterStatus: "Filter by status", all: "All", cancel: "Cancel", noShow: "Mark no-show", decide: "Decide gift",
    accept: "Accept", decline: "Decline", gift: "Gift", by: "By",
    auditTitle: "Audit log", filterTrip: "Trip ID (optional)", load: "Load", actor: "Actor", action: "Action", object: "Object", ip: "IP",
    waitlistTitle: "Waitlist", count: "Count", name: "Name", email: "Email", destination: "Destination", lang: "Lang", source: "Source", joined: "Joined",
    noData: "No data."
  },
  pt: {
    logout: "Sair",
    navDash: "Painel", navVenues: "Locais", navSessions: "Sessões", navTrips: "Viagens",
    navRuns: "Execuções", navBookings: "Reservas", navAudit: "Auditoria", navWaitlist: "Espera",
    loginTitle: "Console admin", loginHint: "Ferramenta interna. Digite o token admin.",
    tokenLabel: "Token admin", signIn: "Entrar", badToken: "Token inválido (401).",
    loading: "Carregando…", err: "Algo deu errado.",
    waitlist: "Lista de espera", trips: "Viagens", venues: "Locais", offerings: "Sessões",
    bookings: "Reservas", activeRuns: "Execuções ativas", incidents: "Incidentes", revenue: "Receita (paga)",
    recentBookings: "Reservas recentes", recentRuns: "Execuções recentes",
    venueList: "Locais", createVenue: "Criar local",
    fName: "Nome", fCity: "Cidade", fDestination: "Destino", fTz: "Fuso horário", fChannelType: "Canal de emergência", fChannelContact: "Contato do canal",
    satellite: "Satélite (SOS)", landline: "Telefone fixo",
    create: "Criar", created: "Criado ✓",
    fTitle: "Título", fKind: "Tipo", fStart: "Início", fEnd: "Fim", fCapacity: "Capacidade", fPrice: "Preço (centavos BRL)", fRisk: "Risco",
    riskLow: "baixo", riskModerate: "moderado", riskSemi: "semi-arriscado",
    createSession: "Criar sessão", venue: "Local", spots: "Vagas", status: "Status", when: "Quando", price: "Preço", risk: "Risco",
    tripList: "Viagens", traveler: "Viajante", contacts: "Contatos", runs: "Execuções",
    issueContact: "Emitir contato do portal", fContactName: "Nome do contato", fChannel: "Canal do OTP", fIdentifier: "Celular (sms) / email",
    sms: "SMS", email: "Email", issue: "Emitir", portalLink: "Link de convite", portalPw: "Senha (mostrar 1x)", revoke: "Revogar",
    runList: "Execuções de sessão", runDetail: "Execução", custody: "Custódia do celular", claimCode: "Código",
    expectedCheckOut: "Check-out previsto", extend30: "Estender +30 min", checkOut: "Fazer check-out", logIncident: "Registrar incidente",
    checkpointLog: "Log do checkpoint", noEntries: "Sem entradas.", verify: "Verificar", markUnverified: "Marcar não verificada",
    viaCallback: "ligação", viaSecond: "segundo canal", lifeThreatening: "risco de vida",
    classification: "Classe", verification: "Verificação", decision: "Decisão", sender: "Remetente", ts: "Hora",
    routine: "rotina", urgent: "urgente",
    bookingList: "Reservas", filterStatus: "Filtrar por status", all: "Todas", cancel: "Cancelar", noShow: "Marcar no-show", decide: "Decidir presente",
    accept: "Aceitar", decline: "Recusar", gift: "Presente", by: "Por",
    auditTitle: "Log de auditoria", filterTrip: "ID da viagem (opcional)", load: "Carregar", actor: "Ator", action: "Ação", object: "Objeto", ip: "IP",
    waitlistTitle: "Lista de espera", count: "Total", name: "Nome", email: "Email", destination: "Destino", lang: "Idioma", source: "Origem", joined: "Entrada",
    noData: "Sem dados."
  }
};

let lang = localStorage.getItem("hl-lang") || "en";
if (!I18N[lang]) lang = "en";
const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
  localStorage.setItem("hl-lang", lang);
}
document.querySelectorAll(".lang-btn").forEach((b) => b.addEventListener("click", () => { lang = b.dataset.lang; applyLang(); render(); }));

const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const A = () => store.load();

async function api(p, opts = {}) {
  const r = await apiFetch(API, p, { token: A(), ...opts });
  if (r.status === 401) { store.clear(); location.hash = "#/login"; render(); throw new Error("unauthorized"); }
  return r;
}

// ---------- login ----------

function renderLogin() {
  document.getElementById("main-nav").hidden = true;
  document.getElementById("logout-btn").hidden = true;
  app.innerHTML = `
    <form class="login card" id="login-form">
      <h1>${t("loginTitle")}</h1>
      <p class="muted">${t("loginHint")}</p>
      <div class="field"><label for="tok">${t("tokenLabel")}</label>
        <input id="tok" type="password" autocomplete="off" required /></div>
      <p class="error" id="login-err" hidden></p>
      <div><button class="btn" type="submit">${t("signIn")}</button></div>
    </form>`;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tok = document.getElementById("tok").value.trim();
    const r = await apiFetch(API, "/api/admin/overview", { token: tok });
    if (!r.ok) {
      const err = document.getElementById("login-err");
      err.textContent = t("badToken");
      err.hidden = false;
      return;
    }
    store.save(tok);
    location.hash = "#/";
    render();
  });
}

// ---------- dashboard ----------

async function viewDashboard() {
  app.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const [ov, bookings, runs] = await Promise.all([
    api("/api/admin/overview"), api("/api/admin/bookings"), api("/api/admin/runs")
  ]);
  const o = ov.data;
  const stats = `
    <div class="grid">
      ${stat(o.waitlistCount, t("waitlist"), "#/waitlist")}
      ${stat(o.counts.trips, t("trips"), "#/trips")}
      ${stat(o.counts.venues, t("venues"), "#/venues")}
      ${stat(o.counts.offerings, t("offerings"), "#/sessions")}
      ${stat(o.counts.activeRuns, t("activeRuns"), "#/runs")}
      ${stat(o.counts.incidents, t("incidents"), "#/runs")}
      ${stat(fmtMoney(o.revenueCentsBRL), t("revenue"), "#/bookings")}
    </div>`;
  const bRows = bookings.data.bookings.slice(0, 8).map((b) => `
    <tr><td class="mono">${esc(b.id.slice(0, 8))}</td>
      <td><span class="badge ${b.status}">${bookingStatusLabel(b.status, lang)}</span></td>
      <td class="mono">${esc(b.offeringId.slice(0, 8))}</td>
      <td>${fmtMoney(b.priceCentsBRL)}</td>
      <td>${b.gift ? t("gift") : ""}</td>
      <td class="muted">${fmtTs(b.createdAt, lang)}</td></tr>`).join("");
  const rRows = runs.data.runs.slice(0, 8).map((r) => `
    <tr><td><a href="#/runs/${r.id}">${esc(r.id.slice(0, 8))}</a></td>
      <td><span class="badge ${r.overdue ? "overdue" : r.status}">${runStatusLabel(r, lang)}</span></td>
      <td class="mono">${esc(r.tripId.slice(0, 8))}</td>
      <td class="muted">${esc(r.phoneCustody?.type || "")} ${esc(r.phoneCustody?.claimCode || "")}</td>
      <td class="muted">${fmtTs(r.checkedInAt, lang)}</td></tr>`).join("");
  app.innerHTML = `
    <h1>${t("navDash")}</h1>
    ${stats}
    <div class="card"><h2>${t("recentBookings")}</h2>
      <table><thead><tr><th>ID</th><th>${t("status")}</th><th>${t("offerings")}</th><th>${t("price")}</th><th></th><th></th></tr></thead>
      <tbody>${bRows || `<tr><td colspan="6" class="muted">${t("noData")}</td></tr>`}</tbody></table></div>
    <div class="card"><h2>${t("recentRuns")}</h2>
      <table><thead><tr><th>ID</th><th>${t("status")}</th><th>${t("navTrips")}</th><th>${t("custody")}</th><th></th></tr></thead>
      <tbody>${rRows || `<tr><td colspan="5" class="muted">${t("noData")}</td></tr>`}</tbody></table></div>`;
}

const stat = (num, lbl, href) => `
  <a href="${href}" style="text-decoration:none;color:inherit">
    <div class="stat"><div class="num">${esc(num)}</div><div class="lbl">${esc(lbl)}</div></div>
  </a>`;

// ---------- venues ----------

async function viewVenues() {
  app.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const [list, catalog] = await Promise.all([api("/api/admin/venues"), api("/api/catalog")]);
  const rows = list.data.venues.map((v) => `
    <tr><td><strong>${esc(v.name)}</strong></td><td>${esc(v.city)}</td><td>${esc(v.destination)}</td>
      <td class="mono">${esc(v.tz)}</td>
      <td class="mono">${esc(v.emergencyChannel?.type)}: ${esc(v.emergencyChannel?.contact)}</td>
      <td>${v.offerings} ${t("offerings").toLowerCase()}</td></tr>`).join("");
  app.innerHTML = `
    <h1>${t("venueList")}</h1>
    <div class="card"><table><thead><tr><th>${t("fName")}</th><th>${t("fCity")}</th><th>${t("fDestination")}</th><th>${t("fTz")}</th><th>${t("fChannelType")}</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="muted">${t("noData")}</td></tr>`}</tbody></table></div>
    <div class="card"><h2>${t("createVenue")}</h2>
      <form class="inline" id="venue-form">
        <div class="field"><label>${t("fName")}</label><input name="name" required /></div>
        <div class="field"><label>${t("fCity")}</label><input name="city" required /></div>
        <div class="field"><label>${t("fDestination")}</label><input name="destination" required /></div>
        <div class="field"><label>${t("fTz")}</label><input name="tz" value="America/Bahia" /></div>
        <div class="field"><label>${t("fChannelType")}</label><select name="chType"><option value="landline">${t("landline")}</option><option value="satellite">${t("satellite")}</option></select></div>
        <div class="field"><label>${t("fChannelContact")}</label><input name="chContact" placeholder="+55 75 3xxx-xxxx" required /></div>
        <div><button class="btn" type="submit">${t("create")}</button></div>
      </form>
      <p class="error" id="v-err" hidden></p><p class="muted" id="v-ok" hidden></p>
    </div>`;
  document.getElementById("venue-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const r = await api("/api/venues", { method: "POST", body: {
      name: f.name.value, city: f.city.value, destination: f.destination.value,
      tz: f.tz.value, emergencyChannel: { type: f.chType.value, contact: f.chContact.value }
    } });
    if (!r.ok) {
      const err = document.getElementById("v-err");
      err.textContent = JSON.stringify(r.data?.error?.details || r.data?.error || r.data);
      err.hidden = false;
      return;
    }
    document.getElementById("v-ok").textContent = t("created");
    document.getElementById("v-ok").hidden = false;
    setTimeout(render, 700);
  });
}

// ---------- sessions ----------

async function viewSessions() {
  app.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const [venues, catalog] = await Promise.all([api("/api/admin/venues"), api("/api/catalog")]);
  const vOptions = venues.data.venues.map((v) => `<option value="${v.id}">${esc(v.name)} — ${esc(v.city)}</option>`).join("");
  const rows = catalog.data.catalog.map((c) => `
    <tr><td><strong>${esc(c.title)}</strong><div class="muted">${esc(c.kind)}</div></td>
      <td>${esc(c.venue?.name)}</td>
      <td class="muted">${fmtTs(c.startAt, lang)} → ${fmtTs(c.endAt, lang)}</td>
      <td>${c.spotsLeft}/${c.capacity}</td>
      <td>${fmtMoney(c.priceCentsBRL)}</td>
      <td><span class="badge">${esc(c.risk)}</span></td>
      <td><span class="badge ${c.status}">${esc(c.status)}</span></td></tr>`).join("");
  app.innerHTML = `
    <h1>${t("navSessions")}</h1>
    <div class="card"><table><thead><tr><th>${t("fTitle")}</th><th>${t("venue")}</th><th>${t("when")}</th><th>${t("spots")}</th><th>${t("price")}</th><th>${t("risk")}</th><th>${t("status")}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7" class="muted">${t("noData")}</td></tr>`}</tbody></table></div>
    <div class="card"><h2>${t("createSession")}</h2>
      <form class="inline" id="sess-form">
        <div class="field"><label>${t("venue")}</label><select name="venueId">${vOptions}</select></div>
        <div class="field"><label>${t("fTitle")}</label><input name="title" required /></div>
        <div class="field"><label>${t("fKind")}</label><input name="kind" placeholder="hike" required /></div>
        <div class="field"><label>${t("fStart")}</label><input name="startAt" type="datetime-local" required /></div>
        <div class="field"><label>${t("fEnd")}</label><input name="endAt" type="datetime-local" required /></div>
        <div class="field"><label>${t("fCapacity")}</label><input name="capacity" type="number" min="1" max="100" value="8" required /></div>
        <div class="field"><label>${t("fPrice")}</label><input name="priceCentsBRL" type="number" min="0" value="9000" required /></div>
        <div class="field"><label>${t("fRisk")}</label><select name="risk"><option value="low">${t("riskLow")}</option><option value="moderate" selected>${t("riskModerate")}</option><option value="semi-risky">${t("riskSemi")}</option></select></div>
        <div><button class="btn" type="submit">${t("create")}</button></div>
      </form>
      <p class="error" id="s-err" hidden></p><p class="muted" id="s-ok" hidden></p>
    </div>`;
  document.getElementById("sess-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const r = await api(`/api/venues/${f.venueId.value}/sessions`, { method: "POST", body: {
      title: f.title.value, kind: f.kind.value,
      startAt: new Date(f.startAt.value).toISOString(), endAt: new Date(f.endAt.value).toISOString(),
      capacity: Number(f.capacity.value), priceCentsBRL: Number(f.priceCentsBRL.value), risk: f.risk.value
    } });
    if (!r.ok) {
      const err = document.getElementById("s-err");
      err.textContent = JSON.stringify(r.data?.error?.details || r.data?.error || r.data);
      err.hidden = false;
      return;
    }
    document.getElementById("s-ok").textContent = t("created");
    document.getElementById("s-ok").hidden = false;
    setTimeout(render, 700);
  });
}

// ---------- trips ----------

async function viewTrips() {
  app.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const list = await api("/api/admin/trips");
  const rows = list.data.trips.map((x) => `
    <tr><td><a href="#/trips/${x.id}">${esc(x.travelerFirstName)}</a></td>
      <td>${esc(x.destination)}${x.city ? ` — ${esc(x.city)}` : ""}</td>
      <td class="muted">${esc(x.startDate)} → ${esc(x.endDate)}</td>
      <td>${x.contacts} ${t("contacts").toLowerCase()}</td>
      <td>${x.bookings} ${t("bookings").toLowerCase()}</td>
      <td>${x.runs} ${t("runs").toLowerCase()}</td></tr>`).join("");
  app.innerHTML = `<h1>${t("tripList")}</h1>
    <div class="card"><table><thead><tr><th>${t("traveler")}</th><th>${t("fDestination")}</th><th></th><th>${t("contacts")}</th><th>${t("bookings")}</th><th>${t("runs")}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="muted">${t("noData")}</td></tr>`}</tbody></table></div>`;
}

async function viewTripDetail(id) {
  app.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const [tripR, bookingsR, runsR] = await Promise.all([
    api(`/api/trips/${id}`), api(`/api/trips/${id}/bookings`), api("/api/admin/runs")
  ]);
  const trip = tripR.data.trip;
  const contacts = tripR.data.contacts;
  const cRows = contacts.map((c) => `
    <tr><td>${esc(c.name)}</td><td class="mono">${esc(c.identifier)}</td><td>${esc(c.channel)}</td>
      <td>${c.revoked ? `<span class="badge revoked">revoked</span>` : `<span class="badge paid">active</span>`}</td>
      <td class="muted">${fmtTs(c.expiresAt, lang)}</td>
      <td>${c.revoked ? "" : `<button class="btn btn-ghost btn-small" data-revoke="${c.id}">${t("revoke")}</button>`}</td></tr>`).join("");
  const bRows = bookingsR.data.bookings.map((b) => `
    <tr><td class="mono">${esc(b.id.slice(0, 8))}</td>
      <td><span class="badge ${b.status}">${bookingStatusLabel(b.status, lang)}</span></td>
      <td>${fmtMoney(b.priceCentsBRL)}</td><td>${b.gift ? t("gift") + (b.decision ? ` (${b.decision})` : "") : ""}</td></tr>`).join("");
  const myRuns = runsR.data.runs.filter((r) => r.tripId === id);
  const rRows = myRuns.map((r) => `
    <tr><td><a href="#/runs/${r.id}">${esc(r.id.slice(0, 8))}</a></td>
      <td><span class="badge ${r.overdue ? "overdue" : r.status}">${runStatusLabel(r, lang)}</span></td>
      <td class="muted">${fmtTs(r.checkedInAt, lang)}</td></tr>`).join("");
  app.innerHTML = `
    <h1>${esc(trip.travelerFirstName)} — ${esc(trip.destination)}</h1>
    <p class="muted">${esc(trip.city || "")} · ${esc(trip.startDate)} → ${esc(trip.endDate)} · ${t("fTz")}: ${esc(trip.homeTz)}</p>
    <div class="card"><h2>${t("contacts")}</h2>
      <table><thead><tr><th>${t("fContactName")}</th><th>ID</th><th>${t("fChannel")}</th><th>${t("status")}</th><th></th><th></th></tr></thead>
      <tbody>${cRows || `<tr><td colspan="6" class="muted">${t("noData")}</td></tr>`}</tbody></table>
      <form class="inline" id="contact-form" style="margin-top:14px">
        <div class="field"><label>${t("fContactName")}</label><input name="name" required /></div>
        <div class="field"><label>${t("fChannel")}</label><select name="channel"><option value="sms">${t("sms")}</option><option value="email">${t("email")}</option></select></div>
        <div class="field"><label>${t("fIdentifier")}</label><input name="identifier" required /></div>
        <div><button class="btn" type="submit">${t("issue")}</button></div>
      </form>
      <p class="error" id="c-err" hidden></p>
      <div id="c-out" style="margin-top:10px"></div>
    </div>
    <div class="card"><h2>${t("bookings")}</h2>
      <table><thead><tr><th>ID</th><th>${t("status")}</th><th>${t("price")}</th><th></th></tr></thead>
      <tbody>${bRows || `<tr><td colspan="4" class="muted">${t("noData")}</td></tr>`}</tbody></table></div>
    <div class="card"><h2>${t("runs")}</h2>
      <table><thead><tr><th>ID</th><th>${t("status")}</th><th></th></tr></thead>
      <tbody>${rRows || `<tr><td colspan="3" class="muted">${t("noData")}</td></tr>`}</tbody></table></div>`;

  document.getElementById("contact-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const r = await api(`/api/trips/${id}/contacts`, { method: "POST", body: { name: f.name.value, channel: f.channel.value, identifier: f.identifier.value } });
    if (!r.ok) {
      const err = document.getElementById("c-err");
      err.textContent = JSON.stringify(r.data?.error?.details || r.data?.error || r.data);
      err.hidden = false;
      return;
    }
    document.getElementById("c-out").innerHTML = `
      <p><strong>${t("portalLink")}:</strong> <span class="mono">${esc(r.data.portalUrl)}</span></p>
      <p><strong>${t("portalPw")}:</strong> <span class="mono">${esc(r.data.password)}</span></p>`;
    setTimeout(render, 1200);
  });
  document.querySelectorAll("[data-revoke]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Revoke this contact? All sessions die immediately.")) return;
    await api(`/api/trips/${id}/contacts/${b.dataset.revoke}/revoke`, { method: "POST" });
    render();
  }));
}

// ---------- runs ----------

async function viewRuns() {
  app.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const [runsR, bookingsR] = await Promise.all([api("/api/admin/runs"), api("/api/admin/bookings")]);
  const bookingsById = Object.fromEntries(bookingsR.data.bookings.map((b) => [b.id, b]));
  const rows = runsR.data.runs.map((r) => {
    const b = bookingsById[r.bookingId];
    return `<tr><td><a href="#/runs/${r.id}">${esc(r.id.slice(0, 8))}</a></td>
      <td><span class="badge ${r.overdue ? "overdue" : r.status}">${runStatusLabel(r, lang)}</span>${r.incident ? ' <span class="badge overdue">incident</span>' : ""}</td>
      <td class="mono">${esc(r.tripId.slice(0, 8))}</td>
      <td class="muted">${esc(r.phoneCustody?.type || "")} ${esc(r.phoneCustody?.claimCode || "")}</td>
      <td class="muted">${fmtTs(r.checkedInAt, lang)}</td>
      <td class="muted">${r.expectedCheckOut ? fmtTs(r.expectedCheckOut, lang) : "—"}</td>
      <td class="muted">${b ? bookingStatusLabel(b.status, lang) : ""}</td></tr>`;
  }).join("");
  app.innerHTML = `<h1>${t("runList")}</h1>
    <div class="card"><table><thead><tr><th>ID</th><th>${t("status")}</th><th>${t("navTrips")}</th><th>${t("custody")}</th><th>Check-in</th><th>${t("expectedCheckOut")}</th><th>${t("bookings")}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7" class="muted">${t("noData")}</td></tr>`}</tbody></table></div>`;
}

async function viewRunDetail(id) {
  app.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const [runR, logR] = await Promise.all([api(`/api/runs/${id}`), api(`/api/runs/${id}/messages`)]);
  const run = runR.data.run;
  const summary = runR.data.summary;
  const entries = logR.data.entries;
  const eRows = entries.map((e) => `
    <tr><td class="mono">${esc(e.entry_id.slice(0, 8))}</td><td>${fmtTs(e.ts, lang)}</td>
      <td>${esc(e.channel)}</td><td>${esc(e.sender)}</td>
      <td><span class="badge ${e.classification === "urgent" ? "overdue" : ""}">${t(e.classification)}</span></td>
      <td>${esc(e.verification_status)}</td><td>${esc(e.decision || "—")}</td>
      <td>${esc(e.relayed_at ? "relayed" : "—")}</td>
      <td>${e.classification === "urgent" && e.verification_status === "pending" ? `
        <button class="btn btn-small" data-verify="${e.entry_id}" data-v="true">${t("verify")}</button>
        <button class="btn btn-ghost btn-small" data-verify="${e.entry_id}" data-v="false">${t("markUnverified")}</button>` : ""}</td></tr>`).join("");
  app.innerHTML = `
    <h1>${t("runDetail")} <span class="mono">${esc(id.slice(0, 8))}</span></h1>
    <div class="card">
      <p><span class="badge ${run.overdue ? "overdue" : run.status}">${runStatusLabel(run, lang)}</span>
         ${run.incident ? `<span class="badge overdue">incident: ${esc(run.incident.note)}</span>` : ""}</p>
      <p class="muted">${t("custody")}: ${esc(run.phoneCustody?.type)} ${esc(run.phoneCustody?.claimCode || "")} ·
         check-in ${fmtTs(run.checkedInAt, lang)} · ${t("expectedCheckOut")}: ${fmtTs(run.extendedCheckOut || run.expectedCheckOut, lang)}</p>
      <div class="actions">
        <button class="btn btn-small" id="extend-btn">${t("extend30")}</button>
        ${run.status !== "checked_out" ? `<button class="btn btn-small" id="checkout-btn">${t("checkOut")}</button>` : ""}
        <button class="btn btn-ghost btn-small" id="incident-btn">${t("logIncident")}</button>
      </div>
      <p class="muted" id="run-ok" hidden></p>
    </div>
    <div class="card"><h2>${t("checkpointLog")}</h2>
      <table><thead><tr><th>ID</th><th>${t("ts")}</th><th>Channel</th><th>${t("sender")}</th><th>${t("classification")}</th><th>${t("verification")}</th><th>${t("decision")}</th><th>Relay</th><th></th></tr></thead>
      <tbody>${eRows || `<tr><td colspan="9" class="muted">${t("noEntries")}</td></tr>`}</tbody></table>
      <p class="muted" style="margin-top:8px">${t("lifeThreatening")}: interrupt only when verified + life-threatening (docs/05 §2).</p>
    </div>
    ${summary ? `<div class="card"><h2>${t("checkOut")} — summary</h2>
      <p>${fmtTs(summary.checkedOutAt, lang)} · phone-free ${summary.phoneFreeMinutes} min · emergency msgs ${summary.emergencyCount} · messages ${summary.messages.length}</p></div>` : ""}`;

  document.getElementById("extend-btn").addEventListener("click", async () => {
    await api(`/api/runs/${id}/extend`, { method: "POST", body: { minutes: 30 } });
    ok(t("created")); render();
  });
  const coBtn = document.getElementById("checkout-btn");
  if (coBtn) coBtn.addEventListener("click", async () => {
    const r = await api(`/api/runs/${id}/check-out`, { method: "POST" });
    if (r.ok) ok(`phone-free ${r.data.summary.phoneFreeMinutes} min · ${r.data.summary.messages.length} msgs`);
    render();
  });
  document.getElementById("incident-btn").addEventListener("click", async () => {
    const note = prompt("Incident note:");
    if (!note) return;
    await api(`/api/runs/${id}/incident`, { method: "POST", body: { note } });
    render();
  });
  document.querySelectorAll("[data-verify]").forEach((b) => b.addEventListener("click", async () => {
    const life = b.dataset.v === "true" ? confirm(t("lifeThreatening") + "?") : false;
    await api(`/api/messages/${b.dataset.verify}/verify`, { method: "POST", body: { verified: b.dataset.v === "true", via: "callback", lifeThreatening: life } });
    render();
  }));
  function ok(msg) { const el = document.getElementById("run-ok"); if (el) { el.textContent = msg; el.hidden = false; } }
}

// ---------- bookings ----------

async function viewBookings() {
  app.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const [listR, catalogR] = await Promise.all([api("/api/admin/bookings"), api("/api/catalog")]);
  const offById = Object.fromEntries(catalogR.data.catalog.map((c) => [c.id, c]));
  const rows = listR.data.bookings.map((b) => {
    const o = offById[b.offeringId];
    return `<tr><td class="mono">${esc(b.id.slice(0, 8))}</td>
      <td>${esc(o?.title || b.offeringId.slice(0, 8))}</td>
      <td><span class="badge ${b.status}">${bookingStatusLabel(b.status, lang)}</span></td>
      <td>${fmtMoney(b.priceCentsBRL)}</td>
      <td>${b.gift ? t("gift") + (b.decision ? ` — ${b.decision}` : "") : ""}</td>
      <td class="muted">${fmtTs(b.createdAt, lang)}</td>
      <td class="actions">
        ${["pending_payment", "paid", "waitlisted"].includes(b.status) ? `<button class="btn btn-ghost btn-small" data-cancel="${b.id}">${t("cancel")}</button>` : ""}
        ${b.status === "paid" ? `<button class="btn btn-ghost btn-small" data-noshow="${b.id}">${t("noShow")}</button>` : ""}
        ${b.gift && b.decision === "pending" ? `<button class="btn btn-small" data-accept="${b.id}">${t("accept")}</button><button class="btn btn-ghost btn-small" data-decline="${b.id}">${t("decline")}</button>` : ""}
      </td></tr>`;
  }).join("");
  app.innerHTML = `<h1>${t("bookingList")}</h1>
    <div class="card"><table><thead><tr><th>ID</th><th>${t("fTitle")}</th><th>${t("status")}</th><th>${t("price")}</th><th></th><th></th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7" class="muted">${t("noData")}</td></tr>`}</tbody></table></div>`;
  document.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => { await api(`/api/bookings/${b.dataset.cancel}/cancel`, { method: "POST" }); render(); }));
  document.querySelectorAll("[data-noshow]").forEach((b) => b.addEventListener("click", async () => { await api(`/api/bookings/${b.dataset.noshow}/no-show`, { method: "POST" }); render(); }));
  document.querySelectorAll("[data-accept]").forEach((b) => b.addEventListener("click", async () => { await api(`/api/bookings/${b.dataset.accept}/decide`, { method: "POST", body: { accept: true } }); render(); }));
  document.querySelectorAll("[data-decline]").forEach((b) => b.addEventListener("click", async () => { await api(`/api/bookings/${b.dataset.decline}/decide`, { method: "POST", body: { accept: false } }); render(); }));
}

// ---------- audit ----------

async function viewAudit() {
  app.innerHTML = `
    <h1>${t("auditTitle")}</h1>
    <div class="card">
      <form class="inline" id="audit-form">
        <div class="field"><label>${t("filterTrip")}</label><input name="tripId" placeholder="uuid" /></div>
        <div><button class="btn" type="submit">${t("load")}</button></div>
      </form>
      <div id="audit-out" style="margin-top:14px"><p class="muted">${t("noData")}</p></div>
    </div>`;
  document.getElementById("audit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tripId = e.target.tripId.value.trim();
    const r = await api(`/api/audit${tripId ? `?tripId=${tripId}` : ""}`);
    const rows = (r.data?.events || []).map((ev) => `
      <tr><td class="muted">${fmtTs(ev.createdAt, lang)}</td><td>${esc(ev.actorType)}</td><td>${esc(ev.action)}</td>
        <td class="mono">${esc(ev.objectType)}:${esc(String(ev.objectId).slice(0, 8))}</td>
        <td class="muted mono">${esc(ev.ip)}</td></tr>`).join("");
    document.getElementById("audit-out").innerHTML = `
      <p class="muted">${r.data?.count ?? 0}</p>
      <table><thead><tr><th>${t("ts")}</th><th>${t("actor")}</th><th>${t("action")}</th><th>${t("object")}</th><th>${t("ip")}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted">${t("noData")}</td></tr>`}</tbody></table>`;
  });
}

// ---------- waitlist ----------

async function viewWaitlist() {
  app.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const r = await api("/api/admin/waitlist");
  const rows = r.data.entries.map((e) => `
    <tr><td>${esc(e.name)}</td><td class="mono">${esc(e.email)}</td><td>${esc(e.destination || "—")}</td>
      <td>${esc(e.lang)}</td><td class="muted">${esc(e.source)}</td><td class="muted">${fmtTs(e.createdAt, lang)}</td></tr>`).join("");
  app.innerHTML = `<h1>${t("waitlistTitle")} — ${r.data.count}</h1>
    <div class="card"><table><thead><tr><th>${t("name")}</th><th>${t("email")}</th><th>${t("destination")}</th><th>${t("lang")}</th><th>${t("source")}</th><th>${t("joined")}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="muted">${t("noData")}</td></tr>`}</tbody></table></div>`;
}

// ---------- router ----------

async function render() {
  applyLang();
  const hash = location.hash || "#/";
  if (!store.load()) return renderLogin();
  document.getElementById("main-nav").hidden = false;
  document.getElementById("logout-btn").hidden = false;
  document.querySelectorAll(".site-nav a").forEach((a) => a.classList.toggle("active", hash.startsWith(a.getAttribute("href"))));
  const seg = hash.replace(/^#\//, "").split("/");
  try {
    if (seg[0] === "" || seg[0] === undefined) return await viewDashboard();
    if (seg[0] === "venues") return await viewVenues();
    if (seg[0] === "sessions") return await viewSessions();
    if (seg[0] === "trips" && seg[1]) return await viewTripDetail(seg[1]);
    if (seg[0] === "trips") return await viewTrips();
    if (seg[0] === "runs" && seg[1]) return await viewRunDetail(seg[1]);
    if (seg[0] === "runs") return await viewRuns();
    if (seg[0] === "bookings") return await viewBookings();
    if (seg[0] === "audit") return await viewAudit();
    if (seg[0] === "waitlist") return await viewWaitlist();
    return await viewDashboard();
  } catch (e) {
    if (String(e.message) !== "unauthorized") app.innerHTML = `<p class="error">${t("err")}</p>`;
  }
}

document.getElementById("logout-btn").addEventListener("click", () => { store.clear(); location.hash = "#/login"; render(); });
document.getElementById("year").textContent = String(new Date().getFullYear());
window.addEventListener("hashchange", render);
render();
