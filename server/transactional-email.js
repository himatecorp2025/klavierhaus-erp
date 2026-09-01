const { Resend } = require("resend");

const DEFAULT_FROM = "Klavierhaus Accounts <accounts@klavierhaus.com>";
const DEFAULT_EVENT_FROM = "Klavierhaus Events <events@klavierhaus.com>";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildActivationEmail({ name, code, appBaseUrl = "" }) {
  if (!/^\d{6}$/.test(String(code || ""))) throw new Error("INVALID_ACTIVATION_CODE");
  const safeName = escapeHtml(name || "Colleague");
  const safeCode = escapeHtml(code);
  const loginUrl = String(appBaseUrl || "").replace(/\/$/, "");
  const loginLink = loginUrl
    ? `<p style="margin:24px 0"><a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:12px 20px;border-radius:9px;background:#111827;color:#ffffff;text-decoration:none;font-weight:700">Open Klavierhaus ERP / Klavierhaus ERP megnyitása</a></p>`
    : "";
  const subject = "Klavierhaus ERP activation code / Aktiválókód";
  const text = [
    `Hello ${name || "Colleague"},`,
    "Your one-time Klavierhaus ERP activation code is:",
    String(code),
    "The code does not expire, but it can only be used once. A newly requested code invalidates the previous one.",
    "Never share your password or this activation code.",
    "",
    `Kedves ${name || "Munkatárs"}!`,
    "A Klavierhaus ERP egyszer használható aktiválókódod:",
    String(code),
    "A kód nem jár le, de csak egyszer használható. Új kód kérésekor a korábbi kód érvénytelenné válik.",
    "A jelszavadat és ezt az aktiválókódot ne add át másnak.",
    loginUrl ? `ERP: ${loginUrl}` : ""
  ].filter(Boolean).join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ec;color:#111827;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="background:#ffffff;border:1px solid #d6c9aa;border-radius:18px;padding:30px"><h1 style="margin:0 0 18px;font-size:25px">Klavierhaus ERP</h1><p>Hello ${safeName},</p><p>Your one-time activation code is:</p><div style="margin:22px 0;padding:18px;border-radius:12px;background:#111827;color:#d7b66b;text-align:center;font-size:34px;font-weight:800;letter-spacing:8px">${safeCode}</div><p>The code does not expire, but it can only be used once. A newly requested code invalidates the previous one.</p><p style="color:#6b7280">Never share your password or this activation code.</p><hr style="margin:28px 0;border:0;border-top:1px solid #e5e7eb"><p>Kedves ${safeName}!</p><p>A Klavierhaus ERP egyszer használható aktiválókódod:</p><div style="margin:22px 0;padding:18px;border-radius:12px;background:#111827;color:#d7b66b;text-align:center;font-size:34px;font-weight:800;letter-spacing:8px">${safeCode}</div><p>A kód nem jár le, de csak egyszer használható. Új kód kérésekor a korábbi kód érvénytelenné válik.</p><p style="color:#6b7280">A jelszavadat és ezt az aktiválókódot ne add át másnak.</p>${loginLink}</div></div></body></html>`;
  return { subject, text, html };
}

function eventDate(value, locale) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "America/New_York",
    dateStyle: "long",
    timeStyle: "short"
  }).format(new Date(value));
}

function buildEventInvitationEmail({ name, event, invitationUrl }) {
  const safeName = escapeHtml(name || "Guest");
  const safeTitleEn = escapeHtml(event.title_en || "Klavierhaus event");
  const safeTitleHu = escapeHtml(event.title_hu || event.title_en || "Klavierhaus esemény");
  const safeVenue = escapeHtml(event.venue_name || "Klavierhaus");
  const safeUrl = escapeHtml(invitationUrl);
  const dateEn = eventDate(event.start_at, "en-US");
  const dateHu = eventDate(event.start_at, "hu-HU");
  const subject = `Private invitation: ${event.title_en || "Klavierhaus event"} / Személyes meghívás`;
  const text = [
    `Hello ${name || "Guest"},`,
    `Klavierhaus invites you to ${event.title_en || "a private event"}.`,
    `${dateEn} · ${event.venue_name || "Klavierhaus"}`,
    `Accept or decline: ${invitationUrl}`,
    "Your invitation reserves a place only after you accept it and while capacity remains.",
    "",
    `Kedves ${name || "Vendég"}!`,
    `A Klavierhaus szeretettel meghívja a következő eseményre: ${event.title_hu || event.title_en || "Klavierhaus esemény"}.`,
    `${dateHu} · ${event.venue_name || "Klavierhaus"}`,
    `Elfogadás vagy visszautasítás: ${invitationUrl}`,
    "A meghívás csak az elfogadás után és a szabad férőhelyek erejéig foglal helyet."
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#080807;color:#f7f3e8;font-family:Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:34px 18px"><div style="border:1px solid #9d7a35;border-radius:18px;padding:32px;background:#11110f"><p style="margin:0 0 12px;color:#c9a45d;letter-spacing:.18em;text-transform:uppercase">Klavierhaus · New York</p><h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:30px">${safeTitleEn}</h1><p>Hello ${safeName},</p><p>Klavierhaus is pleased to extend a private invitation.</p><p style="color:#d9d1c1"><strong>${escapeHtml(dateEn)}</strong><br>${safeVenue}</p><p style="margin:26px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#c9a45d;color:#080807;text-decoration:none;font-weight:700">Respond to invitation / Válasz a meghívásra</a></p><p style="color:#aaa08f">A place is reserved only after acceptance and while capacity remains.</p><hr style="margin:30px 0;border:0;border-top:1px solid #3b3428"><h2 style="font-family:Georgia,serif">${safeTitleHu}</h2><p>Kedves ${safeName}!</p><p>A Klavierhaus szeretettel meghívja erre a különleges eseményre.</p><p style="color:#d9d1c1"><strong>${escapeHtml(dateHu)}</strong><br>${safeVenue}</p><p style="color:#aaa08f">A meghívás csak elfogadás után és a szabad férőhelyek erejéig foglal helyet.</p></div></div></body></html>`;
  return { subject, text, html };
}

function buildEventInterestEmail({ event, language = "en", websiteBaseUrl = "" }) {
  const title = language === "hu" ? (event.title_hu || event.title_en) : event.title_en;
  const subject = language === "hu" ? `Érdeklődés rögzítve: ${title}` : `Interest recorded: ${title}`;
  const url = `${String(websiteBaseUrl || "").replace(/\/$/, "")}${language === "hu" ? `/hu/esemenyek/${event.slug_hu}` : `/events/${event.slug_en}`}`;
  const text = language === "hu"
    ? `Köszönjük érdeklődését a(z) ${title} esemény iránt. Értesítjük, ha új alkalmat hirdetünk meg.\n${url}`
    : `Thank you for your interest in ${title}. We will notify you if a new edition is announced.\n${url}`;
  const html = `<!doctype html><html><body style="margin:0;background:#080807;color:#f7f3e8;font-family:Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:34px 18px"><div style="border:1px solid #9d7a35;border-radius:18px;padding:32px;background:#11110f"><p style="color:#c9a45d;letter-spacing:.18em;text-transform:uppercase">Klavierhaus · New York</p><h1 style="font-family:Georgia,serif">${escapeHtml(title)}</h1><p>${escapeHtml(text.split("\n")[0])}</p><p><a href="${escapeHtml(url)}" style="color:#d7b66b">${escapeHtml(language === "hu" ? "Esemény megtekintése" : "View event")}</a></p></div></div></body></html>`;
  return { subject, text, html };
}

function buildEventReturnAnnouncement({ event, language = "en", websiteBaseUrl = "" }) {
  const title = language === "hu" ? (event.title_hu || event.title_en) : event.title_en;
  const url = `${String(websiteBaseUrl || "").replace(/\/$/, "")}${language === "hu" ? `/hu/esemenyek/${event.slug_hu}` : `/events/${event.slug_en}`}`;
  const when = eventDate(event.start_at, language === "hu" ? "hu-HU" : "en-US");
  const subject = language === "hu" ? `Új időpont: ${title}` : `A new date is available: ${title}`;
  const lead = language === "hu" ? "Az Ön érdeklődése alapján értesítjük, hogy az eseményt ismét meghirdettük." : "You asked to be informed, and this Klavierhaus event is now available again.";
  const action = language === "hu" ? "Esemény és jegyek" : "Event and tickets";
  const text = `${lead}\n${title}\n${when}\n${url}`;
  const html = `<!doctype html><html><body style="margin:0;background:#080807;color:#f7f3e8;font-family:Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:34px 18px"><div style="border:1px solid #9d7a35;border-radius:18px;padding:32px;background:#11110f"><p style="color:#c9a45d;letter-spacing:.18em;text-transform:uppercase">Klavierhaus · New York</p><h1 style="font-family:Georgia,serif">${escapeHtml(title)}</h1><p>${escapeHtml(lead)}</p><p><strong>${escapeHtml(when)}</strong></p><p><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#c9a45d;color:#080807;text-decoration:none;font-weight:700">${escapeHtml(action)}</a></p></div></div></body></html>`;
  return { subject, text, html };
}

function buildEventPurchaseEmail({ purchaserName, event, payment, invoiceNumber, company, websiteBaseUrl = "" }) {
  const titleEn = event.title_en || "Klavierhaus event";
  const titleHu = event.title_hu || titleEn;
  const amount = `${String(payment.currency || "USD").toUpperCase()} ${(Number(payment.amount_total || 0) / 100).toFixed(2)}`;
  const safeName = escapeHtml(purchaserName || "Guest");
  const safeTitle = escapeHtml(titleEn);
  const safeTitleHu = escapeHtml(titleHu);
  const safeInvoice = escapeHtml(invoiceNumber);
  const eventUrl = `${String(websiteBaseUrl || "").replace(/\/$/, "")}/events/${encodeURIComponent(event.slug_en || "")}`;
  return {
    subject: `Klavierhaus ticket confirmation · ${titleEn}`,
    text: [`Hello ${purchaserName || "Guest"},`, `Thank you for your purchase for ${titleEn}.`, `Invoice: ${invoiceNumber}`, `Amount paid: ${amount}`, `Your ticket PDF is attached.`, eventUrl, "", `Kedves ${purchaserName || "Vendég"}!`, `Köszönjük a vásárlást: ${titleHu}.`, `Számla: ${invoiceNumber}`, `A jegyeket PDF-mellékletben küldjük.`].join("\n"),
    html: `<!doctype html><html><body style="margin:0;background:#080807;color:#f7f3e8;font-family:Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:34px 18px"><div style="border:1px solid #9d7a35;border-radius:18px;padding:32px;background:#11110f"><p style="color:#c9a45d;letter-spacing:.18em;text-transform:uppercase">Klavierhaus · New York</p><h1 style="font-family:Georgia,serif">Thank you, ${safeName}</h1><p>Your place for <strong>${safeTitle}</strong> is recorded. The ticket PDF and invoice are attached.</p><p style="color:#d9d1c1"><strong>${safeInvoice}</strong> · ${escapeHtml(amount)}</p><p><a href="${escapeHtml(eventUrl)}" style="color:#d7b66b">View event</a></p><hr style="margin:30px 0;border:0;border-top:1px solid #3b3428"><h2 style="font-family:Georgia,serif">${safeTitleHu}</h2><p>Köszönjük a vásárlást. A PDF-jegyet és a bizonylatot mellékletben találja.</p></div></div></body></html>`
  };
}

function buildTicketDocumentsEmail({ name, event, language = "en" }) {
  const title = language === "hu" ? (event.title_hu || event.title_en) : event.title_en;
  return {
    subject: language === "hu" ? `Klavierhaus jegyek · ${title}` : `Klavierhaus tickets · ${title}`,
    text: language === "hu" ? `Kedves ${name || "Vendég"}! A ${title} eseményhez tartozó PDF-jegyet mellékletben küldjük.` : `Hello ${name || "Guest"}, your PDF ticket for ${title} is attached.`,
    html: `<div style="font-family:Arial,sans-serif;background:#080807;color:#f7f3e8;padding:32px"><p style="color:#c9a45d;letter-spacing:.16em">KLAVIERHAUS</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(language === "hu" ? "A PDF-jegyet mellékletben küldjük." : "Your PDF ticket is attached.")}</p></div>`
  };
}

function buildConversationReplyEmail({ name, message, conversationUrl, language = "en" }) {
  const lead = language === "hu" ? `A Klavierhaus csapata válaszolt a megkeresésére, ${name || "Ügyfelünk"}.` : `The Klavierhaus team replied to your enquiry, ${name || "our guest"}.`;
  return {
    subject: language === "hu" ? "Új Klavierhaus válasz" : "New Klavierhaus reply",
    text: `${lead}\n\n${message}\n\n${conversationUrl}`,
    html: `<div style="font-family:Arial,sans-serif;background:#080807;color:#f7f3e8;padding:32px"><p style="color:#c9a45d;letter-spacing:.16em">KLAVIERHAUS</p><p>${escapeHtml(lead)}</p><blockquote style="border-left:2px solid #c9a45d;padding-left:14px">${escapeHtml(message)}</blockquote><p><a href="${escapeHtml(conversationUrl)}" style="color:#d7b66b">${escapeHtml(language === "hu" ? "Beszélgetés megnyitása" : "Open conversation")}</a></p></div>`
  };
}

function safeProviderCode(error) {
  const candidate = String(error?.name || error?.code || "EMAIL_DELIVERY_FAILED").toUpperCase();
  return /^[A-Z0-9_-]{2,80}$/.test(candidate) ? candidate : "EMAIL_DELIVERY_FAILED";
}

function createTransactionalEmail(env = process.env) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.EMAIL_FROM || DEFAULT_FROM).trim();
  const eventFrom = String(env.EVENT_EMAIL_FROM || DEFAULT_EVENT_FROM).trim();
  const replyTo = String(env.EMAIL_REPLY_TO || "").trim();
  const appBaseUrl = String(env.APP_BASE_URL || "").trim();
  const webhookSecret = String(env.RESEND_WEBHOOK_SECRET || "").trim();
  const resend = new Resend(apiKey || "re_webhook_verification_only");

  return {
    provider: "RESEND",
    configured: Boolean(apiKey && from),
    webhookConfigured: Boolean(webhookSecret),
    async sendAccountActivation({ to, name, code, idempotencyKey }) {
      if (!apiKey || !from) {
        const error = new Error("EMAIL_DELIVERY_NOT_CONFIGURED");
        error.code = "EMAIL_DELIVERY_NOT_CONFIGURED";
        throw error;
      }
      const content = buildActivationEmail({ name, code, appBaseUrl });
      const { data, error } = await resend.emails.send({
        from,
        to: [String(to || "").trim().toLowerCase()],
        subject: content.subject,
        html: content.html,
        text: content.text,
        ...(replyTo ? { replyTo } : {}),
        tags: [{ name: "category", value: "account_activation" }]
      }, { idempotencyKey });
      if (error || !data?.id) {
        const deliveryError = new Error("EMAIL_DELIVERY_FAILED");
        deliveryError.code = safeProviderCode(error);
        throw deliveryError;
      }
      return { providerMessageId: String(data.id) };
    },
    async sendEventInvitation({ to, name, event, invitationUrl, idempotencyKey }) {
      if (!apiKey || !eventFrom) {
        const error = new Error("EMAIL_DELIVERY_NOT_CONFIGURED");
        error.code = "EMAIL_DELIVERY_NOT_CONFIGURED";
        throw error;
      }
      const content = buildEventInvitationEmail({ name, event, invitationUrl });
      const { data, error } = await resend.emails.send({
        from: eventFrom,
        to: [String(to || "").trim().toLowerCase()],
        subject: content.subject,
        html: content.html,
        text: content.text,
        ...(replyTo ? { replyTo } : {}),
        tags: [{ name: "category", value: "event_invitation" }]
      }, { idempotencyKey });
      if (error || !data?.id) {
        const deliveryError = new Error("EMAIL_DELIVERY_FAILED");
        deliveryError.code = safeProviderCode(error);
        throw deliveryError;
      }
      return { providerMessageId: String(data.id) };
    },
    async sendEventInterestConfirmation({ to, event, language, websiteBaseUrl, idempotencyKey }) {
      if (!apiKey || !eventFrom) {
        const error = new Error("EMAIL_DELIVERY_NOT_CONFIGURED");
        error.code = "EMAIL_DELIVERY_NOT_CONFIGURED";
        throw error;
      }
      const content = buildEventInterestEmail({ event, language, websiteBaseUrl });
      const { data, error } = await resend.emails.send({
        from: eventFrom,
        to: [String(to || "").trim().toLowerCase()],
        subject: content.subject,
        html: content.html,
        text: content.text,
        ...(replyTo ? { replyTo } : {}),
        tags: [{ name: "category", value: "event_interest" }]
      }, { idempotencyKey });
      if (error || !data?.id) {
        const deliveryError = new Error("EMAIL_DELIVERY_FAILED");
        deliveryError.code = safeProviderCode(error);
        throw deliveryError;
      }
      return { providerMessageId: String(data.id) };
    },
    async sendEventReturnAnnouncement({ to, event, language, websiteBaseUrl, idempotencyKey }) {
      if (!apiKey || !eventFrom) throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"), { code: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      const content = buildEventReturnAnnouncement({ event, language, websiteBaseUrl });
      const { data, error } = await resend.emails.send({ from: eventFrom, to: [String(to || "").trim().toLowerCase()], subject: content.subject, html: content.html, text: content.text, ...(replyTo ? { replyTo } : {}), tags: [{ name: "category", value: "event_return" }] }, { idempotencyKey });
      if (error || !data?.id) throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"), { code: safeProviderCode(error) });
      return { providerMessageId: String(data.id) };
    },
    async sendEventPurchaseConfirmation({ to, purchaserName, event, payment, invoiceNumber, company, ticketPdf, invoicePdf, websiteBaseUrl, idempotencyKey }) {
      if (!apiKey || !eventFrom) throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"), { code: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      const content = buildEventPurchaseEmail({ purchaserName, event, payment, invoiceNumber, company, websiteBaseUrl });
      const { data, error } = await resend.emails.send({ from: eventFrom, to: [normalizeRecipient(to)], subject: content.subject, html: content.html, text: content.text, ...(replyTo ? { replyTo } : {}), attachments: [{ filename: "klavierhaus-tickets.pdf", content: ticketPdf }, { filename: `klavierhaus-invoice-${invoiceNumber}.pdf`, content: invoicePdf }], tags: [{ name: "category", value: "event_purchase" }] }, { idempotencyKey });
      if (error || !data?.id) throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"), { code: safeProviderCode(error) });
      return { providerMessageId: String(data.id) };
    },
    async sendEventTicketDocuments({ to, event, tickets, ticketPdf, language, idempotencyKey }) {
      if (!apiKey || !eventFrom) throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"), { code: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      const content = buildTicketDocumentsEmail({ name: tickets?.[0]?.buyer_name || tickets?.[0]?.attendee_name, event, language });
      const { data, error } = await resend.emails.send({ from: eventFrom, to: [normalizeRecipient(to)], subject: content.subject, html: content.html, text: content.text, ...(replyTo ? { replyTo } : {}), attachments: [{ filename: "klavierhaus-tickets.pdf", content: ticketPdf }], tags: [{ name: "category", value: "event_ticket" }] }, { idempotencyKey });
      if (error || !data?.id) throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"), { code: safeProviderCode(error) });
      return { providerMessageId: String(data.id) };
    },
    async sendCustomerConversationReply({ to, name, message, conversationUrl, language, idempotencyKey }) {
      if (!apiKey || !from) throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"), { code: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      const content = buildConversationReplyEmail({ name, message, conversationUrl, language });
      const { data, error } = await resend.emails.send({ from, to: [normalizeRecipient(to)], subject: content.subject, html: content.html, text: content.text, ...(replyTo ? { replyTo } : {}), tags: [{ name: "category", value: "customer_conversation" }] }, { idempotencyKey });
      if (error || !data?.id) throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"), { code: safeProviderCode(error) });
      return { providerMessageId: String(data.id) };
    },
    verifyWebhook({ payload, id, timestamp, signature }) {
      if (!webhookSecret) {
        const error = new Error("EMAIL_WEBHOOK_NOT_CONFIGURED");
        error.code = "EMAIL_WEBHOOK_NOT_CONFIGURED";
        throw error;
      }
      return resend.webhooks.verify({
        payload: String(payload || ""),
        headers: { id: String(id || ""), timestamp: String(timestamp || ""), signature: String(signature || "") },
        webhookSecret
      });
    }
  };
}

function normalizeRecipient(value) { return String(value || "").trim().toLowerCase(); }

module.exports = { buildActivationEmail, buildEventInvitationEmail, buildEventInterestEmail, buildEventReturnAnnouncement, buildEventPurchaseEmail, buildTicketDocumentsEmail, buildConversationReplyEmail, createTransactionalEmail };
