// portal/app.js — family portal SPA (hash router, no build step).
// Flow: #/p/<invite-token> → password → OTP → dashboard.
// API: window.HL_API_BASE (config.js). PT/EN toggle persisted in localStorage.

import {
  apiFetch, parseInviteToken, fmtDual, fmtDate,
  statusLabel, riskLabel, verifLabel, createSessionStore
} from "./lib.js";

const API = window.HL_API_BASE || "http://localhost:3000";
const store = createSessionStore(window.sessionStorage);

const I18N = {
  en: {
    portalTag: "family portal",
    logout: "Log out",
    footerNote: "Venue + city only. Never your location. Per-trip access expires automatically.",
    loginTitle: "Family portal",
    loginHint: "Open the invite link your traveler shared, paste the password, then enter the one-time code sent to your phone/email.",
    passwordLabel: "Password", otpLabel: "One-time code (6 digits)",
    submitPassword: "Continue", submitOtp: "Sign in", resendOtp: "Resend code",
    waitingOtp: "We sent a 6-digit code to your {channel}. It expires in 10 minutes.",
    demoOtpNote: "Demo mode: code shown by the API.",
    errLink: "This invite link is invalid or was rotated after a login. Ask the traveler for the newest link.",
    errPassword: "Wrong password.",
    errOtp: "Wrong code. {n} attempts left.",
    errLocked: "Too many attempts — locked for now; the traveler has been notified.",
    errExpired: "This access expired (trip end + 24h) or was revoked.",
    errGeneric: "Something went wrong. Try again.",
    statusTitle: "Session status",
    noRun: "No session yet. Booked sessions appear here.",
    traveler: "Traveler", destination: "Destination",
    session: "Session", expectedCheckOut: "Expected check-out",
    lastSynced: "Last synced", venue: "Venue",
    overdueTitle: "Overdue — not an emergency",
    overdueBody: "Past expected check-out + 30 min grace. If it persists, call the venue directly:",
    incidentTitle: "Incident in progress",
    incidentBody: "The facilitator is handling an emergency. Venue channel:",
    messagesTitle: "Messages",
    msgHint: "Urgent messages are verified by callback before anyone is interrupted. Unverified messages are relayed at check-out only.",
    msgLabel: "Message", urgencyLabel: "Urgency",
    routine: "Routine", urgent: "Urgent",
    sendMsg: "Send", msgSent: "Sent — will be relayed at check-out.",
    noMessages: "No messages yet.",
    delivered: "delivered at check-out", pendingDelivery: "not yet delivered",
    exploreTitle: "Explore & book in {destination}",
    bookGift: "Book as gift", bookPropose: "Propose",
    booked: "Booked", waitlisted: "Added to waitlist",
    risk: "Risk", spots: "spots left", full: "full",
    price: "Price", when: "When", channel: "Emergency channel",
    bookingsTitle: "Bookings for this trip",
    noBookings: "Nothing booked yet.",
    giftPending: "gift — waiting for traveler to accept",
    summaryTitle: "Check-out summary",
    phoneFree: "Phone-free time", emergencyMsgs: "Verified emergency messages",
    checkedOutAt: "Checked out at",
    loading: "Loading…"
  },
  pt: {
    portalTag: "portal da família",
    logout: "Sair",
    footerNote: "Só local e cidade. Nunca sua localização. O acesso por viagem expira sozinho.",
    loginTitle: "Portal da família",
    loginHint: "Abra o link que o viajante compartilhou, digite a senha e depois o código único enviado ao seu celular/email.",
    passwordLabel: "Senha", otpLabel: "Código único (6 dígitos)",
    submitPassword: "Continuar", submitOtp: "Entrar", resendOtp: "Reenviar código",
    waitingOtp: "Enviamos um código de 6 dígitos para o seu {channel}. Ele expira em 10 minutos.",
    demoOtpNote: "Modo demo: código devolvido pela API.",
    errLink: "Este link é inválido ou já foi usado — links giram a cada login. Peça o link mais recente ao viajante.",
    errPassword: "Senha incorreta.",
    errOtp: "Código errado. Restam {n} tentativas.",
    errLocked: "Tentativas demais — bloqueado por enquanto; o viajante foi avisado.",
    errExpired: "Este acesso expirou (fim da viagem + 24h) ou foi revogado.",
    errGeneric: "Algo deu errado. Tente de novo.",
    statusTitle: "Status da sessão",
    noRun: "Nenhuma sessão ainda. Sessões reservadas aparecem aqui.",
    traveler: "Viajante", destination: "Destino",
    session: "Sessão", expectedCheckOut: "Check-out previsto",
    lastSynced: "Última sincronização", venue: "Local",
    overdueTitle: "Atrasada — não é emergência",
    overdueBody: "Passou do check-out previsto + 30 min de tolerância. Se persistir, ligue direto para o local:",
    incidentTitle: "Incidente em andamento",
    incidentBody: "O facilitador está tratando de uma emergência. Canal do local:",
    messagesTitle: "Mensagens",
    msgHint: "Mensagens urgentes são verificadas por ligação antes de interromper alguém. Não verificadas são entregues só no check-out.",
    msgLabel: "Mensagem", urgencyLabel: "Urgência",
    routine: "Rotina", urgent: "Urgente",
    sendMsg: "Enviar", msgSent: "Enviada — será entregue no check-out.",
    noMessages: "Nenhuma mensagem ainda.",
    delivered: "entregue no check-out", pendingDelivery: "ainda não entregue",
    exploreTitle: "Explorar e reservar em {destination}",
    bookGift: "Reservar de presente", bookPropose: "Sugerir",
    booked: "Reservado", waitlisted: "Entrou na lista de espera",
    risk: "Risco", spots: "vagas", full: "lotado",
    price: "Preço", when: "Quando", channel: "Canal de emergência",
    bookingsTitle: "Reservas desta viagem",
    noBookings: "Nada reservado ainda.",
    giftPending: "presente — aguardando o viajante aceitar",
    summaryTitle: "Resumo do check-out",
    phoneFree: "Tempo sem celular", emergencyMsgs: "Mensagens de emergência verificadas",
    checkedOutAt: "Check-out às",
    loading: "Carregando…"
  }
};

let lang = localStorage.getItem("hl-lang") || (navigator.language || "en").toLowerCase().startsWith("pt") ? "pt" : "en";
if (!I18N[lang]) lang = "en";
const t = (key, vars) => {
  let s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
};

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
  localStorage.setItem("hl-lang", lang);
}
document.querySelectorAll(".lang-btn").forEach((b) => b.addEventListener("click", () => { lang = b.dataset.lang; applyLang(); render(); }));

const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild;
}

// ---------- login view ----------

function renderLogin(token) {
  document.getElementById("logout-btn").hidden = true;
  app.innerHTML = `
    <div class="card" style="max-width:520px;margin:32px auto 0">
      <h1>${t("loginTitle")}</h1>
      <p class="muted">${t("loginHint")}</p>
      <form class="login" id="login-form">
        <div class="field" id="pw-field">
          <label for="pw">${t("passwordLabel")}</label>
          <input id="pw" type="password" autocomplete="current-password" required />
        </div>
        <div class="field" id="otp-field" hidden>
          <label for="otp">${t("otpLabel")}</label>
          <input id="otp" class="otp-input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
          <p class="muted" id="otp-hint"></p>
        </div>
        <p class="error" id="login-err" hidden></p>
        <div>
          <button class="btn" id="login-submit" type="submit">${t("submitPassword")}</button>
          <button class="btn btn-ghost btn-small" id="resend-btn" type="button" hidden>${t("resendOtp")}</button>
        </div>
      </form>
    </div>`;

  let otpId = null;
  const form = document.getElementById("login-form");
  const errBox = document.getElementById("login-err");
  const showErr = (msg) => { errBox.textContent = msg; errBox.hidden = false; };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    if (!otpId) {
      const password = document.getElementById("pw").value;
      const r = await apiFetch(API, "/api/portal/start", { method: "POST", body: { linkToken: token, password } });
      if (!r.ok) {
        const code = r.data?.error?.code;
        if (code === "invalid_link") return showErr(t("errLink"));
        if (code === "invalid_password") return showErr(t("errPassword"));
        if (code === "revoked" || code === "expired" || code === "trip_gone") return showErr(t("errExpired"));
        if (code === "rate_limited") return showErr(t("errLocked"));
        return showErr(t("errGeneric"));
      }
      otpId = r.data.otpId;
      document.getElementById("pw-field").hidden = true;
      document.getElementById("otp-field").hidden = false;
      document.getElementById("resend-btn").hidden = false;
      document.getElementById("login-submit").textContent = t("submitOtp");
      const hint = document.getElementById("otp-hint");
      hint.textContent = t("waitingOtp", { channel: r.data.channel });
      if (r.data.devOtp) {
        document.getElementById("otp").value = r.data.devOtp;
        hint.textContent += " " + t("demoOtpNote");
      }
      document.getElementById("otp").focus();
      return;
    }
    const otp = document.getElementById("otp").value.trim();
    const r = await apiFetch(API, "/api/portal/verify", { method: "POST", body: { otpId, otp } });
    if (!r.ok) {
      const code = r.data?.error?.code;
      if (code === "invalid_otp") return showErr(t("errOtp", { n: r.data.error.attemptsRemaining }));
      if (code === "otp_locked") return showErr(t("errLocked"));
      if (code === "otp_expired" || code === "otp_session") { otpId = null; return form.requestSubmit(); }
      return showErr(t("errGeneric"));
    }
    store.save({ token: r.data.session, expiresAt: r.data.expiresAt, contact: r.data.contact, trip: r.data.trip });
    location.hash = "#/";
    render();
  });

  document.getElementById("resend-btn").addEventListener("click", async () => {
    if (!otpId) return;
    const r = await apiFetch(API, "/api/portal/resend-otp", { method: "POST", body: { otpId } });
    if (r.ok) otpId = r.data.otpId;
  });
}

// ---------- dashboard ----------

async function renderDashboard() {
  const session = store.load();
  if (!session || !session.token) { location.hash = "#/login"; return render(); }
  document.getElementById("logout-btn").hidden = false;
  app.innerHTML = `<p class="muted">${t("loading")}</p>`;

  const [statusR, msgsR, bookingsR, catalogR, meR] = await Promise.all([
    apiFetch(API, "/api/portal/status", { token: session.token }),
    apiFetch(API, "/api/portal/messages", { token: session.token }),
    apiFetch(API, "/api/portal/bookings", { token: session.token }),
    apiFetch(API, "/api/portal/catalog", { token: session.token }),
    apiFetch(API, "/api/portal/me", { token: session.token })
  ]);

  if (statusR.status === 401 || meR.status === 401) { store.clear(); location.hash = "#/login"; return render(); }
  if (!statusR.ok) { app.innerHTML = `<p class="error">${t("errGeneric")}</p>`; return; }

  const { trip, homeTz, run, runs } = statusR.data;
  const venueTz = run?.venue?.tz || "UTC";
  const messages = msgsR.ok ? msgsR.data.messages : [];
  const bookings = bookingsR.ok ? bookingsR.data.bookings : [];
  const catalog = catalogR.ok ? catalogR.data.catalog : [];

  const statusBadge = run
    ? `<span class="badge ${run.status}">${statusLabel(run.status, lang)}</span>`
    : "";
  const overdueBanner = run?.overdue ? `
    <div class="banner"><strong>${t("overdueTitle")}</strong>
      <p style="margin:6px 0 4px">${t("overdueBody")}</p>
      <p class="mono" style="margin:0">${esc(run.emergencyChannel?.type)}: ${esc(run.emergencyChannel?.contact)}</p>
    </div>` : "";
  const incidentBanner = run?.incidentInProgress ? `
    <div class="banner"><strong>${t("incidentTitle")}</strong>
      <p style="margin:6px 0 0">${t("incidentBody")} ${esc(run.venue?.name)}</p>
    </div>` : "";

  const statusCard = `
    <div class="card">
      <h2>${t("statusTitle")} ${statusBadge}</h2>
      <dl class="kv">
        <dt>${t("traveler")}</dt><dd>${esc(trip.travelerFirstName)}</dd>
        <dt>${t("destination")}</dt><dd>${esc(trip.destination)}${trip.city ? ` — ${esc(trip.city)}` : ""}</dd>
        ${run ? `
        <dt>${t("session")}</dt><dd>${esc(run.offering?.title || "")}</dd>
        <dt>${t("when")}</dt><dd>${run.offering ? `${fmtDual(run.offering.startAt, venueTz, homeTz, lang)} → ${fmtDual(run.offering.endAt, venueTz, homeTz, lang)}` : "—"}</dd>
        <dt>${t("venue")}</dt><dd>${esc(run.venue?.name)}, ${esc(run.venue?.city)} <span class="muted">(${esc(run.venue?.tz)})</span></dd>
        <dt>${t("expectedCheckOut")}</dt><dd>${fmtDual(run.expectedCheckOut, venueTz, homeTz, lang)}</dd>
        <dt>${t("lastSynced")}</dt><dd>${run.lastSyncedAt ? fmtDual(run.lastSyncedAt, venueTz, homeTz, lang) : "—"}</dd>` : `<dt></dt><dd class="muted">${t("noRun")}</dd>`}
      </dl>
    </div>`;

  const msgItems = messages.length
    ? messages.map((m) => `<li>
        <div>${esc(m.content)}</div>
        <div class="muted">${m.classification === "urgent" ? "🔴 " : ""} ${verifLabel(m.verification, lang)} ·
          ${m.deliveredAt ? t("delivered") : t("pendingDelivery")} · ${fmtDual(m.createdAt, venueTz, homeTz, lang)}</div>
      </li>`).join("")
    : `<li class="muted">${t("noMessages")}</li>`;

  const messagesCard = `
    <div class="card">
      <h2>${t("messagesTitle")}</h2>
      <p class="muted">${t("msgHint")}</p>
      <ul class="msg-list" style="margin-bottom:14px">${msgItems}</ul>
      <form id="msg-form" style="display:grid;gap:10px">
        <div class="field">
          <label for="msg-text">${t("msgLabel")}</label>
          <textarea id="msg-text" maxlength="500" required></textarea>
        </div>
        <div class="field">
          <label for="msg-urgency">${t("urgencyLabel")}</label>
          <select id="msg-urgency"><option value="routine">${t("routine")}</option><option value="urgent">${t("urgent")}</option></select>
        </div>
        <p class="error" id="msg-err" hidden></p>
        <div><button class="btn" type="submit">${t("sendMsg")}</button></div>
      </form>
    </div>`;

  const catItems = catalog.length
    ? catalog.map((c) => `<li>
        <div class="row"><h3 style="margin:0">${esc(c.title)}</h3>
          <span class="badge risk-${c.risk}">${riskLabel(c.risk, lang)}</span>
          ${c.status === "full" ? `<span class="badge">${t("full")}</span>` : `<span class="badge">${c.spotsLeft} ${t("spots")}</span>`}
        </div>
        <div class="muted">${esc(c.kind)} · ${fmtDual(c.startAt, c.venue?.tz || venueTz, homeTz, lang)} → ${fmtDual(c.endAt, c.venue?.tz || venueTz, homeTz, lang)}</div>
        <div class="muted">${esc(c.venue?.name)}, ${esc(c.venue?.city)} · ${t("price")} R$ ${esc(c.priceBRL)} · ${t("channel")}: ${esc(c.venue?.emergencyChannel?.type)}</div>
        <div class="actions">
          <button class="btn btn-small" data-book="${c.id}" data-gift="true">${t("bookGift")}</button>
          <button class="btn btn-ghost btn-small" data-book="${c.id}" data-gift="false">${t("bookPropose")}</button>
        </div>
      </li>`).join("")
    : `<li class="muted">${t("noBookings")}</li>`;

  const exploreCard = `
    <div class="card">
      <h2>${t("exploreTitle", { destination: trip.destination })}</h2>
      <ul class="cat-list">${catItems}</ul>
    </div>`;

  const bookItems = bookings.length
    ? bookings.map((b) => `<li>
        <div><strong>${esc(b.gift ? "🎁 " : "")}${b.status}</strong> ${b.gift && b.decision === "pending" ? `<span class="muted">(${t("giftPending")})</span>` : ""}</div>
        <div class="muted">${t("price")} R$ ${(b.priceCentsBRL / 100).toFixed(2)} · ${fmtDual(b.createdAt, venueTz, homeTz, lang)}</div>
      </li>`).join("")
    : `<li class="muted">${t("noBookings")}</li>`;

  const bookingsCard = `
    <div class="card">
      <h2>${t("bookingsTitle")}</h2>
      <ul class="book-list">${bookItems}</ul>
    </div>`;

  app.innerHTML = `
    ${overdueBanner}${incidentBanner}
    <div class="grid">${statusCard}${messagesCard}</div>
    ${exploreCard}${bookingsCard}`;

  // check-out summary if the latest run is checked out
  const lastRun = runs && runs.length ? runs[runs.length - 1] : null;
  if (lastRun && lastRun.status === "checked_out") {
    const sumR = await apiFetch(API, `/api/runs/${lastRun.id}/summary`, { token: session.token });
    if (sumR.ok) {
      const s = sumR.data.summary;
      const card = el(`
        <div class="card">
          <h2>${t("summaryTitle")}</h2>
          <dl class="kv">
            <dt>${t("checkedOutAt")}</dt><dd>${fmtDual(s.checkedOutAt, venueTz, homeTz, lang)}</dd>
            <dt>${t("phoneFree")}</dt><dd>${s.phoneFreeMinutes} min</dd>
            <dt>${t("emergencyMsgs")}</dt><dd>${s.emergencyCount}</dd>
            <dt>${t("messagesTitle")}</dt><dd>${s.messages.length} (${s.messages.filter((m) => m.delivered).length} ${t("delivered")})</dd>
          </dl>
        </div>`);
      app.appendChild(card);
    }
  }

  // wire message form
  document.getElementById("msg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = document.getElementById("msg-err");
    errBox.hidden = true;
    const r = await apiFetch(API, "/api/portal/messages", {
      method: "POST", token: session.token,
      body: { text: document.getElementById("msg-text").value, urgency: document.getElementById("msg-urgency").value }
    });
    if (!r.ok) {
      errBox.textContent = r.data?.error?.code === "rate_limited" ? t("errLocked") : (r.data?.error?.message || t("errGeneric"));
      errBox.hidden = false;
      return;
    }
    renderDashboard();
  });

  // wire book buttons
  document.querySelectorAll("[data-book]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const r = await apiFetch(API, "/api/portal/book", {
        method: "POST", token: session.token,
        body: { offeringId: btn.dataset.book, gift: btn.dataset.gift === "true" }
      });
      if (r.ok) {
        btn.textContent = r.data.waitlisted ? t("waitlisted") : t("booked");
      } else {
        btn.disabled = false;
      }
      renderDashboardSoon();
    });
  });
}

let refreshTimer = null;
function renderDashboardSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(render, 800);
}

// ---------- router ----------

function render() {
  applyLang();
  const hash = location.hash || "#/";
  const token = parseInviteToken(hash);
  if (token) return renderLogin(token);
  if (hash === "#/login" && !store.load()) {
    // manual link paste
    document.getElementById("logout-btn").hidden = true;
    app.innerHTML = `
      <div class="card" style="max-width:520px;margin:32px auto 0">
        <h1>${t("loginTitle")}</h1>
        <form class="login" id="paste-form">
          <div class="field">
            <label for="paste-link">${t("loginHint")}</label>
            <input id="paste-link" type="text" placeholder="https://…/p/…" required />
          </div>
          <div><button class="btn" type="submit">${t("submitPassword")}</button></div>
        </form>
      </div>`;
    document.getElementById("paste-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const tok = parseInviteToken(document.getElementById("paste-link").value);
      if (tok) location.hash = `#/p/${tok}`;
    });
    return;
  }
  renderDashboard();
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  const session = store.load();
  if (session) await apiFetch(API, "/api/portal/logout", { method: "POST", token: session.token });
  store.clear();
  location.hash = "#/login";
  render();
});

document.getElementById("year").textContent = String(new Date().getFullYear());
window.addEventListener("hashchange", render);
render();
// auto-refresh status every 30s while on dashboard
setInterval(() => {
  if (store.load() && !parseInviteToken(location.hash)) renderDashboardSoon();
}, 30000);
