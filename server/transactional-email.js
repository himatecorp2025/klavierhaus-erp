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

function buildInvoiceEmail({ purchaserName, event, invoiceNumber, payment }) {
  const name = purchaserName || "Guest";
  const title = event?.title_en || event?.title_hu || "Klavierhaus event";
  const amount = `${String(payment?.currency || "USD").toUpperCase()} ${(Number(payment?.amount_total || 0) / 100).toFixed(2)}`;
  const safeName = escapeHtml(name);
  const safeTitle = escapeHtml(title);
  const safeInvoice = escapeHtml(invoiceNumber || "");
  return {
    subject: `Klavierhaus invoice · ${invoiceNumber || ""}`,
    text: `Hello ${name},\n\nAttached is your Klavierhaus invoice for ${title}.\nInvoice: ${invoiceNumber || ""}\nAmount: ${amount}\n\nKedves ${name}!\nMellékelten küldjük a Klavierhaus számlát: ${invoiceNumber || ""}.`,
    html: `<div style="font-family:Arial,sans-serif;background:#080807;color:#f7f3e8;padding:32px"><p style="color:#c9a45d;letter-spacing:.16em">KLAVIERHAUS</p><h1>${safeTitle}</h1><p>Hello ${safeName}, your invoice is attached.</p><p>Kedves ${safeName}! Mellékelten küldjük a Klavierhaus számlát.</p><p><strong>${safeInvoice}</strong> · ${escapeHtml(amount)}</p></div>`
  };
}

function buildWorkshopInvoiceEmail({ clientName, piano, workSummary, invoiceNumber, totalAmount, paymentUrl = "", language = "en" }) {
  const hu=language==="hu";
  const name=clientName||(hu?"Ügyfelünk":"Valued Client");
  const pianoText=[piano?.brand,piano?.model,piano?.serial_number].filter(Boolean).join(" · ")||(hu?"az Ön zongorája":"your piano");
  const amount=Number(totalAmount||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
  const subject=hu?`Klavierhaus számla · ${invoiceNumber}`:`Klavierhaus invoice · ${invoiceNumber}`;
  const lead=hu
    ? `Tisztelt ${name}! A megbeszélt munkálatokat elvégeztük a következő hangszeren: ${pianoText}.`
    : `Dear ${name}, the agreed service work has been completed on ${pianoText}.`;
  const detail=workSummary?(hu?`Elvégzett munka: ${workSummary}`:`Service completed: ${workSummary}`):"";
  const closing=hu
    ? "Mellékelten küldjük a hivatalos számlát. Köszönjük a bizalmát! — Klavierhaus"
    : "Please find the official invoice attached. Thank you for your trust. — Klavierhaus";
  const paymentLine=paymentUrl?(hu?`Biztonságos online fizetés: ${paymentUrl}`:`Secure online payment: ${paymentUrl}`):"";
  const text=[lead,detail,`Invoice / Számla: ${invoiceNumber}`,`Total / Összesen: ${amount}`,paymentLine,closing].filter(Boolean).join("\n\n");
  const paymentButton=paymentUrl?`<p style="margin:22px 0"><a href="${escapeHtml(paymentUrl)}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">${escapeHtml(hu?"Biztonságos online fizetés":"Pay securely online")}</a></p>`:"";
  const html=`<!doctype html><html><body style="margin:0;background:#f6f3ec;color:#111827;font-family:Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:34px 18px"><div style="background:#fff;border:1px solid #d6c9aa;border-radius:18px;padding:30px"><p style="margin:0 0 12px;color:#8a6b2d;letter-spacing:.16em;text-transform:uppercase">Klavierhaus · New York</p><h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:28px">${escapeHtml(subject)}</h1><p>${escapeHtml(lead)}</p>${detail?`<p><strong>${escapeHtml(detail)}</strong></p>`:""}<p style="padding:14px;border-radius:12px;background:#f7f4ed"><strong>${escapeHtml(invoiceNumber)}</strong><br>${escapeHtml(amount)}</p>${paymentButton}<p>${escapeHtml(closing)}</p></div></div></body></html>`;
  return {subject,text,html};
}

function buildIntakeAssessmentEmail({ clientName, piano, issue, items = [], estimatedTotal = 0, customMessage = "", language = "en" }) {
  const hu=language==="hu";
  const name=clientName||(hu?"Ügyfelünk":"Valued Client");
  const pianoText=[piano?.brand,piano?.model,piano?.serial_number].filter(Boolean).join(" · ")||(hu?"A hangszer adatai a mellékletben találhatók.":"Instrument details are included in the attachment.");
  const amount=Number(estimatedTotal||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
  const selected=(Array.isArray(items)?items:[]).slice(0,8).map(item=>item?.item_title_en||item?.item_title_hu).filter(Boolean);
  const subject=hu?"Klavierhaus · Igényfelmérés és becslés":"Klavierhaus · Service assessment and estimate";
  const intro=hu
    ? `Tisztelt ${name}! Mellékelten küldjük a zongorájához készített igényfelmérést és előzetes becslést.`
    : `Dear ${name}, please find attached the service assessment and preliminary estimate prepared for your piano.`;
  const disclaimer=hu
    ? "Ez a dokumentum igényfelmérés és előzetes becslés, nem számla. A tényleges munka csak külön jóváhagyás után kerül a műhely munkafolyamatába."
    : "This document is a service assessment and preliminary estimate, not an invoice. Work enters the workshop workflow only after separate approval.";
  const text=[intro,customMessage,pianoText,issue?(`${hu?"Jelzett igény":"Requested service"}: ${issue}`):"",selected.length?(`${hu?"Javasolt munkák":"Selected work"}: ${selected.join(", ")}`):"",`${hu?"Becsült összeg":"Estimated total"}: ${amount}`,disclaimer,hu?"Köszönjük bizalmát! — Klavierhaus":"Thank you for your trust. — Klavierhaus"].filter(Boolean).join("\n\n");
  const html=`<!doctype html><html><body style="margin:0;background:#f6f7f9;color:#111827;font-family:Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:34px 18px"><div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:30px"><p style="margin:0 0 12px;color:#4b5563;letter-spacing:.12em;text-transform:uppercase">Klavierhaus · New York</p><h1 style="margin:0 0 18px;font-size:26px">${escapeHtml(subject)}</h1><p>${escapeHtml(intro)}</p>${customMessage?`<p>${escapeHtml(customMessage)}</p>`:""}<p><strong>${escapeHtml(pianoText)}</strong></p>${issue?`<p>${escapeHtml(issue)}</p>`:""}${selected.length?`<ul>${selected.map(item=>`<li>${escapeHtml(item)}</li>`).join("")}</ul>`:""}<p style="padding:14px;border-radius:10px;background:#f3f4f6"><strong>${escapeHtml(hu?"Becsült összeg":"Estimated total")}: ${escapeHtml(amount)}</strong></p><p style="font-size:13px;color:#4b5563">${escapeHtml(disclaimer)}</p></div></div></body></html>`;
  return {subject,text,html};
}

function buildCustomerMilestoneEmail({ eventType, clientName, job = {}, invoice = {}, language = "en" }) {
  const hu=language==="hu",name=clientName||(hu?"Ügyfelünk":"Valued Client");
  const localDate=value=>{
    if(!value)return "";
    const raw=String(value),date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+"T12:00:00Z":raw);
    if(!Number.isFinite(date.getTime()))return raw;
    return new Intl.DateTimeFormat(hu?"hu-HU":"en-US",{timeZone:"America/New_York",dateStyle:"long",...(raw.includes("T")?{timeStyle:"short"}:{})}).format(date);
  };
  const jobRef=[job.job_code,job.title].filter(Boolean).join(" · "),schedule=localDate(job.scheduled_at),due=localDate(invoice.due_date);
  const amount=Number(invoice.total_amount||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
  const copy={
    JOB_CONFIRMED:hu
      ?["Klavierhaus · Munka jóváhagyva","Tisztelt "+name+"! Az igényfelmérés alapján jóváhagyott munka bekerült a Klavierhaus munkafolyamatába.",jobRef]
      :["Klavierhaus · Service approved","Dear "+name+", the service approved from your assessment has been added to the Klavierhaus workshop workflow.",jobRef],
    APPOINTMENT_SCHEDULED:hu
      ?["Klavierhaus · Időpont visszaigazolás","Tisztelt "+name+"! A szolgáltatás időpontját rögzítettük.",schedule]
      :["Klavierhaus · Appointment confirmed","Dear "+name+", your service appointment has been scheduled.",schedule],
    APPOINTMENT_REMINDER:hu
      ?["Klavierhaus · Időpont-emlékeztető","Tisztelt "+name+"! Emlékeztetjük a közelgő Klavierhaus időpontra.",schedule]
      :["Klavierhaus · Appointment reminder","Dear "+name+", this is a reminder about your upcoming Klavierhaus appointment.",schedule],
    WORK_STARTED:hu
      ?["Klavierhaus · A munka megkezdődött","Tisztelt "+name+"! Megkezdtük a jóváhagyott munkát a hangszerén.",jobRef]
      :["Klavierhaus · Service work started","Dear "+name+", we have started the approved service work on your piano.",jobRef],
    WORK_COMPLETED:hu
      ?["Klavierhaus · A munka elkészült","Tisztelt "+name+"! A jóváhagyott munka elkészült. A számlát külön küldjük, amikor azt az adminisztrátor jóváhagyja küldésre.",jobRef]
      :["Klavierhaus · Service work completed","Dear "+name+", the approved service work has been completed. Your invoice will be sent separately when an administrator approves it for delivery.",jobRef],
    INVOICE_DUE_3_DAYS:hu
      ?["Klavierhaus · Számla hamarosan esedékes","Tisztelt "+name+"! Emlékeztetjük, hogy a "+(invoice.invoice_number||"")+" számú számla három nap múlva esedékes.","Határidő: "+due+" · Összeg: "+amount]
      :["Klavierhaus · Invoice due soon","Dear "+name+", this is a reminder that invoice "+(invoice.invoice_number||"")+" is due in three days.","Due: "+due+" · Amount: "+amount],
    INVOICE_DUE_TODAY:hu
      ?["Klavierhaus · Számla ma esedékes","Tisztelt "+name+"! A "+(invoice.invoice_number||"")+" számú számla ma esedékes.","Határidő: "+due+" · Összeg: "+amount]
      :["Klavierhaus · Invoice due today","Dear "+name+", invoice "+(invoice.invoice_number||"")+" is due today.","Due: "+due+" · Amount: "+amount],
    INVOICE_OVERDUE_7_DAYS:hu
      ?["Klavierhaus · Lejárt számla emlékeztető","Tisztelt "+name+"! A "+(invoice.invoice_number||"")+" számú számla hét napja lejárt. Kérjük, ellenőrizze a fizetés állapotát.","Határidő: "+due+" · Összeg: "+amount]
      :["Klavierhaus · Overdue invoice reminder","Dear "+name+", invoice "+(invoice.invoice_number||"")+" is now seven days overdue. Please review the payment status.","Due: "+due+" · Amount: "+amount]
  };
  const selected=copy[eventType]||[hu?"Klavierhaus értesítés":"Klavierhaus update",hu?"Tisztelt "+name+"! Frissítés érkezett a szolgáltatásával kapcsolatban.":"Dear "+name+", there is an update about your Klavierhaus service.",""];
  const [subject,lead,detail]=selected;
  const closing=hu?"Köszönjük bizalmát! — Klavierhaus":"Thank you for your trust. — Klavierhaus";
  const text=[lead,detail,closing].filter(Boolean).join("\n\n");
  const html='<!doctype html><html><body style="margin:0;background:#f6f7f9;color:#111827;font-family:Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:34px 18px"><div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:30px"><p style="margin:0 0 12px;color:#4b5563;letter-spacing:.12em;text-transform:uppercase">Klavierhaus · New York</p><h1 style="margin:0 0 18px;font-size:25px">'+escapeHtml(subject)+'</h1><p>'+escapeHtml(lead)+'</p>'+(detail?'<p style="padding:13px;border-radius:10px;background:#f3f4f6"><strong>'+escapeHtml(detail)+'</strong></p>':'')+'<p style="color:#4b5563">'+escapeHtml(closing)+'</p></div></div></body></html>';
  return {subject,text,html};
}

function buildPaymentReceiptEmail({clientName,invoiceNumber,amount,paymentMethod,paidAt,language="en"}){
  const hu=language==="hu",name=clientName||(hu?"Ügyfelünk":"Valued Client");
  const formatted=Number(amount||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
  const subject=hu?`Klavierhaus · Fizetési bizonylat · ${invoiceNumber}`:`Klavierhaus · Payment receipt · ${invoiceNumber}`;
  const lead=hu?`Tisztelt ${name}! A ${invoiceNumber} számú számla teljes összegű fizetését rögzítettük.`:`Dear ${name}, we have recorded full payment for invoice ${invoiceNumber}.`;
  const detail=hu?`Összeg: ${formatted} · Fizetési mód: ${paymentMethod||"Stripe"} · Dátum: ${paidAt||""}`:`Amount: ${formatted} · Payment method: ${paymentMethod||"Stripe"} · Date: ${paidAt||""}`;
  const closing=hu?"A hivatalos fizetési bizonylatot PDF mellékletként küldjük. Köszönjük! — Klavierhaus":"Your official payment receipt is attached as a PDF. Thank you. — Klavierhaus";
  const text=[lead,detail,closing].join("\n\n");
  const html=`<!doctype html><html><body style="margin:0;background:#f6f7f9;color:#111827;font-family:Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:34px 18px"><div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:30px"><p style="margin:0 0 12px;color:#4b5563;letter-spacing:.12em;text-transform:uppercase">Klavierhaus · New York</p><h1 style="margin:0 0 18px;font-size:25px">${escapeHtml(subject)}</h1><p>${escapeHtml(lead)}</p><p style="padding:13px;border-radius:10px;background:#f3f4f6"><strong>${escapeHtml(detail)}</strong></p><p>${escapeHtml(closing)}</p></div></div></body></html>`;
  return {subject,text,html};
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

function buildConversationAutoReplyEmail({ name, conversationUrl, language = "en" }) {
  const safeName = escapeHtml(name || (language === "hu" ? "Ügyfelünk" : "our guest"));
  const safeUrl = escapeHtml(conversationUrl || "");
  const english = `Thank you for contacting Klavierhaus, ${name || "our guest"}. Our support hours are Monday through Friday, 9:00 AM–5:00 PM New York time. We received your message and will reply as soon as possible.`;
  const hungarian = `Köszönjük, hogy felvette a kapcsolatot a Klavierhaus csapatával, ${name || "Ügyfelünk"}. Ügyfélszolgálatunk New York-i idő szerint hétfőtől péntekig 9:00 és 17:00 között működik. Üzenetét megkaptuk, és amint lehet, válaszolunk.`;
  return {
    subject: language === "hu" ? "Klavierhaus · Megkeresését megkaptuk" : "Klavierhaus · We received your message",
    text: `${english}\n\n${hungarian}\n\n${conversationUrl || ""}`,
    html: `<div style="font-family:Arial,sans-serif;background:#080807;color:#f7f3e8;padding:32px"><p style="color:#c9a45d;letter-spacing:.16em">KLAVIERHAUS</p><p>${escapeHtml(language === "hu" ? hungarian : english)}</p><p><a href="${safeUrl}" style="color:#d7b66b">${escapeHtml(language === "hu" ? "Beszélgetés megnyitása" : "Open conversation")}</a></p></div>`
  };
}

function buildPrivateAppointmentDecisionEmail({name,decision,startsAt,endsAt,durationMin=60,language="en",conversationUrl=""}) {
  const approved=String(decision||"").toUpperCase()==="APPROVED";
  const format=value=>value?new Intl.DateTimeFormat(language==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"";
  const when=format(startsAt),end=endsAt?format(endsAt):"";
  const subject=approved?(language==="hu"?"Klavierhaus · Privát időpont jóváhagyva":"Klavierhaus · Private appointment approved"):(language==="hu"?"Klavierhaus · Privát időpont kérés frissítése":"Klavierhaus · Private appointment request update");
  const message=approved
    ?(language==="hu"?`Kedves ${name||"Ügyfelünk"}! Jóváhagytuk privát időpontját: ${when}${end?` – ${end}`:""} (időtartam: ${durationMin} perc).`:`Hello ${name||"Guest"}, your private appointment has been approved for ${when}${end?` – ${end}`:""} (duration: ${durationMin} minutes).`)
    :(language==="hu"?`Kedves ${name||"Ügyfelünk"}! A kért privát időpontot jelenleg nem tudjuk jóváhagyni. Kérjük, egyeztessen velünk új időpontról.`:`Hello ${name||"Guest"}, we cannot approve the requested private appointment at this time. Please contact us to arrange another time.`);
  const link=conversationUrl?`\n\n${conversationUrl}`:"";
  return {
    subject,
    text:`${message}${link}`,
    html:`<div style="font-family:Arial,sans-serif;background:#080807;color:#f7f3e8;padding:32px"><p style="color:#c9a45d;letter-spacing:.16em">KLAVIERHAUS</p><p>${escapeHtml(message)}</p>${conversationUrl?`<p><a href="${escapeHtml(conversationUrl)}" style="color:#d7b66b">${escapeHtml(language==="hu"?"Beszélgetés megnyitása":"Open conversation")}</a></p>`:""}</div>`
  };
}

function safeProviderCode(error) {
  const candidate = String(error?.name || error?.code || "EMAIL_DELIVERY_FAILED").toUpperCase();
  return /^[A-Z0-9_-]{2,80}$/.test(candidate) ? candidate : "EMAIL_DELIVERY_FAILED";
}

function createTransactionalEmail(env = process.env) {
  let apiKey = String(env.RESEND_API_KEY || "").trim();
  let from = String(env.EMAIL_FROM || DEFAULT_FROM).trim();
  let eventFrom = String(env.EVENT_EMAIL_FROM || DEFAULT_EVENT_FROM).trim();
  let replyTo = String(env.EMAIL_REPLY_TO || "").trim();
  const appBaseUrl = String(env.APP_BASE_URL || "").trim();
  const webhookSecret = String(env.RESEND_WEBHOOK_SECRET || "").trim();
  let resend = new Resend(apiKey || "re_webhook_verification_only");
  let integrationEnabled = true;
  function reconfigure({ apiKey: nextApiKey, from: nextFrom, eventFrom: nextEventFrom, replyTo: nextReplyTo, enabled = true } = {}) {
    if (nextApiKey !== undefined) apiKey = String(nextApiKey || "").trim();
    if (nextFrom !== undefined) from = String(nextFrom || DEFAULT_FROM).trim();
    if (nextEventFrom !== undefined) eventFrom = String(nextEventFrom || DEFAULT_EVENT_FROM).trim();
    if (nextReplyTo !== undefined) replyTo = String(nextReplyTo || "").trim();
    integrationEnabled = Boolean(enabled);
    resend = new Resend(apiKey || "re_webhook_verification_only");
    return { configured: integrationEnabled && Boolean(apiKey && from) };
  }
  function assertEnabled() { if (!integrationEnabled) throw Object.assign(new Error("RESEND_INTEGRATION_DISABLED"), { code: "RESEND_INTEGRATION_DISABLED" }); }

  return {
    provider: "RESEND",
    get configured() { return integrationEnabled && Boolean(apiKey && from); },
    reconfigure,
    webhookConfigured: Boolean(webhookSecret),
    async sendAccountActivation({ to, name, code, idempotencyKey }) {
      assertEnabled();
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
      assertEnabled();
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
      assertEnabled();
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
      assertEnabled();
      if (!apiKey || !eventFrom) throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"), { code: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      const content = buildEventReturnAnnouncement({ event, language, websiteBaseUrl });
      const { data, error } = await resend.emails.send({ from: eventFrom, to: [String(to || "").trim().toLowerCase()], subject: content.subject, html: content.html, text: content.text, ...(replyTo ? { replyTo } : {}), tags: [{ name: "category", value: "event_return" }] }, { idempotencyKey });
      if (error || !data?.id) throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"), { code: safeProviderCode(error) });
      return { providerMessageId: String(data.id) };
    },
    async sendEventPurchaseConfirmation({ to, purchaserName, event, payment, invoiceNumber, company, ticketPdf, invoicePdf, websiteBaseUrl, idempotencyKey }) {
      assertEnabled();
      if (!apiKey || !eventFrom) throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"), { code: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      const content = buildEventPurchaseEmail({ purchaserName, event, payment, invoiceNumber, company, websiteBaseUrl });
      const { data, error } = await resend.emails.send({ from: eventFrom, to: [normalizeRecipient(to)], subject: content.subject, html: content.html, text: content.text, ...(replyTo ? { replyTo } : {}), attachments: [{ filename: "klavierhaus-tickets.pdf", content: ticketPdf }, { filename: `klavierhaus-invoice-${invoiceNumber}.pdf`, content: invoicePdf }], tags: [{ name: "category", value: "event_purchase" }] }, { idempotencyKey });
      if (error || !data?.id) throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"), { code: safeProviderCode(error) });
      return { providerMessageId: String(data.id) };
    },
    async sendEventTicketDocuments({ to, event, tickets, ticketPdf, language, idempotencyKey }) {
      assertEnabled();
      if (!apiKey || !eventFrom) throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"), { code: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      const content = buildTicketDocumentsEmail({ name: tickets?.[0]?.buyer_name || tickets?.[0]?.attendee_name, event, language });
      const { data, error } = await resend.emails.send({ from: eventFrom, to: [normalizeRecipient(to)], subject: content.subject, html: content.html, text: content.text, ...(replyTo ? { replyTo } : {}), attachments: [{ filename: "klavierhaus-tickets.pdf", content: ticketPdf }], tags: [{ name: "category", value: "event_ticket" }] }, { idempotencyKey });
      if (error || !data?.id) throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"), { code: safeProviderCode(error) });
      return { providerMessageId: String(data.id) };
    },
    async sendCustomerConversationReply({ to, name, message, conversationUrl, language, idempotencyKey }) {
      assertEnabled();
      if (!apiKey || !from) throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"), { code: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      const content = buildConversationReplyEmail({ name, message, conversationUrl, language });
      const { data, error } = await resend.emails.send({ from, to: [normalizeRecipient(to)], subject: content.subject, html: content.html, text: content.text, ...(replyTo ? { replyTo } : {}), tags: [{ name: "category", value: "customer_conversation" }] }, { idempotencyKey });
      if (error || !data?.id) throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"), { code: safeProviderCode(error) });
      return { providerMessageId: String(data.id) };
    },
    async sendWorkshopInvoice({ to, clientName, piano, workSummary, invoiceNumber, totalAmount, paymentUrl = "", invoicePdf, language = "en", idempotencyKey }) {
      assertEnabled();
      if (!apiKey || !from) throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"), { code: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      const content=buildWorkshopInvoiceEmail({clientName,piano,workSummary,invoiceNumber,totalAmount,paymentUrl,language});
      const {data,error}=await resend.emails.send({
        from,
        to:[normalizeRecipient(to)],
        subject:content.subject,
        html:content.html,
        text:content.text,
        ...(replyTo?{replyTo}:{}),
        attachments:[{filename:`${invoiceNumber}.pdf`,content:invoicePdf}],
        tags:[{name:"category",value:"workshop_invoice"}]
      },{idempotencyKey});
      if(error||!data?.id)throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"),{code:safeProviderCode(error)});
      return {providerMessageId:String(data.id)};
    },
    async sendIntakeAssessment({ to, clientName, piano, issue, items, estimatedTotal, assessmentPdf, customMessage = "", language = "en", idempotencyKey }) {
      assertEnabled();
      if(!apiKey||!from)throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"),{code:"EMAIL_DELIVERY_NOT_CONFIGURED"});
      const content=buildIntakeAssessmentEmail({clientName,piano,issue,items,estimatedTotal,customMessage,language});
      const {data,error}=await resend.emails.send({
        from,
        to:[normalizeRecipient(to)],
        subject:content.subject,
        html:content.html,
        text:content.text,
        ...(replyTo?{replyTo}:{}),
        ...(assessmentPdf?{attachments:[{filename:"klavierhaus-intake-assessment.pdf",content:assessmentPdf}]}:{}),
        tags:[{name:"category",value:"intake_assessment"}]
      },{idempotencyKey});
      if(error||!data?.id)throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"),{code:safeProviderCode(error)});
      return {providerMessageId:String(data.id)};
    },

    async sendPaymentReceipt({to,clientName,invoiceNumber,amount,paymentMethod,paidAt,receiptPdf,language="en",idempotencyKey}){
      assertEnabled();
      if(!apiKey||!from)throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"),{code:"EMAIL_DELIVERY_NOT_CONFIGURED"});
      const content=buildPaymentReceiptEmail({clientName,invoiceNumber,amount,paymentMethod,paidAt,language});
      const {data,error}=await resend.emails.send({
        from,to:[normalizeRecipient(to)],subject:content.subject,html:content.html,text:content.text,
        ...(replyTo?{replyTo}:{}),
        ...(receiptPdf?{attachments:[{filename:`payment-receipt-${invoiceNumber}.pdf`,content:receiptPdf}]}:{}),
        tags:[{name:"category",value:"payment_receipt"}]
      },{idempotencyKey});
      if(error||!data?.id)throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"),{code:safeProviderCode(error)});
      return {providerMessageId:String(data.id)};
    },
    async sendCustomerMilestone({ to, eventType, clientName, job, invoice, language = "en", idempotencyKey }) {
      assertEnabled();
      if(!apiKey||!from)throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"),{code:"EMAIL_DELIVERY_NOT_CONFIGURED"});
      const content=buildCustomerMilestoneEmail({eventType,clientName,job,invoice,language});
      const {data,error}=await resend.emails.send({
        from,to:[normalizeRecipient(to)],subject:content.subject,html:content.html,text:content.text,
        ...(replyTo?{replyTo}:{}),tags:[{name:"category",value:"customer_milestone"}]
      },{idempotencyKey});
      if(error||!data?.id)throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"),{code:safeProviderCode(error)});
      return {providerMessageId:String(data.id)};
    },
    async sendCustomerConversationAutoReply({ to, name, conversationUrl, language, idempotencyKey }) {
      assertEnabled();
      if (!apiKey || !from) throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"), { code: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      const content = buildConversationAutoReplyEmail({ name, conversationUrl, language });
      const { data, error } = await resend.emails.send({ from, to: [normalizeRecipient(to)], subject: content.subject, html: content.html, text: content.text, ...(replyTo ? { replyTo } : {}), tags: [{ name: "category", value: "customer_conversation_auto_reply" }] }, { idempotencyKey });
      if (error || !data?.id) throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"), { code: safeProviderCode(error) });
      return { providerMessageId: String(data.id) };
    },
    async sendPrivateAppointmentDecision({to,name,decision,startsAt,endsAt,durationMin,language="en",conversationUrl="",idempotencyKey}){
      assertEnabled();
      if(!apiKey||!from)throw Object.assign(new Error("EMAIL_DELIVERY_NOT_CONFIGURED"),{code:"EMAIL_DELIVERY_NOT_CONFIGURED"});
      const content=buildPrivateAppointmentDecisionEmail({name,decision,startsAt,endsAt,durationMin,language,conversationUrl});
      const {data,error}=await resend.emails.send({
        from,to:[normalizeRecipient(to)],subject:content.subject,html:content.html,text:content.text,
        ...(replyTo?{replyTo}:{}),tags:[{name:"category",value:"private_appointment"}]
      },{idempotencyKey});
      if(error||!data?.id)throw Object.assign(new Error("EMAIL_DELIVERY_FAILED"),{code:safeProviderCode(error)});
      return {providerMessageId:String(data.id)};
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

module.exports = { buildActivationEmail, buildEventInvitationEmail, buildEventInterestEmail, buildEventReturnAnnouncement, buildEventPurchaseEmail, buildInvoiceEmail, buildWorkshopInvoiceEmail, buildIntakeAssessmentEmail, buildCustomerMilestoneEmail, buildPaymentReceiptEmail, buildTicketDocumentsEmail, buildConversationReplyEmail, buildConversationAutoReplyEmail, buildPrivateAppointmentDecisionEmail, createTransactionalEmail };
