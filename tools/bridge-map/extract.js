// Lists every function in a JS file with its line, size, leading comment, calls and callers: node extract.js <file> <out.json>
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/);
const defs = [];
const top = [/^(?:async )?function\*? (\w+)\s*\(/, /^const (\w+) = (?:async )?(?:\([^)]*\)|\w+) =>/, /^const (\w+) = (?:async )?function/, /^class (\w+)/];
const method = /^  (?:async |static )?(\w+)\s*\([^)]*\)\s*\{/;
let cls = null;
for (let i = 0; i < src.length; i++) {
  const l = src[i];
  if (/^class (\w+)/.test(l)) cls = l.match(/^class (\w+)/)[1];
  else if (/^\}/.test(l)) cls = null;
  let hit = null, kind = "function";
  for (const [k, r] of top.entries()) { const m = l.match(r); if (m) { hit = m[1]; kind = k === 3 ? "class" : "function"; break; } }
  if (!hit && cls) { const m = l.match(method); if (m && !["if", "for", "while", "switch", "catch"].includes(m[1])) { hit = m[1]; kind = "method"; } }
  if (!hit) continue;
  let j = i - 1;
  const c = [];
  while (j >= 0 && /^\s*\/\//.test(src[j])) { c.unshift(src[j].replace(/^\s*\/\/ ?/, "")); j--; }
  defs.push({ name: kind === "method" ? `${cls}.${hit}` : hit, short: hit, line: i + 1, kind, comment: c.join(" ") });
}
for (let d = 0; d < defs.length; d++) defs[d].end = (defs[d + 1]?.line || src.length + 1) - 1;
const names = new Set(defs.filter((d) => d.kind === "function").map((d) => d.short));
for (const d of defs) {
  const body = src.slice(d.line, d.end).filter((l) => !/^\s*\/\//.test(l)).join("\n");
  d.calls = [...names].filter((n) => n !== d.short && new RegExp(`\\b${n}\\b\\s*\\(`).test(body));
  d.size = d.end - d.line + 1;
}
for (const d of defs) d.callers = defs.filter((x) => x.calls.includes(d.short)).map((x) => x.name);
fs.writeFileSync(process.argv[3], JSON.stringify(defs, null, 1));
for (const d of defs) console.log(`${d.line}\t${d.name}\t${d.size}\t${d.calls.length}/${d.callers.length}\t${d.comment.slice(0, 120)}`);
