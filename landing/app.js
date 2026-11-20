/* Hors Ligne — landing page logic
   - PT/EN toggle (copy from docs/03-landing-page-copy.md)
   - Waitlist form: POSTs to WAITLIST_ENDPOINT when configured; otherwise
     queues locally (offline-first, on brand) and retries on next visit.
   No third-party scripts, no trackers. */

"use strict";

/* Endpoint for waitlist submissions. Set at deploy time without editing this
   file — add before app.js in index.html:
     <script>window.HL_WAITLIST_ENDPOINT = "https://api.horslign.earth/api/waitlist";</script>
   Co-hosted by the backend (backend/ PUBLIC_DIR)? "/api/waitlist" works.
   Left empty: submissions queue in localStorage (offline-first fallback). */
const WAITLIST_ENDPOINT = (typeof window !== "undefined" && window.HL_WAITLIST_ENDPOINT) || "";

const I18N = {
  en: {
    docTitle: "Hors Ligne — Phone-free days abroad",
    navHow: "How it works",
    navPortal: "Portal",
    navGift: "Gift",
    navSafety: "Safety",
    navPricing: "Pricing",
    navFaq: "FAQ",
    ctaWaitlistShort: "Join the waitlist",
    ctaWaitlist: "Join the waitlist — first session 50% off",
    ctaDemo: "Watch the 3-min demo",
    heroTitle: "Phone-free days abroad. Your family stays in the loop. You stay safe.",
    heroSub: "Book phone-free adventures — sunrise hikes, surf lessons, meditation, paddleboarding — leave your phone in a safe place, and let the people you love follow your status through a secure portal. No GPS tracking. No spam. Just peace of mind — for both of you.",
    problemTitle: "The problem",
    problemBody: "Traveling with your phone out is a theft risk. Traveling without it makes your family anxious. We built the middle path: you go phone-free, they watch a calm status page.",
    howTitle: "How it works (3 steps)",
    step1Title: "Book & prepay",
    step1Body: "In the app while you have wifi — sessions, retreats, guided activities in the area you're visiting.",
    step2Title: "Leave your phone safe",
    step2Body: "At your accommodation or in our sealed pouch at the venue. Checked in by a vetted local facilitator.",
    step3Title: "Live the moment",
    step3Body: "Zero bars needed. At check-out you get a summary: phone-free time, and any verified messages from outside.",
    portalTitle: "For families: the portal",
    portalBody: "Your loved one shares a unique link + password + one-time code with you. From any browser you see: live session status in your timezone and theirs, expected check-out (with an overdue alert and the venue's emergency number if it runs late), and a way to send routine or urgent messages. Urgent messages are verified by callback before anyone interrupts. After check-out you see the full summary. You never see their exact location — venue and city only.",
    giftTitle: "Gift an experience",
    giftBody: "Browse \"What's on in [destination]\" in the portal and book a paddleboard session, surf lesson or trail tour as a gift. They get a notification, accept or decline — their call, always. Every activity shows a risk label and a vetted, insured local guide.",
    safetyTitle: "Safety & trust",
    safety1: "Facilitators are background-checked, first-aid trained; two-adult rule for minors",
    safety2: "Insurance: public liability, professional indemnity, abuse cover for youth activities",
    safety3: "Remote venues carry a satellite SOS communicator; every session listing shows its emergency channel",
    safety4: "LGPD/GDPR compliant; per-trip credentials expire automatically; full audit log",
    safety5: "Signed waiver + guardian consent for minors at booking",
    pricingTitle: "Pricing",
    pricingBody: "R$ 90 per session (≈ your currency at checkout) · Travel pack: 5 sessions · First session in launch towns 50% off. Gift bookings paid by family. No subscription required.",
    faqTitle: "FAQ",
    faq1q: "What if there's an emergency and there's no signal?",
    faq1a: "Every venue has a satellite SOS or landline; the portal shows which, per session. We don't run sessions where there's no emergency channel.",
    faq2q: "Who can see my location?",
    faq2a: "No one. The portal shows venue + city only.",
    faq3q: "What if I don't check out on time?",
    faq3a: "After a 30-minute grace, your family sees \"overdue\" with the venue's direct number. Overdue ≠ emergency.",
    faq4q: "Can my family book things for me?",
    faq4a: "Yes — as gifts or proposals. You always accept or decline.",
    faq5q: "What happens to messages sent during a session?",
    faq5a: "Logged, verified if marked urgent, and relayed to you at check-out on screen, on a printed slip, and by SMS once you're back in coverage.",
    demoTitle: "The 3-min demo",
    demoBody: "Recorded at launch: a traveler books a phone-free sunrise hike, her family follows from abroad on the portal, gifts a paddleboarding session, and gets a verified urgent message without interrupting the hike. Join the waitlist and we'll send it to you first.",
    waitlistTitle: "Join the waitlist",
    waitlistSub: "First session 50% off in launch towns. No spam — one email when we open in your destination, one when the demo is ready.",
    labelName: "Name",
    labelEmail: "Email",
    labelDestination: "Destination (optional)",
    phDestination: "e.g. Chapada Diamantina, Brazil",
    submit: "Join the waitlist",
    errName: "Please tell us your name.",
    errEmail: "Please enter a valid email address.",
    errSubmit: "Couldn't reach the server — saved on this device, we'll retry automatically.",
    successTitle: "You're on the list.",
    successBody: "We'll email you when we open in your destination — first session 50% off.",
    footerNote: "Phone-free days abroad. Family stays in the loop.",
    footerMail: "hello@phonefree.example"
  },

  pt: {
    docTitle: "Hors Ligne — Dias sem celular na viagem",
    navHow: "Como funciona",
    navPortal: "Portal",
    navGift: "Presente",
    navSafety: "Segurança",
    navPricing: "Preços",
    navFaq: "FAQ",
    ctaWaitlistShort: "Entrar na lista",
    ctaWaitlist: "Quero entrar na lista de espera — primeira sessão 50% off",
    ctaDemo: "Assistir demo de 3 min",
    heroTitle: "Dias sem celular na viagem. Sua família acompanha. Você fica seguro.",
    heroSub: "Reserve aventuras sem celular — trilha ao amanhecer, aula de surf, meditação, stand-up paddle — deixe o celular em local seguro e deixe quem você ama acompanhar seu status por um portal seguro. Sem rastreamento GPS. Sem spam. Só tranquilidade — para os dois.",
    problemTitle: "O problema",
    problemBody: "Viajar com o celular à mostra é risco de roubo. Viajar sem ele deixa sua família angustiada. Criamos o caminho do meio: você vai sem celular, eles acompanham uma página de status calma.",
    howTitle: "Como funciona (3 passos)",
    step1Title: "Reserve e pague",
    step1Body: "No app com wifi — sessões e atividades guiadas no lugar que você visita.",
    step2Title: "Deixe o celular em segurança",
    step2Body: "Na acomodação ou em nossa bolsa lacrada no local. Check-in feito por facilitador local verificado.",
    step3Title: "Viva o momento",
    step3Body: "Funciona sem sinal. No check-out você recebe o resumo: tempo sem celular e mensagens verificadas de fora.",
    portalTitle: "Para a família: o portal",
    portalBody: "Seu ente querido compartilha um link + senha + código único com você. De qualquer navegador você vê: status ao vivo da sessão no seu fuso e no dele, horário previsto de saída (com alerta de atraso e o telefone de emergência do local), e pode mandar mensagens de rotina ou urgentes. Mensagens urgentes são verificadas por ligação antes de interromper qualquer coisa. Depois do check-out você vê o resumo completo. Você nunca vê a localização exata — só local e cidade.",
    giftTitle: "Presenteie uma experiência",
    giftBody: "Navegue em \"O que fazer em [destino]\" no portal e reserve aula de paddle, surf ou trilha como presente. A pessoa recebe um aviso e aceita ou recusa — a decisão é sempre dela. Toda atividade mostra nível de risco e guia local verificado e segurado.",
    safetyTitle: "Segurança e confiança",
    safety1: "Facilitadores com antecedentes verificados e treinamento em primeiros socorros; regra de dois adultos para menores",
    safety2: "Seguros: responsabilidade civil, profissional e cobertura para atividades com jovens",
    safety3: "Locais remotos têm comunicador satelital com SOS; cada sessão mostra seu canal de emergência",
    safety4: "Conformidade LGPD/GDPR; credenciais por viagem expiram sozinhas; log de auditoria completo",
    safety5: "Waiver assinado + consentimento do responsável para menores",
    pricingTitle: "Preços",
    pricingBody: "R$ 90 por sessão · Pacote viagem: 5 sessões · Primeira sessão 50% off nas cidades de lançamento. Presentes pagos pela família. Sem assinatura obrigatória.",
    faqTitle: "FAQ",
    faq1q: "E se houver emergência sem sinal?",
    faq1a: "Todo local tem SOS satelital ou telefone fixo; o portal mostra qual, por sessão. Não operamos em local sem canal de emergência.",
    faq2q: "Quem vê minha localização?",
    faq2a: "Ninguém. Só local e cidade no portal.",
    faq3q: "E se eu não fizer check-out?",
    faq3a: "Após 30 min de tolerância, sua família vê \"atrasado\" com o número direto do local. Atraso não é emergência.",
    faq4q: "Minha família pode reservar coisas para mim?",
    faq4a: "Sim — como presente ou sugestão. Você sempre aceita ou recusa.",
    faq5q: "O que acontece com mensagens enviadas durante a sessão?",
    faq5a: "Registradas, verificadas se urgentes, e entregues no check-out: na tela, no papel impresso e por SMS quando você tiver sinal.",
    demoTitle: "Demo de 3 min",
    demoBody: "Gravado no lançamento: uma viajante reserva uma trilha sem celular ao amanhecer, a família acompanha de longe pelo portal, presenteia uma aula de paddle e recebe uma mensagem urgente verificada sem interromper a trilha. Entre na lista de espera e enviamos para você primeiro.",
    waitlistTitle: "Quero entrar na lista de espera",
    waitlistSub: "Primeira sessão 50% off nas cidades de lançamento. Sem spam — um email quando abrimos no seu destino, outro quando o demo ficar pronto.",
    labelName: "Nome",
    labelEmail: "Email",
    labelDestination: "Destino (opcional)",
    phDestination: "ex.: Chapada Diamantina, Brasil",
    submit: "Quero entrar na lista",
    errName: "Conte seu nome, por favor.",
    errEmail: "Digite um email válido.",
    errSubmit: "Não conseguimos falar com o servidor — salvamos neste dispositivo e tentamos de novo automaticamente.",
    successTitle: "Você está na lista.",
    successBody: "Avisamos por email quando abrimos no seu destino — primeira sessão 50% off.",
    footerNote: "Dias sem celular na viagem. A família acompanha.",
    footerMail: "ola@phonefree.example"
  }
};

const QUEUE_KEY = "hl_waitlist_queue";

function getLang() {
  const saved = localStorage.getItem("hl-lang");
  if (saved === "en" || saved === "pt") return saved;
  return (navigator.language || "en").toLowerCase().startsWith("pt") ? "pt" : "en";
}

function applyLang(lang) {
  const dict = I18N[lang];
  document.documentElement.lang = lang;
  document.title = dict.docTitle;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (dict[key] !== undefined) el.textContent = dict[key];
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (dict[key] !== undefined) el.setAttribute("placeholder", dict[key]);
  });
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
  });
  const mail = document.getElementById("footer-mail");
  if (mail) {
    mail.textContent = dict.footerMail;
    mail.setAttribute("href", "mailto:" + dict.footerMail);
  }
  localStorage.setItem("hl-lang", lang);
}

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyLang(btn.getAttribute("data-lang")));
});

/* ---- Waitlist form ---- */

function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }
  catch { return []; }
}

function saveQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

async function flushQueue(dict) {
  if (!WAITLIST_ENDPOINT) return;
  const q = getQueue();
  if (!q.length) return;
  const remaining = [];
  for (const entry of q) {
    try {
      const res = await fetch(WAITLIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry)
      });
      if (!res.ok) remaining.push(entry);
    } catch { remaining.push(entry); }
  }
  saveQueue(remaining);
}

function showError(msgKey) {
  const dict = I18N[getLang()];
  const err = document.getElementById("wl-error");
  err.textContent = dict[msgKey];
  err.hidden = false;
}

async function handleSubmit(event) {
  event.preventDefault();
  const dict = I18N[getLang()];
  const form = event.target;
  const err = document.getElementById("wl-error");
  err.hidden = true;

  // Honeypot: bots fill it, humans don't.
  if (form.company.value) return;

  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const destination = form.destination.value.trim();

  if (!name) { showError("errName"); form.name.focus(); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError("errEmail"); form.email.focus(); return; }

  const entry = {
    name, email, destination,
    lang: getLang(),
    source: "landing",
    ts: new Date().toISOString()
  };

  let delivered = false;
  if (WAITLIST_ENDPOINT) {
    try {
      const res = await fetch(WAITLIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry)
      });
      delivered = res.ok;
    } catch { delivered = false; }
  }
  if (!delivered) {
    const q = getQueue();
    q.push(entry);
    saveQueue(q);
    if (WAITLIST_ENDPOINT) showError("errSubmit");
  }

  form.hidden = true;
  document.getElementById("wl-success").hidden = false;
}

document.getElementById("waitlist-form").addEventListener("submit", handleSubmit);

document.getElementById("year").textContent = String(new Date().getFullYear());

applyLang(getLang());
flushQueue();
