"use strict";

const SALUTATIONS = new Set(["MR", "MR.", "MRS", "MRS.", "MS", "MS.", "MISS", "DR", "DR.", "PROF", "PROF."]);
const SUFFIXES = new Set(["JR", "JR.", "SR", "SR.", "II", "III", "IV", "V", "PHD", "PH.D.", "MD", "M.D."]);

function clean(value, max = 200) {
  return String(value ?? "").replace(/[\u0000\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeToken(value) {
  return clean(value, 40).toUpperCase();
}

function limitedParts(value, limit) {
  const parts = clean(value).split(/\s+/).filter(Boolean);
  if (parts.length <= limit) return parts;
  return [...parts.slice(0, Math.max(0, limit - 1)), "…"];
}

function parseGuestName(value, fields = {}) {
  const original = clean(fields.original_name || value, 200) || "Unknown guest";
  let source = clean(fields.name || value, 200);
  let tokens = source ? source.split(/\s+/).filter(Boolean) : [];
  const providedFirstNames = fields.first_names ?? fields.firstNames;
  const providedSurnames = fields.surnames ?? fields.last_names ?? fields.lastNames;
  let salutation = clean(fields.salutation, 30);
  let suffix = clean(fields.suffix, 30);

  if (!salutation && tokens.length && SALUTATIONS.has(normalizeToken(tokens[0]))) salutation = tokens.shift();
  if (!suffix && tokens.length && SUFFIXES.has(normalizeToken(tokens[tokens.length - 1]))) suffix = tokens.pop();

  if (source.includes(",") && !providedFirstNames && !providedSurnames) {
    const commaParts = source.split(",").map((part) => clean(part)).filter(Boolean);
    if (commaParts.length >= 2) {
      tokens = commaParts.slice(1).join(" ").split(/\s+/).filter(Boolean);
      const surnameTokens = commaParts[0].split(/\s+/).filter(Boolean);
      return formatGuestName({ original, salutation, suffix, firstNames: tokens, surnames: surnameTokens });
    }
  }

  const firstNames = providedFirstNames ? clean(providedFirstNames, 120).split(/\s+/).filter(Boolean) : tokens.slice(0, Math.min(2, tokens.length));
  const surnameStart = providedFirstNames ? 0 : Math.min(2, tokens.length);
  const surnames = providedSurnames ? clean(providedSurnames, 120).split(/\s+/).filter(Boolean) : tokens.slice(surnameStart);
  return formatGuestName({ original, salutation, suffix, firstNames, surnames });
}

function formatGuestName({ original, salutation = "", suffix = "", firstNames = [], surnames = [] }) {
  const first = limitedParts(firstNames.join(" "), 2);
  const last = limitedParts(surnames.join(" "), 2);
  const display = [salutation, ...first, ...last, suffix].filter(Boolean).join(" ") || "Unknown guest";
  return {
    original_name: clean(original, 200),
    salutation: clean(salutation, 30),
    first_names: first.join(" "),
    surnames: last.join(" "),
    suffix: clean(suffix, 30),
    display_name: display,
    search_name: [first.join(" "), last.join(" ")].filter(Boolean).join(" ")
  };
}

module.exports = { formatGuestName, parseGuestName };
