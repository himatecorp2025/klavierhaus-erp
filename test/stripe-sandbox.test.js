"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const { createStripeSandbox, HOLD_MINUTES } = require("../server/stripe-sandbox");

const projectRoot = path.join(__dirname, "..");

function createDatabase() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-stripe-sandbox-"));
  const dbPath = path.join(tempRoot, "stripe.sqlite");
  const init = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], {
    cwd: projectRoot,
    env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: path.join(tempRoot, "backups") },
    encoding: "utf8"
  });
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`);
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.prepare(`INSERT INTO events(id,event_key,category_id,access_type,status,slug_en,slug_hu,title_en,title_hu,
    venue_name,venue_street,venue_city,venue_region,venue_postal_code,start_at,end_at,capacity_total,price_cents,currency,published_at)
    VALUES('EV-STRIPE','EV-STRIPE-1','EVC-SALON-CONCERT','PUBLIC_PAID','PUBLISHED','stripe-salon','stripe-szalon',
    'Stripe Salon','Stripe szalon','Klavierhaus','790 11th Avenue','New York','NY','10019',
    '2031-04-10T23:00:00.000Z','2031-04-11T01:00:00.000Z',5,12500,'USD',CURRENT_TIMESTAMP)`).run();
  return { db, tempRoot };
}

function fakeStripe() {
  const calls = { sessions: [], refunds: [], expired: [] };
  return {
    calls,
    checkout: { sessions: {
      create: async (payload) => {
        calls.sessions.push(payload);
        return { id: "cs_test_klavierhaus", url: "https://checkout.stripe.com/c/pay/test", livemode: false, payment_intent: null };
      },
      expire: async (id) => { calls.expired.push(id); return { id, status: "expired" }; }
    } },
    refunds: { create: async (payload) => {
      calls.refunds.push(payload);
      return { id: `re_test_${calls.refunds.length}`, status: "succeeded", payment_intent: payload.payment_intent };
    } },
    webhooks: { constructEvent: (body) => JSON.parse(Buffer.from(body).toString("utf8")) }
  };
}

test("Stripe integration rejects live keys while Sandbox mode is enforced", () => {
  const { db, tempRoot } = createDatabase();
  assert.throws(() => createStripeSandbox({ db, secretKey: "sk_live_forbidden", webhookSecret: "whsec_test" }), /Live Stripe keys are not accepted/);
  assert.throws(() => createStripeSandbox({ db, secretKey: "rk_live_forbidden", webhookSecret: "whsec_test" }), /Live Stripe keys are not accepted/);
  const restrictedTestKey = createStripeSandbox({
    db,
    stripeClient: fakeStripe(),
    secretKey: "rk_test_klavierhaus",
    webhookSecret: "whsec_test"
  });
  assert.equal(restrictedTestKey.configuration().enabled, true);
  assert.equal(restrictedTestKey.configuration().test_mode, true);
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("Stripe Sandbox holds capacity, fulfills exactly once, and refunds the full purchase", async () => {
  const { db, tempRoot } = createDatabase();
  const stripeClient = fakeStripe();
  const sandbox = createStripeSandbox({
    db,
    stripeClient,
    secretKey: "sk_test_klavierhaus",
    webhookSecret: "whsec_klavierhaus",
    websiteBaseUrl: "https://klavierhaus-home.onrender.com"
  });

  assert.deepEqual(sandbox.configuration(), { enabled: true, test_mode: true, hold_minutes: HOLD_MINUTES, live_keys_accepted: false });
  const checkout = await sandbox.createCheckout({ event: db.prepare("SELECT * FROM events WHERE id='EV-STRIPE'").get(), language: "en", quantity: 2, attendeeNames: ["Ada Artist", "Bela Benefactor"] });
  assert.equal(checkout.test_mode, true);
  assert.equal(checkout.checkout_session_id, "cs_test_klavierhaus");
  assert.equal(sandbox.activeHoldCount("EV-STRIPE"), 2);
  assert.equal(sandbox.availableCapacity(db.prepare("SELECT * FROM events WHERE id='EV-STRIPE'").get()), 3);
  assert.equal(stripeClient.calls.sessions[0].line_items[0].quantity, 2);

  const hold = db.prepare("SELECT * FROM event_checkout_holds WHERE event_id='EV-STRIPE'").get();
  const webhook = {
    id: "evt_test_checkout_once",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: {
      id: "cs_test_klavierhaus",
      livemode: false,
      payment_status: "paid",
      payment_intent: "pi_test_klavierhaus",
      amount_total: 25000,
      currency: "usd",
      client_reference_id: hold.id,
      metadata: { hold_id: hold.id, event_id: "EV-STRIPE", test_mode: "true" },
      customer_details: { name: "Test Patron", email: "patron@example.com" }
    } }
  };
  const first = await sandbox.processWebhookEvent(webhook);
  const duplicate = await sandbox.processWebhookEvent(webhook);
  assert.equal(first.paid, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM event_payments").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM event_tickets WHERE source_type='PURCHASE'").get().count, 2);
  assert.deepEqual(db.prepare("SELECT attendee_name FROM event_tickets WHERE source_type='PURCHASE' ORDER BY ticket_sequence").all().map((row) => row.attendee_name), ["Ada Artist", "Bela Benefactor"]);
  assert.equal(sandbox.activeHoldCount("EV-STRIPE"), 0);

  const ticket = db.prepare("SELECT * FROM event_tickets WHERE source_type='PURCHASE' LIMIT 1").get();
  const payment = await sandbox.refundPaymentForTicket(ticket.id, "Approved test refund");
  assert.equal(payment.status, "REFUNDED");
  assert.equal(stripeClient.calls.refunds.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM event_tickets WHERE status='REFUNDED'").get().count, 2, "partial refunds are not allowed; all tickets in the payment must be invalidated");
  const repeated = await sandbox.refundPaymentForTicket(ticket.id, "Repeated request");
  assert.equal(repeated.status, "REFUNDED");
  assert.equal(stripeClient.calls.refunds.length, 1, "a repeated refund must not call Stripe again");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM stripe_webhook_events WHERE id='evt_test_checkout_once' AND status='PROCESSED'").get().count, 1);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);

  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
