// electron-builder afterPack hook:
//  1. verifies the packaged resources are complete (dot-folders and native engines are easy to lose);
//  2. flips Electron fuses so the shipped exe can't be repurposed as a plain Node runtime or debugged.
const fs = require("node:fs");
const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

exports.default = async function afterPack(context) {
  const res = path.join(context.appOutDir, "resources");
  const required = [
    "web/server.js",
    "web/.next/BUILD_ID",
    "web/node_modules/next/package.json",
    "web/node_modules/.prisma/client/query_engine-windows.dll.node",
    "web/prisma/migrations",
    "backend/pa-backend/pa-backend.exe",
  ];
  const missing = required.filter((p) => !fs.existsSync(path.join(res, p)));
  if (missing.length) throw new Error(`Packaged app is incomplete, missing: ${missing.join(", ")}`);

  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
  });
  console.log("afterPack: resources verified, fuses flipped");
};
