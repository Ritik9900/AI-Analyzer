// Obfuscates the Next.js server chunks that contain this app's own code, and strips source maps.
//   node scripts/obfuscate-web.mjs <web-dir>
// Library-only chunks are left alone (smaller, faster, and they hold nothing proprietary).
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import JavaScriptObfuscator from "javascript-obfuscator";
import { BUNDLE } from "./obfuscation-options.mjs";

const webDir = path.resolve(process.argv[2] ?? "");
const serverDir = path.join(webDir, ".next", "server");
const MAX_BYTES = 3 * 1024 * 1024;
// Distinctive strings from our own server code (prompts, licence/token plumbing, analytics).
const MARKERS = [
  "disciplined long-term equity investment advisor",
  "Rule-based fallback",
  "fallback chain",
  "_pa_migrations",
  "x-pa-token",
  "UNKNOWN_TICKER",
  "AI_LOCKED",
  "/portfolio/analytics",
  "aes-256-gcm",
  "Hierarchical Risk Parity",
  "concentrationLimit",
  "Key observations",
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let obfuscated = 0;
let maps = 0;
for (const file of walk(path.join(webDir, ".next"))) {
  if (file.endsWith(".map")) {
    unlinkSync(file);
    maps++;
  }
}
for (const file of walk(serverDir)) {
  if (!file.endsWith(".js") || statSync(file).size > MAX_BYTES) continue;
  const code = readFileSync(file, "utf8");
  if (!MARKERS.some((m) => code.includes(m))) continue;
  writeFileSync(file, JavaScriptObfuscator.obfuscate(code, BUNDLE).getObfuscatedCode());
  obfuscated++;
  console.log("obfuscated", path.relative(webDir, file));
}
console.log(`done: ${obfuscated} server chunks obfuscated, ${maps} source maps removed`);
if (obfuscated === 0) {
  console.error("No app chunks matched; the markers may need updating. Failing so this is not missed.");
  process.exit(1);
}
