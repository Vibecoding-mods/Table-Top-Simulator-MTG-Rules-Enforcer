// TTS's Lua (MoonSharp) raises "pattern too complex" where real Lua doesn't: a pattern call leaks match depth on every
// failed inner match (each backtrack step of a repetition: 2 inside a capture, 1 outside), and raises once ~200 have
// leaked at one start position. Measured on live TTS 2026-11-06 (tmp/pattern-trap/rule.md): "^([^:]*):" on 99 letters
// with no colon raises, "^[^:]*:" on 199. Required before fengari, this loads fengari's string library with the same
// leak, so the fake TTS fails where the real one does: a failed call keeps its depth, and each start position
// (reprepstate) starts again from the full depth.
const path = require("path");
const Module = require("module");

// (the file is changed as it compiles, so fengari still loads its modules in its own order)
const file = require.resolve("fengari/src/lstrlib.js", { paths: [__dirname] });
if (require.cache[file] && !require.cache[file].moonsharp) throw new Error("moonsharp-patterns: require it before fengari");
const swaps = [
  ["    ms.matchdepth++;\n    return s;\n};", "    if (s !== null) ms.matchdepth++;\n    return s;\n};"],
  ["    ms.level = 0;\n    lualib.lua_assert(ms.matchdepth === MAXCCALLS);", "    ms.level = 0;\n    ms.matchdepth = MAXCCALLS;"],
];
const compile = Module.prototype._compile;
if (!compile.moonsharp) {
  Module.prototype._compile = function (src, filename) {
    if (path.resolve(filename) !== path.resolve(file)) return compile.call(this, src, filename);
    src = src.replace(/\r\n/g, "\n");
    for (const [from, to] of swaps) {
      if (!src.includes(from)) throw new Error(`moonsharp-patterns: fengari's lstrlib.js changed, "${from.trim().split("\n")[0]}" not found`);
      src = src.replace(from, to);
    }
    this.moonsharp = true;
    return compile.call(this, src, filename);
  };
  Module.prototype._compile.moonsharp = true;
}
module.exports = { file };
