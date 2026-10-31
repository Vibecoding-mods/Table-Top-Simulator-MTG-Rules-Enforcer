// Copies the player's own cards and decks (imported decks, commanders, tokens they made) from one save into another,
// e.g. from the newest autosave of the old table into a freshly built ENGINE MODE save. Objects that already exist
// in the target (same GUID), engine cards, test cards and engine trash are skipped. Objects the engine had moved
// under the table (memo "enginestash:...") are put back where they were.
// usage: node tools/carry-player-objects.js <from.json> <into.json> <out.json>
const fs = require("fs");
const [from, into, out] = process.argv.slice(2);
const src = JSON.parse(fs.readFileSync(from, "utf8"));
const dst = JSON.parse(fs.readFileSync(into, "utf8"));
const have = new Set(dst.ObjectStates.map((o) => o.GUID));
const skipGm = (gm) => /^engine/.test(gm || "") || gm === "testcard" || gm === "libcard" || gm === "preload";
const added = [];
for (const o of src.ObjectStates) {
  if (o.Name !== "Card" && o.Name !== "Deck" && o.Name !== "CardCustom") continue;
  if (have.has(o.GUID) || skipGm(o.GMNotes)) continue;
  const m = /^enginestash:([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),(\w+)/.exec(o.Memo || "");
  if (m) {
    Object.assign(o.Transform, { posX: +m[1], posY: +m[2], posZ: +m[3], rotX: +m[4], rotY: +m[5], rotZ: +m[6] });
    o.Locked = m[7] === "true";
    delete o.Memo;
  }
  if (o.Transform.posY < -5) continue; // still under the table and no record of where it came from
  dst.ObjectStates.push(o);
  added.push(`${o.Name} '${String(o.Nickname || "").split("\n")[0]}'${o.Name === "Deck" ? ` (${(o.ContainedObjects || []).length})` : ""}`);
}
dst.SaveName = (dst.SaveName || "") + " + your decks";
fs.writeFileSync(out, JSON.stringify(dst, null, 2));
console.log("added " + added.length + ": " + added.join(", "));
