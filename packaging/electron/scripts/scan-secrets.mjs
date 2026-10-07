// Fails the build if anything sensitive would be shipped.
//   node scripts/scan-secrets.mjs <packaging/build dir> <dist-main dir>
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const [buildDir, distMain] = process.argv.slice(2).map((p) => path.resolve(p));
const BAD_NAMES = [/^\.env(\..*)?$/i, /\.db$/i, /\.db-journal$/i, /\.pem$/i, /^licenses\.csv$/i, /private_key/i, /^secret\.bin$/i];
const BAD_CONTENT = [/AIza[0-9A-Za-z_-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /^APP_SECRET=.+/m];
const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".json", ".html", ".txt", ".md", ".env", ".prisma", ".sql"]);
const problems = [];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

function scan(dir, { content }) {
  for (const file of walk(dir)) {
    const base = path.basename(file);
    if (base === "cacert.pem") continue;
    if (BAD_NAMES.some((re) => re.test(base))) problems.push(`forbidden file: ${file}`);
    if (content && TEXT_EXT.has(path.extname(file).toLowerCase()) && statSync(file).size < 20 * 1024 * 1024) {
      const text = readFileSync(file, "utf8");
      for (const re of BAD_CONTENT) if (re.test(text)) problems.push(`secret-like content (${re}): ${file}`);
    }
  }
}

scan(path.join(buildDir, "web"), { content: true });
scan(distMain, { content: true });
scan(path.join(buildDir, "backend"), { content: false });

// The backend must ship compiled code only: no application .py sources.
const backendFiles = [...walk(path.join(buildDir, "backend"))];
const leaked = backendFiles.filter((f) => /[\\/]app[\\/][^\\/]+\.py$/.test(f));
if (leaked.length) problems.push(`application source files in backend bundle: ${leaked.slice(0, 5).join(", ")}`);
if (!backendFiles.some((f) => /[\\/]app\.[^\\/]*\.pyd$|[\\/]app\.pyd$/.test(f))) problems.push("compiled app .pyd not found in backend bundle");

if (problems.length) {
  console.error("SECRET / PROTECTION SCAN FAILED:\n - " + problems.join("\n - "));
  process.exit(1);
}
console.log("secret / protection scan passed");
