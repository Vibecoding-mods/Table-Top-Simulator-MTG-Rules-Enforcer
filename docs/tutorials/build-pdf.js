// Prints each tutorial's HTML to PDF with headless Edge: docs/tutorials/<folder>/index.html -> docs/tutorials/<PDF name>.
// Run from anywhere: node docs/tutorials/build-pdf.js [folder ...]   (no folder: every folder in PDF_NAMES that exists)
// --check also dumps each page's DOM and prints the pages whose content runs past the page (data-fit="OVER ...").
// No npm packages; Edge's path can be overridden with EDGE=<path to msedge.exe>.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");

const HERE = __dirname;
const EDGE = process.env.EDGE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
// folder -> PDF file name (a folder not listed prints as MTG-<Folder>-Tutorial.pdf)
const PDF_NAMES = { table: "MTG-Table-Tutorial.pdf", companion: "MTG-Companion-Tutorial.pdf" };

const args = process.argv.slice(2);
const check = args.includes("--check");
const wanted = args.filter((a) => !a.startsWith("--"));
const folders = (wanted.length ? wanted : fs.readdirSync(HERE).filter((d) => fs.existsSync(path.join(HERE, d, "index.html"))));

if (!fs.existsSync(EDGE)) { console.error(`Edge not found at ${EDGE} (set EDGE=...)`); process.exit(1); }
let failed = 0;
for (const folder of folders) {
  const html = path.join(HERE, folder, "index.html");
  if (!fs.existsSync(html)) { console.error(`skip ${folder}: no index.html`); failed++; continue; }
  const name = PDF_NAMES[folder] || `MTG-${folder[0].toUpperCase()}${folder.slice(1)}-Tutorial.pdf`;
  const out = path.join(HERE, name);
  const url = pathToFileURL(html).href;
  // (a separate profile folder: a running Edge window of the user's doesn't take the job over)
  const profile = path.join(require("os").tmpdir(), "mtg-tutorial-edge");
  const common = ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`, "--allow-file-access-from-files",
    "--virtual-time-budget=5000"];
  fs.rmSync(out, { force: true }); // (so a failed run can't be read as success through an older PDF)
  try {
    execFileSync(EDGE, [...common, "--no-pdf-header-footer", `--print-to-pdf=${out}`, url], { stdio: "pipe", timeout: 120000 });
  } catch (e) {
    if (!fs.existsSync(out)) { console.error(`${folder}: Edge failed: ${e.message}`); failed++; continue; }
  }
  const pdf = fs.readFileSync(out);
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(`${folder}: ${out} (${pages} pages, ${(pdf.length / 1048576).toFixed(1)} MB)`);
  if (check) {
    const dom = execFileSync(EDGE, [...common, "--dump-dom", url], { encoding: "utf8", timeout: 120000, maxBuffer: 64 << 20 });
    const fits = [...dom.matchAll(/data-fit="([^"]*)"/g)].map((m, i) => `  page ${i + 1}: ${m[1]}`);
    console.log(fits.length ? fits.join("\n") : "  (no data-fit marks: the page has no fit check)");
    if (fits.some((l) => l.includes("OVER"))) failed++;
  }
}
process.exit(failed ? 1 : 0);
