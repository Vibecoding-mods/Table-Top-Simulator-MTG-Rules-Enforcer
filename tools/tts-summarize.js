// Prints the key lines of a tts-run-game.sh report.   node tts-summarize.js report.txt
const s = require("fs").readFileSync(process.argv[2], "utf8");
console.log(s.split("\n").slice(0, 2).join("\n"));
const i = s.indexOf("\n{\n");
if (i < 0) { console.log("(no report — run was interrupted)"); process.exit(0); }
const j = JSON.parse(s.slice(i + 1));
console.log("first problem:", j.firstProblemAt || "none");
for (const p of (j.problems || []).slice(0, 15)) console.log("  ", p);
console.log("errors:", j.errors.length ? j.errors.slice(0, 4) : "none");
console.log("stuck:", j.stuck.length ? j.stuck : "none");
console.log("drags", j.drags, "| steps", j.steps, "| last turn", j.lastTurn, "| prompts", JSON.stringify(j.prompts));
console.log("final", JSON.stringify(j.final));
