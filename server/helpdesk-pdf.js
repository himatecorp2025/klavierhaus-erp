"use strict";

const path = require("node:path");
const { LETTER, createPdf, safeText, textCommand } = require("./document-pdf");

const GOLD = "0.788 0.663 0.369";
const CREAM = "0.969 0.953 0.894";
const MUTED = "0.68 0.64 0.55";
const DARK = "0.02 0.02 0.02";

function wrap(value, max = 105) {
  const source = safeText(value);
  if (!source) return [""];
  const words = source.split(/\s+/);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= max) current += ` ${word}`;
    else { lines.push(current); current = word; }
  });
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function formatNewYorkTimestamp(value) {
  const source = String(value || "").trim();
  if (!source) return "-";
  const normalized = source.includes("T") ? source : source.replace(" ", "T");
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) return source.replace(/[·→—–]/g, "-");
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date);
}

function reportLabels({ conversation, messages, attachments, auditEvents, generatedAt, language }) {
  const hu = language === "hu";
  const labels = [
    "KLAVIERHAUS", "CUSTOMER HELPDESK REPORT", "ÜGYFÉL-HELPDESK RIPORT", "Conversation", "Beszélgetés", "Customer", "Ügyfél", "Email", "E-mail", "Category", "Kategória", "Status", "Státusz", "Assigned", "Hozzárendelve", "Created", "Létrehozva", "Last activity", "Utolsó aktivitás", "Closure note", "Lezárási megjegyzés", "Reopen reason", "Újranyitási indok", "Conversation messages", "Beszélgetési üzenetek", "Attachments", "Csatolmányok", "Generated", "Generálva", "Guest", "Vendég", "Klavierhaus Support", "System"
  ];
  labels.push(conversation.name || "Guest", conversation.email || "", conversation.category || "", conversation.status || "", conversation.assigned_user_name || "Unassigned", conversation.created_at || "", conversation.last_activity_at || conversation.last_message_at || "", conversation.closure_note || "", conversation.reopen_reason || "");
  messages.forEach((message) => labels.push(message.sender_name, message.body, message.created_at));
  attachments.forEach((attachment) => labels.push(attachment.original_name, attachment.mime_type));
  auditEvents.forEach((event) => labels.push(event.event_type, event.actor_name, event.actor_role, event.from_status, event.to_status, event.details, event.created_at));
  labels.push(generatedAt);
  return labels.concat(hu ? ["ÜGYFÉL-HELPDESK RIPORT", "Beszélgetési üzenetek", "Csatolmányok"] : []);
}

function generateCustomerConversationReportPdf({ conversation = {}, messages = [], attachments = [], auditEvents = [], language = "en", fontPath } = {}) {
  const hu = language === "hu";
  const generatedAt = formatNewYorkTimestamp(new Date().toISOString());
  const displayConversation = { ...conversation, created_at: formatNewYorkTimestamp(conversation.created_at), last_activity_at: formatNewYorkTimestamp(conversation.last_activity_at || conversation.last_message_at) };
  const messageLines = messages.flatMap((message) => wrap(`${message.sender_name || "Klavierhaus"} - ${formatNewYorkTimestamp(message.created_at)}: ${message.body || ""}`, 106));
  const attachmentLines = attachments.flatMap((attachment) => wrap(`${attachment.original_name} - ${attachment.mime_type} - ${attachment.file_size} bytes`, 106));
  const auditLines = auditEvents.flatMap((event) => wrap(`${event.event_type} - ${formatNewYorkTimestamp(event.created_at)} - ${event.actor_name || event.actor_role || "System"}${event.from_status || event.to_status ? ` - ${event.from_status || "-"} -> ${event.to_status || "-"}` : ""}${event.details ? ` - ${typeof event.details === "string" ? event.details : JSON.stringify(event.details)}` : ""}`, 106));
  const bodyLines = [
    ...(messageLines.length ? messageLines : [hu ? "Nincs üzenet." : "No messages."]),
    ...(attachmentLines.length ? [hu ? "CSATOLMÁNYOK" : "ATTACHMENTS", ...attachmentLines] : []),
    ...(auditLines.length ? [hu ? "AUDITNAPLÓ" : "AUDIT LOG", ...auditLines] : [])
  ];
  const firstPageCapacity = 20;
  const followingPageCapacity = 37;
  const pages = Math.max(1, bodyLines.length <= firstPageCapacity ? 1 : 1 + Math.ceil((bodyLines.length - firstPageCapacity) / followingPageCapacity));
  const labels = reportLabels({ conversation: displayConversation, messages, attachments, auditEvents, generatedAt, language });
  labels.push(conversation.id || "", bodyLines.join("\n"), generatedAt);
  return createPdf({
    pages: Array.from({ length: pages }, (_unused, pageIndex) => (metrics) => {
      const commands = [
        `${DARK} rg 0 0 ${LETTER.width} ${LETTER.height} re f\n`,
        `${GOLD} RG 2 w 28 28 ${LETTER.width - 56} ${LETTER.height - 56} re S\n`,
        textCommand("KLAVIERHAUS", 54, 742, 18, GOLD, { tracking: 1.8 }),
        textCommand(hu ? "ÜGYFÉL-HELPDESK RIPORT" : "CUSTOMER HELPDESK REPORT", 54, 710, 16, CREAM),
        textCommand(`${hu ? "Beszélgetés" : "Conversation"}: ${conversation.id || ""}`, 54, 682, 9, MUTED),
        textCommand(`${hu ? "Generálva" : "Generated"}: ${generatedAt}`, 330, 682, 8, MUTED)
      ];
      if (pageIndex === 0) {
        const fields = [
          [hu ? "Ügyfél" : "Customer", conversation.name || (hu ? "Vendég" : "Guest")],
          [hu ? "E-mail" : "Email", conversation.email || "-"],
          [hu ? "Kategória" : "Category", conversation.category || "-"],
          [hu ? "Státusz" : "Status", conversation.status || "-"],
          [hu ? "Hozzárendelve" : "Assigned", conversation.assigned_user_name || (hu ? "Nincs hozzárendelve" : "Unassigned")],
          [hu ? "Létrehozva" : "Created", displayConversation.created_at],
          [hu ? "Utolsó aktivitás" : "Last activity", displayConversation.last_activity_at]
        ];
        let fieldY = 642;
        fields.forEach(([label, value]) => {
          commands.push(textCommand(label.toUpperCase(), 54, fieldY, 7.5, GOLD, { tracking: 0.5 }));
          commands.push(textCommand(wrap(value, 48)[0], 178, fieldY, 9, CREAM));
          fieldY -= 22;
        });
        if (conversation.closure_note) { commands.push(textCommand(hu ? "LEZÁRÁSI MEGJEGYZÉS" : "CLOSURE NOTE", 54, fieldY - 4, 7.5, GOLD)); commands.push(textCommand(wrap(conversation.closure_note, 92)[0], 54, fieldY - 20, 8.5, CREAM)); fieldY -= 44; }
        if (conversation.reopen_reason) { commands.push(textCommand(hu ? "ÚJRANYITÁSI INDOK" : "REOPEN REASON", 54, fieldY - 4, 7.5, GOLD)); commands.push(textCommand(wrap(conversation.reopen_reason, 92)[0], 54, fieldY - 20, 8.5, CREAM)); }
        commands.push(`${GOLD} RG .8 w 54 462 504 0 re S\n`);
        commands.push(textCommand(hu ? "BESZÉLGETÉSI ÜZENETEK" : "CONVERSATION MESSAGES", 54, 442, 8, GOLD, { tracking: 0.8 }));
      }
      const start = pageIndex === 0 ? 0 : firstPageCapacity + followingPageCapacity * (pageIndex - 1);
      const pageContent = bodyLines.slice(start, start + (pageIndex === 0 ? firstPageCapacity : followingPageCapacity));
      let y = pageIndex === 0 ? 418 : 700;
      pageContent.forEach((line) => { commands.push(textCommand(line, 54, y, 8.3, CREAM)); y -= 17; });
      commands.push(textCommand(`KLAVIERHAUS - ${pageIndex + 1}/${pages}`, 54, 42, 8, GOLD, { tracking: 0.6 }));
      return commands.join("");
    }),
    size: LETTER,
    labels,
    title: `Klavierhaus Customer Helpdesk Report ${conversation.id || ""}`,
    fontPath: fontPath || path.join(__dirname, "assets", "DejaVuSans.ttf")
  });
}

module.exports = { generateCustomerConversationReportPdf };
