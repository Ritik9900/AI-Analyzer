// Copies the desktop shell from src/ to dist-main/, obfuscating the JavaScript.
//   node scripts/prepare-main.mjs [--no-obfuscate]
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JavaScriptObfuscator from "javascript-obfuscator";
import { STRONG } from "./obfuscation-options.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const out = path.join(root, "dist-main");
const obfuscate = !process.argv.includes("--no-obfuscate");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const [file, target] of [
  ["main.js", "node"],
  ["preload.js", "node"],
  ["activation.js", "browser"],
]) {
  const code = readFileSync(path.join(src, file), "utf8");
  const result = obfuscate ? JavaScriptObfuscator.obfuscate(code, { ...STRONG, target }).getObfuscatedCode() : code;
  writeFileSync(path.join(out, file), result);
  console.log(`${obfuscate ? "obfuscated" : "copied"} ${file}`);
}
for (const file of ["activation.html", "splash.html", "icon.png"]) {
  copyFileSync(path.join(src, file), path.join(out, file));
}
