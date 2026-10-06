"use strict";
const Stripe=require("stripe");
const TEST_SECRET_PREFIXES=["sk_test_","rk_test_"];
const LIVE_SECRET_PREFIXES=["sk_live_","rk_live_"];
function cleanText(value,max=1000){return String(value??"").trim().slice(0,max);}
function createStripeSandbox(options={}){
  const env=options.env||process.env;
  let secretKey=cleanText(options.secretKey??env.STRIPE_SECRET_KEY,500),webhookSecret=cleanText(options.webhookSecret??env.STRIPE_WEBHOOK_SECRET,500);
  const onCheckoutSessionEvent=typeof options.onCheckoutSessionEvent==="function"?options.onCheckoutSessionEvent:null;
  let integrationEnabled=true,stripe=null,enabled=false;
  function validateKeys(secret,webhook){if(LIVE_SECRET_PREFIXES.some(prefix=>secret.startsWith(prefix)))throw new Error("Live Stripe keys are not accepted while Stripe Sandbox mode is enforced");if(secret&&!TEST_SECRET_PREFIXES.some(prefix=>secret.startsWith(prefix)))throw new Error("STRIPE_SECRET_KEY must be a Stripe test secret key beginning with sk_test_ or rk_test_");if(webhook&&!webhook.startsWith("whsec_"))throw new Error("STRIPE_WEBHOOK_SECRET must begin with whsec_");}
  function apply(){validateKeys(secretKey,webhookSecret);stripe=secretKey?new Stripe(secretKey,{maxNetworkRetries:2}):null;enabled=integrationEnabled&&Boolean(stripe&&secretKey&&webhookSecret);}
  apply();
  function reconfigure({secretKey:nextSecretKey,webhookSecret:nextWebhookSecret,enabled:nextEnabled=true}={}){if(nextSecretKey!==undefined)secretKey=cleanText(nextSecretKey,500);if(nextWebhookSecret!==undefined)webhookSecret=cleanText(nextWebhookSecret,500);integrationEnabled=Boolean(nextEnabled);apply();return configuration();}
  function configuration(){return{enabled,test_mode:true,domain:"workshop_invoice",live_keys_accepted:false};}
  async function processWebhookEvent(event){if(event?.livemode)throw new Error("LIVE_STRIPE_EVENT_REJECTED");const supported=["checkout.session.completed","checkout.session.async_payment_succeeded","checkout.session.expired","checkout.session.async_payment_failed"];if(!supported.includes(event?.type))return{ignored:true};const session=event?.data?.object;if(session?.metadata?.payment_domain!=="workshop_invoice")return{ignored:true};if(!onCheckoutSessionEvent)throw new Error("WORKSHOP_PAYMENT_HANDLER_NOT_CONFIGURED");return await onCheckoutSessionEvent(event.type,session);}
  async function handleWebhook(req,res){if(!enabled)return res.status(503).json({error:"STRIPE_SANDBOX_NOT_CONFIGURED"});try{const signature=req.headers["stripe-signature"],event=stripe.webhooks.constructEvent(req.body,signature,webhookSecret),result=await processWebhookEvent(event);res.json({received:true,test_mode:true,...result});}catch(error){console.warn(`[stripe-sandbox] Webhook rejected: ${error.message}`);res.status(400).json({error:"INVALID_STRIPE_WEBHOOK"});}}
  return{get enabled(){return enabled;},testMode:true,reconfigure,configuration,handleWebhook,processWebhookEvent};
}
module.exports={createStripeSandbox};
