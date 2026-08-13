"use strict";

const crypto = require("node:crypto");
const Stripe = require("stripe");

const HOLD_MINUTES = 15;
const HOLD_MS = HOLD_MINUTES * 60 * 1000;
const TEST_SECRET_PREFIXES = ["sk_test_", "rk_test_"];
const LIVE_SECRET_PREFIXES = ["sk_live_", "rk_live_"];

function cleanText(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function isSuperadmin(user) {
  return Boolean(user && (user.role === "SUPERADMIN" || Number(user.is_superadmin || 0) === 1));
}

function normalizeBaseUrl(value, fallback) {
  try {
    const url = new URL(String(value || fallback));
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch (_error) {
    return fallback;
  }
}

function createStripeSandbox(options = {}) {
  const db = options.db;
  const env = options.env || process.env;
  const secretKey = cleanText(options.secretKey ?? env.STRIPE_SECRET_KEY, 500);
  const webhookSecret = cleanText(options.webhookSecret ?? env.STRIPE_WEBHOOK_SECRET, 500);
  const websiteBaseUrl = normalizeBaseUrl(options.websiteBaseUrl ?? env.WEBSITE_BASE_URL, "https://klavierhaus-home.onrender.com");

  if (LIVE_SECRET_PREFIXES.some((prefix) => secretKey.startsWith(prefix))) {
    throw new Error("Live Stripe keys are not accepted while Stripe Sandbox mode is enforced");
  }
  if (secretKey && !TEST_SECRET_PREFIXES.some((prefix) => secretKey.startsWith(prefix))) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe test secret key beginning with sk_test_ or rk_test_");
  }
  if (webhookSecret && !webhookSecret.startsWith("whsec_")) {
    throw new Error("STRIPE_WEBHOOK_SECRET must begin with whsec_");
  }

  const stripe = options.stripeClient || (secretKey ? new Stripe(secretKey, { maxNetworkRetries: 2 }) : null);
  const enabled = Boolean(stripe && secretKey && webhookSecret);

  function requireConfigured() {
    if (!enabled) {
      const error = new Error("STRIPE_SANDBOX_NOT_CONFIGURED");
      error.status = 503;
      throw error;
    }
  }

  function activeHoldCount(eventId, now = new Date()) {
    const row = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS count FROM event_checkout_holds
      WHERE event_id=? AND status='PENDING' AND expires_at>?`).get(eventId, now.toISOString());
    return Number(row?.count || 0);
  }

  function expireStaleHolds(now = new Date()) {
    const stale = db.prepare(`SELECT id,stripe_checkout_session_id FROM event_checkout_holds
      WHERE status='PENDING' AND expires_at<=?`).all(now.toISOString());
    if (!stale.length) return [];
    const expire = db.prepare("UPDATE event_checkout_holds SET status='EXPIRED',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'");
    db.transaction(() => stale.forEach((hold) => expire.run(hold.id)))();
    if (stripe) {
      for (const hold of stale) {
        if (!hold.stripe_checkout_session_id) continue;
        stripe.checkout.sessions.expire(hold.stripe_checkout_session_id).catch((error) => {
          if (error?.code !== "resource_missing" && error?.code !== "checkout_session_not_open") {
            console.warn(`[stripe-sandbox] Checkout expiry failed for ${hold.id}: ${error.message}`);
          }
        });
      }
    }
    return stale.map((hold) => hold.id);
  }

  async function expireEventSessions(eventId) {
    const rows = db.prepare(`SELECT id,stripe_checkout_session_id FROM event_checkout_holds
      WHERE event_id=? AND status='PENDING'`).all(eventId);
    db.prepare("UPDATE event_checkout_holds SET status='CANCELLED',updated_at=CURRENT_TIMESTAMP WHERE event_id=? AND status='PENDING'").run(eventId);
    if (stripe) {
      await Promise.allSettled(rows.filter((row) => row.stripe_checkout_session_id).map((row) =>
        stripe.checkout.sessions.expire(row.stripe_checkout_session_id)
      ));
    }
    return rows.length;
  }

  function eventTicketCount(eventId) {
    const row = db.prepare("SELECT COUNT(*) AS count FROM event_tickets WHERE event_id=? AND status IN ('VALID','USED')").get(eventId);
    return Number(row?.count || 0);
  }

  function availableCapacity(event, now = new Date()) {
    return Math.max(0, Number(event.capacity_total || 0) - eventTicketCount(event.id) - activeHoldCount(event.id, now));
  }

  async function createCheckout({ event, language = "en", quantity = 1 }) {
    requireConfigured();
    expireStaleHolds();
    const count = Number(quantity);
    if (!Number.isInteger(count) || count < 1 || count > Number(event.capacity_total || 0)) {
      const error = new Error("INVALID_TICKET_QUANTITY");
      error.status = 400;
      throw error;
    }
    if (event.access_type !== "PUBLIC_PAID" || !["PUBLISHED", "RESCHEDULED"].includes(event.status) || Number(event.price_cents || 0) <= 0) {
      const error = new Error("EVENT_NOT_AVAILABLE_FOR_CHECKOUT");
      error.status = 409;
      throw error;
    }

    const holdId = newId("EVHOLD");
    const expiresAt = new Date(Date.now() + HOLD_MS).toISOString();
    db.transaction(() => {
      const current = db.prepare("SELECT * FROM events WHERE id=?").get(event.id);
      if (!current || availableCapacity(current) < count) {
        const error = new Error("EVENT_SOLD_OUT");
        error.status = 409;
        throw error;
      }
      db.prepare(`INSERT INTO event_checkout_holds(id,event_id,quantity,status,expires_at,language,currency,amount_total,test_mode)
        VALUES(?,?,?,'PENDING',?,?,?, ?,1)`).run(
        holdId,
        event.id,
        count,
        expiresAt,
        language === "hu" ? "hu" : "en",
        String(event.currency || "USD").toUpperCase(),
        Number(event.price_cents) * count
      );
    })();

    const slug = language === "hu" ? event.slug_hu : event.slug_en;
    const eventPath = language === "hu" ? `/hu/esemenyek/${encodeURIComponent(slug)}` : `/events/${encodeURIComponent(slug)}`;
    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{
          quantity: count,
          price_data: {
            currency: String(event.currency || "USD").toLowerCase(),
            unit_amount: Number(event.price_cents),
            product_data: {
              name: language === "hu" ? event.title_hu : event.title_en,
              description: "Klavierhaus event admission · TEST MODE"
            }
          }
        }],
        client_reference_id: holdId,
        metadata: { hold_id: holdId, event_id: event.id, test_mode: "true" },
        payment_intent_data: { metadata: { hold_id: holdId, event_id: event.id, test_mode: "true" } },
        name_collection: { individual: { enabled: true, optional: false } },
        locale: language === "hu" ? "hu" : "en",
        submit_type: "book",
        success_url: `${websiteBaseUrl}${eventPath}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${websiteBaseUrl}${eventPath}?checkout=cancelled`
      }, { idempotencyKey: `kh-checkout-${holdId}` });
      if (session.livemode) throw new Error("LIVE_STRIPE_SESSION_REJECTED");
      db.prepare(`UPDATE event_checkout_holds SET stripe_checkout_session_id=?,stripe_payment_intent_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(session.id, typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null, holdId);
      return { checkout_url: session.url, checkout_session_id: session.id, hold_expires_at: expiresAt, test_mode: true };
    } catch (error) {
      db.prepare("UPDATE event_checkout_holds SET status='FAILED',failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(cleanText(error?.code || error?.message || "STRIPE_CHECKOUT_FAILED", 160), holdId);
      throw error;
    }
  }

  function customerFromSession(session) {
    return {
      name: cleanText(session.customer_details?.name || session.customer_details?.individual_name || "Guest", 200),
      email: normalizeEmail(session.customer_details?.email || session.customer_email || "")
    };
  }

  async function refundLatePayment(session, hold, reason) {
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntent) throw new Error("STRIPE_PAYMENT_INTENT_MISSING");
    const refund = await stripe.refunds.create({ payment_intent: paymentIntent, reason: "requested_by_customer", metadata: { hold_id: hold.id, reason } }, { idempotencyKey: `kh-capacity-refund-${session.id}` });
    db.prepare(`UPDATE event_checkout_holds SET status='REFUNDED',stripe_payment_intent_id=?,failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(paymentIntent, reason, hold.id);
    return refund;
  }

  async function fulfillCheckoutSession(session) {
    if (session.livemode) throw new Error("LIVE_STRIPE_EVENT_REJECTED");
    const holdId = cleanText(session.metadata?.hold_id || session.client_reference_id, 200);
    const hold = db.prepare("SELECT * FROM event_checkout_holds WHERE id=?").get(holdId);
    if (!hold) throw new Error("CHECKOUT_HOLD_NOT_FOUND");
    if (hold.status === "PAID") return { duplicate: true, hold_id: hold.id };
    if (session.payment_status !== "paid") return { pending: true, hold_id: hold.id };
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(hold.event_id);
    if (!event || ["CANCELLED", "CLOSED"].includes(event.status)) {
      await refundLatePayment(session, hold, "EVENT_NOT_AVAILABLE");
      return { refunded: true, hold_id: hold.id };
    }

    const expired = new Date(hold.expires_at).getTime() <= Date.now();
    const ticketCountWithoutThisHold = Number(db.prepare("SELECT COUNT(*) AS count FROM event_tickets WHERE event_id=? AND status IN ('VALID','USED')").get(event.id)?.count || 0);
    if (expired && Number(event.capacity_total) - ticketCountWithoutThisHold < Number(hold.quantity)) {
      await refundLatePayment(session, hold, "CAPACITY_HOLD_EXPIRED");
      return { refunded: true, hold_id: hold.id };
    }

    const customer = customerFromSession(session);
    if (!validEmail(customer.email)) throw new Error("CHECKOUT_CUSTOMER_EMAIL_MISSING");
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "";
    const paymentId = newId("EVPAY");
    const amountTotal = Number(session.amount_total ?? hold.amount_total);
    const createdTickets = [];
    db.transaction(() => {
      const existingPayment = db.prepare("SELECT * FROM event_payments WHERE stripe_checkout_session_id=?").get(session.id);
      if (existingPayment) return;
      db.prepare(`INSERT INTO event_payments(id,event_id,hold_id,status,purchaser_name,purchaser_email,quantity,amount_total,currency,stripe_checkout_session_id,stripe_payment_intent_id,test_mode,paid_at)
        VALUES(?,?,?,'PAID',?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(
        paymentId,
        event.id,
        hold.id,
        customer.name,
        customer.email,
        Number(hold.quantity),
        amountTotal,
        String(session.currency || hold.currency || "usd").toUpperCase(),
        session.id,
        paymentIntent,
        1
      );
      for (let sequence = 1; sequence <= Number(hold.quantity); sequence += 1) {
        const ticketId = newId("EVTKT");
        const publicCode = crypto.randomBytes(18).toString("base64url");
        const attendeeName = Number(hold.quantity) === 1 ? customer.name : `${customer.name} · ${sequence}/${hold.quantity}`;
        db.prepare(`INSERT INTO event_tickets(id,event_id,source_type,buyer_name,attendee_name,contact_email,public_code,status,price_cents,currency,event_payment_id,ticket_sequence)
          VALUES(?,?,'PURCHASE',?,?,?,?, 'VALID',?,'USD',?,?)`).run(
          ticketId,
          event.id,
          customer.name,
          attendeeName,
          customer.email,
          publicCode,
          Number(event.price_cents),
          paymentId,
          sequence
        );
        createdTickets.push(ticketId);
      }
      db.prepare(`UPDATE event_checkout_holds SET status='PAID',stripe_payment_intent_id=?,purchaser_name=?,purchaser_email=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(paymentIntent, customer.name, customer.email, hold.id);
    })();
    return { paid: true, hold_id: hold.id, payment_id: paymentId, ticket_ids: createdTickets };
  }

  async function processWebhookEvent(event) {
    if (event.livemode) throw new Error("LIVE_STRIPE_EVENT_REJECTED");
    const existing = db.prepare("SELECT status FROM stripe_webhook_events WHERE id=?").get(event.id);
    if (existing?.status === "PROCESSED") return { duplicate: true };
    db.prepare(`INSERT INTO stripe_webhook_events(id,event_type,status,test_mode,received_at)
      VALUES(?,?,'PROCESSING',1,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET status='PROCESSING',failure_code=NULL,updated_at=CURRENT_TIMESTAMP`).run(event.id, event.type);
    try {
      let result = { ignored: true };
      if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
        result = await fulfillCheckoutSession(event.data.object);
      } else if (["checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) {
        const session = event.data.object;
        db.prepare("UPDATE event_checkout_holds SET status='EXPIRED',updated_at=CURRENT_TIMESTAMP WHERE stripe_checkout_session_id=? AND status='PENDING'").run(session.id);
        result = { released: true };
      } else if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
        const refund = event.data.object;
        const status = refund.status === "succeeded" ? "REFUNDED" : refund.status === "failed" ? "REFUND_FAILED" : "REFUND_PENDING";
        db.prepare("UPDATE event_payments SET status=?,stripe_refund_id=COALESCE(stripe_refund_id,?),updated_at=CURRENT_TIMESTAMP WHERE stripe_payment_intent_id=?")
          .run(status, refund.id, typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id || "");
        result = { refund_status: status };
      }
      db.prepare("UPDATE stripe_webhook_events SET status='PROCESSED',processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(event.id);
      return result;
    } catch (error) {
      db.prepare("UPDATE stripe_webhook_events SET status='FAILED',failure_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(cleanText(error?.code || error?.message || "STRIPE_WEBHOOK_FAILED", 160), event.id);
      throw error;
    }
  }

  async function handleWebhook(req, res) {
    if (!enabled) return res.status(503).json({ error: "STRIPE_SANDBOX_NOT_CONFIGURED" });
    try {
      const signature = req.headers["stripe-signature"];
      const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
      const result = await processWebhookEvent(event);
      res.json({ received: true, test_mode: true, ...result });
    } catch (error) {
      console.warn(`[stripe-sandbox] Webhook rejected: ${error.message}`);
      res.status(400).json({ error: "INVALID_STRIPE_WEBHOOK" });
    }
  }

  async function refundPaymentForTicket(ticketId, reason = "requested_by_customer") {
    requireConfigured();
    const ticket = db.prepare(`SELECT t.*,p.id AS payment_id,p.status AS payment_status,p.stripe_payment_intent_id
      FROM event_tickets t LEFT JOIN event_payments p ON p.id=t.event_payment_id WHERE t.id=?`).get(ticketId);
    if (!ticket) throw Object.assign(new Error("TICKET_NOT_FOUND"), { status: 404 });
    if (ticket.source_type !== "PURCHASE" || !ticket.payment_id || !ticket.stripe_payment_intent_id) {
      throw Object.assign(new Error("STRIPE_PAYMENT_NOT_FOUND"), { status: 409 });
    }
    if (ticket.payment_status === "REFUNDED") return db.prepare("SELECT * FROM event_payments WHERE id=?").get(ticket.payment_id);
    const refund = await stripe.refunds.create({
      payment_intent: ticket.stripe_payment_intent_id,
      reason: "requested_by_customer",
      metadata: { payment_id: ticket.payment_id, administrative_reason: cleanText(reason, 400) }
    }, { idempotencyKey: `kh-full-refund-${ticket.payment_id}` });
    db.transaction(() => {
      db.prepare("UPDATE event_payments SET status=?,stripe_refund_id=?,refunded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(refund.status === "succeeded" ? "REFUNDED" : "REFUND_PENDING", refund.id, ticket.payment_id);
      db.prepare("UPDATE event_tickets SET status='REFUNDED',updated_at=CURRENT_TIMESTAMP WHERE event_payment_id=? AND status IN ('VALID','USED')")
        .run(ticket.payment_id);
      db.prepare("UPDATE event_checkout_holds SET status='REFUNDED',updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT hold_id FROM event_payments WHERE id=?)")
        .run(ticket.payment_id);
    })();
    return db.prepare("SELECT * FROM event_payments WHERE id=?").get(ticket.payment_id);
  }

  function configuration() {
    return { enabled, test_mode: true, hold_minutes: HOLD_MINUTES, live_keys_accepted: false };
  }

  return Object.freeze({
    enabled,
    testMode: true,
    activeHoldCount,
    availableCapacity,
    configuration,
    createCheckout,
    expireStaleHolds,
    expireEventSessions,
    fulfillCheckoutSession,
    handleWebhook,
    processWebhookEvent,
    refundPaymentForTicket
  });
}

module.exports = {
  HOLD_MINUTES,
  HOLD_MS,
  createStripeSandbox,
  normalizeBaseUrl,
  validEmail
};
