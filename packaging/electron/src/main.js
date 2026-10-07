"use strict";
/*
 * Portfolio Analyzer desktop shell.
 *
 *   1. Starts the compiled analysis service (pa-backend.exe) on a random local port.
 *   2. Asks it for the licence status (the check itself lives in the compiled backend).
 *   3. Shows the activation window if needed, otherwise starts the web UI server and opens it.
 *   4. Re-checks the licence every 30 minutes.
 *
 * Both child services listen on 127.0.0.1 only and share a random per-launch token.
 */
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, safeStorage, session, shell, utilityProcess } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const PRODUCT = "Portfolio Analyzer";
const DATA_DIR = path.join(process.env.LOCALAPPDATA || app.getPath("appData"), "PortfolioAnalyzer");
const LOG_DIR = path.join(DATA_DIR, "logs");
const RES = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..", "..", "build");
const BACKEND_EXE = path.join(RES, "backend", "pa-backend", process.platform === "win32" ? "pa-backend.exe" : "pa-backend");
const WEB_DIR = path.join(RES, "web");
const ICON = path.join(__dirname, "icon.png");
const TOKEN = crypto.randomBytes(32).toString("hex");
const LICENSE_CHECK_MS = 30 * 60 * 1000;

app.setName(PRODUCT);
app.setPath("userData", path.join(DATA_DIR, "electron"));

let backend = null;
let web = null;
let backendPort = 0;
let webPort = 0;
let splash = null;
let mainWin = null;
let activationWin = null;
let licenseTimer = null;
let quitting = false;

// --- Logging ------------------------------------------------------------------------------

fs.mkdirSync(LOG_DIR, { recursive: true });
function logStream(name) {
  const file = path.join(LOG_DIR, name);
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, `${file}.1`);
  } catch {
    /* new file */
  }
  return fs.createWriteStream(file, { flags: "a" });
}
const mainLog = logStream("main.log");
const log = (...a) => mainLog.write(`${new Date().toISOString()} ${a.join(" ")}\n`);

// --- Helpers --------------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(url, { timeoutMs, headers = {}, label }) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    if (quitting) throw new Error("quitting");
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(3000) });
      if (res.ok) return res;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err.message;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not start within ${timeoutMs / 1000}s (${lastErr})`);
}

/** Per-install secret that encrypts the Gemini API key in the local database (DPAPI via safeStorage). */
function appSecret() {
  const file = path.join(DATA_DIR, "secret.bin");
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
  }
  const secret = crypto.randomBytes(32).toString("base64");
  fs.writeFileSync(file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(secret) : Buffer.from(secret, "utf8"));
  return secret;
}

async function backendJson(pathname, init = {}) {
  const res = await fetch(`http://127.0.0.1:${backendPort}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", "x-pa-token": TOKEN, ...(init.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  return res.json();
}

const licenseStatus = () => backendJson("/license/status");

function fatal(err) {
  log("FATAL", err && err.stack ? err.stack : String(err));
  if (quitting) return;
  dialog.showErrorBox(PRODUCT, `${err && err.message ? err.message : err}\n\nDetails were written to:\n${LOG_DIR}`);
  app.quit();
}

// --- Child services -------------------------------------------------------------------------

async function startBackend() {
  if (!fs.existsSync(BACKEND_EXE)) throw new Error(`Analysis service not found at ${BACKEND_EXE}. Reinstall the app.`);
  backendPort = await freePort();
  const out = logStream("backend.log");
  backend = spawn(BACKEND_EXE, ["--port", String(backendPort), "--data-dir", DATA_DIR], {
    env: { ...process.env, PA_TOKEN: TOKEN, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  backend.stdout.pipe(out);
  backend.stderr.pipe(out);
  backend.on("exit", (code) => {
    log("backend exited", code);
    if (!quitting) fatal(new Error("The analysis service stopped unexpectedly."));
  });
  await waitFor(`http://127.0.0.1:${backendPort}/health`, { timeoutMs: 120000, label: "The analysis service" });
  log("backend ready on", backendPort);
}

async function startWeb() {
  webPort = await freePort();
  const out = logStream("web.log");
  web = utilityProcess.fork(path.join(WEB_DIR, "server.js"), [], {
    cwd: WEB_DIR,
    stdio: "pipe",
    serviceName: `${PRODUCT} UI`,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(webPort),
      HOSTNAME: "127.0.0.1",
      BACKEND_URL: `http://127.0.0.1:${backendPort}`,
      PA_TOKEN: TOKEN,
      PA_PACKAGED: "1",
      PA_MIGRATIONS_DIR: path.join(WEB_DIR, "prisma", "migrations"),
      DATABASE_URL: `file:${path.join(DATA_DIR, "data.db").replace(/\\/g, "/")}`,
      APP_SECRET: appSecret(),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  web.stdout.pipe(out);
  web.stderr.pipe(out);
  web.on("exit", (code) => {
    log("web exited", code);
    if (!quitting) fatal(new Error("The user interface server stopped unexpectedly."));
  });
  await waitFor(`http://127.0.0.1:${webPort}/api/license`, { timeoutMs: 90000, label: "The user interface" });
  log("web ready on", webPort);
}

// --- Windows --------------------------------------------------------------------------------

const secureDefaults = { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged, spellcheck: false };

function createSplash() {
  splash = new BrowserWindow({ width: 440, height: 280, frame: false, resizable: false, show: false, icon: ICON, backgroundColor: "#0b1730", webPreferences: secureDefaults });
  splash.loadFile(path.join(__dirname, "splash.html"));
  splash.once("ready-to-show", () => splash && splash.show());
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.destroy();
  splash = null;
}

function openActivation() {
  if (activationWin && !activationWin.isDestroyed()) return activationWin.focus();
  activationWin = new BrowserWindow({
    width: 600,
    height: 660,
    resizable: false,
    title: `${PRODUCT} — Activation`,
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: "#fafafa",
    webPreferences: { ...secureDefaults, preload: path.join(__dirname, "preload.js") },
  });
  activationWin.loadFile(path.join(__dirname, "activation.html"));
  activationWin.on("closed", () => {
    activationWin = null;
    if (!mainWin) app.quit();
  });
}

async function openApp() {
  if (!web) await startWeb();
  const origin = `http://127.0.0.1:${webPort}`;
  mainWin = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: PRODUCT,
    icon: ICON,
    backgroundColor: "#fafafa",
    webPreferences: secureDefaults,
  });
  // External links (news, Google AI Studio) open in the user's browser; the app never navigates away.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWin.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  mainWin.on("closed", () => {
    mainWin = null;
    if (!activationWin) app.quit();
  });
  mainWin.once("ready-to-show", () => {
    mainWin.show();
    closeSplash();
    if (activationWin && !activationWin.isDestroyed()) activationWin.destroy();
  });
  await mainWin.loadURL(origin);
  scheduleLicenseChecks();
}

function scheduleLicenseChecks() {
  clearInterval(licenseTimer);
  licenseTimer = setInterval(async () => {
    try {
      const status = await licenseStatus();
      if (!status.valid) {
        log("licence no longer valid:", status.state);
        const win = mainWin;
        mainWin = null;
        openActivation();
        if (win && !win.isDestroyed()) win.destroy();
      }
    } catch (err) {
      log("licence check failed", err.message);
    }
  }, LICENSE_CHECK_MS);
}

// --- Activation IPC (only from our own activation window) -----------------------------------

function fromActivation(event) {
  return activationWin && !activationWin.isDestroyed() && event.sender === activationWin.webContents;
}

ipcMain.handle("pa:info", async (event) => {
  if (!fromActivation(event)) return null;
  return { status: await licenseStatus(), version: app.getVersion(), product: PRODUCT };
});

ipcMain.handle("pa:activate", async (event, key) => {
  if (!fromActivation(event) || typeof key !== "string" || key.length > 4000) return null;
  const result = await backendJson("/license/activate", { method: "POST", body: JSON.stringify({ key }) });
  if (result && result.valid) {
    setTimeout(() => openApp().catch(fatal), 1200); // let the window show the success message briefly
  }
  return result;
});

ipcMain.handle("pa:copy", (event, text) => {
  if (fromActivation(event) && typeof text === "string" && text.length < 200) clipboard.writeText(text);
});

ipcMain.handle("pa:quit", (event) => {
  if (fromActivation(event)) app.quit();
});

// --- Lifecycle ------------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = mainWin || activationWin;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    if (app.isPackaged) Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    createSplash();
    try {
      await startBackend();
      const status = await licenseStatus();
      log("licence state:", status.state);
      if (status.valid) {
        await openApp();
      } else {
        // Open the next window BEFORE closing the splash: with zero windows open, "window-all-closed" quits the app.
        openActivation();
        closeSplash();
      }
    } catch (err) {
      fatal(err);
    }
  });

  app.on("window-all-closed", () => {
    // Belt and braces: never quit while a window transition is in progress.
    setTimeout(() => {
      if (BrowserWindow.getAllWindows().length === 0) app.quit();
    }, 500);
  });
  app.on("before-quit", () => {
    quitting = true;
    clearInterval(licenseTimer);
    for (const child of [web, backend]) {
      try {
        if (child) child.kill();
      } catch {
        /* already gone */
      }
    }
  });
}
