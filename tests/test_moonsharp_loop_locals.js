// TTS's Lua (MoonSharp) leaves a `local` declared with no value inside a `for ... in` loop body holding the table
// being looped over, not nil, from the first pass (measured on live TTS 2026-11-11: `for _, w in ipairs(list) do
// local x ... end` read x as the list; numeric `for` and `while` were fine, so were function-level locals). The fake
// TTS (fengari) gives nil, so no behaviour test can see it. It put Undercity, the city's blessing and The Ring on the
// monarch's mat (engineStatusPlace's `local count`) and dropped the greyed reason of every ability nothing offered
// (engineAbList's `local hit`). This scan of the built Global finds every such local: write `local x = nil`.
//   node tests/test_moonsharp_loop_locals.js [file.lua]
const fs = require("fs");
const path = require("path");
const luaparse = require("./lua/node_modules/luaparse");

const src = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : require("./golden/table-run").buildSave().LuaScript;

// a local's names past its values, unless the last value is a call or `...` (they fill the rest)
const short = (st) => {
  if (st.variables.length <= st.init.length) return false;
  const last = st.init[st.init.length - 1];
  return !(last && (last.type === "CallExpression" || last.type === "StringCallExpression" || last.type === "TableCallExpression" || last.type === "VarargLiteral"));
};
const found = [];
// inLoop: inside a `for ... in` body of the same function
function walk(node, inLoop) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) walk(n, inLoop); return; }
  if (node.type === "FunctionDeclaration") { walk(node.body, false); return; }
  if (node.type === "ForGenericStatement") { walk(node.iterators, inLoop); walk(node.body, true); return; }
  if (node.type === "LocalStatement" && inLoop && short(node)) {
    found.push(`line ${node.loc.start.line}: local ${node.variables.map((v) => v.name).join(", ")}`);
  }
  for (const [k, v] of Object.entries(node)) if (k !== "loc" && k !== "range") walk(v, inLoop);
}
walk(luaparse.parse(src, { locations: true, luaVersion: "5.2", comments: false }), false);

if (found.length) {
  console.log(`FAIL: ${found.length} local(s) with no value in a for-in loop body (TTS reads the looped table there; write = nil):`);
  for (const f of found) console.log("  " + f);
  process.exit(1);
}
console.log("PASSED: no local without a value in any for-in loop body of the Global script");
