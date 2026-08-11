const { Resend } = require("resend");

const DEFAULT_FROM = "Klavierhaus Accounts <accounts@klavierhaus.com>";

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

function safeProviderCode(error) {
  const candidate = String(error?.name || error?.code || "EMAIL_DELIVERY_FAILED").toUpperCase();
  return /^[A-Z0-9_-]{2,80}$/.test(candidate) ? candidate : "EMAIL_DELIVERY_FAILED";
}

function createTransactionalEmail(env = process.env) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = String(env.EMAIL_FROM || DEFAULT_FROM).trim();
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

module.exports = { buildActivationEmail, createTransactionalEmail };
