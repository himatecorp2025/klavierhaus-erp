"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");

const source=fs.readFileSync(path.join(__dirname,"..","server","operations-enhancements.js"),"utf8");

test("database export preserves business signature fields regardless of predicate ordering",()=>{
  const helper=source.match(/function redactCell\(table,column,value\)\{[\s\S]*?\n\}/)?.[0]||"";
  assert.ok(helper,"redactCell implementation must remain present");
  assert.doesNotMatch(helper,/\bsignature\b/i);
});
