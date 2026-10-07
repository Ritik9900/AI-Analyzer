# Packaging & sharing Portfolio Analyzer (Windows installer)

This guide turns the project into a single Windows installer
(`PortfolioAnalyzer-Setup-<version>.exe`) that you can send to other people. Each copy:

- installs like a normal Windows app, with its own icon, Start-menu and desktop shortcuts;
- downloads the local AI models (about 650 MB) during installation;
- works only on the **one device** you issue a licence key for;
- stops working after the **number of days** you choose for that person, counted from when they
  activate it;
- ships the analysis engine as **compiled native code**, with the rest obfuscated.

There are three parts: **A** is one-time setup, **B** is every release, and **C** is every recipient.

> **Read first: what protection can and can't do.** Nothing that runs on someone else's computer can
> be made impossible to reverse-engineer. This setup makes it hard: compiled native code,
> signed licence keys that can't be forged without your private key, and obfuscation. That stops
> casual copying, sharing, clock tricks and tampering, but not a skilled, determined reverse
> engineer. See [Security model](#security-model).
>
> **Keep the GitHub repository private.** If the source is public, anyone can build an unlocked copy.

---

## How it works

```
PortfolioAnalyzer-Setup-1.0.0.exe   (NSIS installer, ~0.5–1 GB depending on whether torch is bundled)
└─ installs to  %LOCALAPPDATA%\Programs\Portfolio Analyzer\
   ├─ Portfolio Analyzer.exe          desktop shell (Electron, obfuscated, hardened)
   └─ resources\
      ├─ backend\pa-backend\          analysis engine: app compiled to native code (Nuitka) + Python runtime
      └─ web\                         user interface server (Next.js, obfuscated)
└─ data in      %LOCALAPPDATA%\PortfolioAnalyzer\
   ├─ data.db                         the user's portfolio (Gemini key encrypted with Windows DPAPI)
   ├─ license\                        licence key + tamper-evident activation record (also mirrored in the registry)
   ├─ models\                         Chronos-Bolt + FinBERT, downloaded by the installer
   └─ logs\                           main.log, backend.log, web.log
```

### Licence flow

1. You send the **same installer** to everyone.
2. On first launch the app shows a **Device ID**, e.g. `SQL44-DC4FF-MZ3ZD-M3EU3`. The recipient sends it to you.
3. You run one command to create a **licence key** for that Device ID, with the number of days you want.
4. They paste the key and the app unlocks. The key is useless on any other device.

**How the days are counted.** Example: you issue a key on 1 Oct with `--days 30` and the default
`--activate-within 14`.

| What happens | Result |
|---|---|
| Activated on 5 Oct | Works until 4 Nov (30 days from activation) |
| Not activated by 15 Oct | The key no longer activates; issue a new one |
| Local data wiped and re-activated | Can never run past 14 Nov (activate-by + days) |
| PC clock set back | Refused: the app checks internet time, and offline it detects the clock moving backwards |
| Installer copied to another laptop | It installs, but shows a different Device ID; your key won't work there |

You choose the number of days per person (with `--days`), not per build. Optionally, `-HardExpiry`
also gives a whole build a final end date (see B3).

---

## Admin console (recommended way to do Parts B and C)

A local web console, only for you, that runs builds and manages licences. It keeps its own
database, `admin\data\admin.db`, of who you licensed, on which date, for which device, for how
many days, what you charged and which installer version you sent.

```powershell
admin\start-admin.cmd                      # double-click, or:
backend\.venv\Scripts\python.exe admin\run.py
```

Your browser opens with a one-time sign-in link. The console only accepts connections from this
computer, and it is never included in the installer.

| Page | What you do there |
|---|---|
| **Dashboard** | Counts of active / awaiting / expired licences, **expiring in 7 days** (renewal reminders), licences issued per month, revenue recorded, last build |
| **Issue licence** | Pick or add a recipient, paste their Device ID, choose days (7/30/90/180/365 shortcuts), activate-within, installer version, amount. Then copy the key or a ready-made message to send. |
| **Licences** | Search and filter every key. Open one to copy the key or message, **record the activation date** they report, add notes or payment, **renew** (prefilled), or mark it revoked in your records. |
| **Recipients** | Contact details and every licence and device per person |
| **Builds** | Start `build.ps1` with version, hard expiry and options; **live log**; history with status, duration, size, **SHA-256** (one-click copy) and git commit; open the `dist` folder |
| **Keys & tools** | Create the signing key once (same as A4), unlock or lock it, check whether it matches the public key in your builds, check any licence key, import keys issued earlier with the CLI, export CSV, audit trail |

Notes:
- **Unlocking the key:** you enter the signing-key passphrase once per console session. It is never
  saved, and the key stays in memory only until you lock it or close the console.
- **What the console can know:** keys work offline, so the app can't report activations back. The
  console shows "awaiting activation" until the activate-by date and the *latest possible* expiry.
  Record the activation date when the recipient confirms it, and the exact expiry is shown.
- **"Mark revoked":** this only updates your records. An offline key keeps working on that device
  until it expires, so use short `--days` for people you're unsure about.
- **Backups:** back up `admin\data\admin.db` together with `licensing\keys\private_key.pem`. Both
  are git-ignored. Every key is also appended to `licensing\issued\licenses.csv` as an extra copy.

The command-line tools in Part C (`issue_license.py`) still work. Use **Keys & tools → Import CLI
ledger** to bring keys issued that way into the console.

---

## Part A: One-time setup (personal laptop)

### A1. Install the prerequisites

| Tool | Notes |
|---|---|
| Windows 10/11 x64 | Build on the same OS you ship to |
| Python **3.12** (python.org) | Tested version for Nuitka + PyInstaller + torch |
| Node.js **22 LTS** (minimum 20.19) | The installer builder needs it; older versions fail with `Cannot find module '@noble/hashes/...'` |
| Visual Studio 2022 **Build Tools**, workload "Desktop development with C++" | C compiler for Nuitka. Without it, Nuitka offers to download MinGW automatically, which also works. |
| ~15 GB free disk | The first build caches a lot |

### A2. Python environment (reuse `backend\.venv`)

```powershell
cd backend
py -3.12 -m venv .venv            # skip if it already exists
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-ml.txt
pip install -r ..\packaging\requirements-build.txt
cd ..
```

The ML packages are what make the shipped app run the real models. Without them the build still
works, but recipients get the statistical fallbacks; the build script warns about this.

### A3. JavaScript dependencies

```powershell
cd frontend;            npm install; cd ..
cd packaging\electron;  npm install; cd ..\..
```

### A4. Create your licence signing key: ONCE, ever

```powershell
backend\.venv\Scripts\python.exe licensing\make_keys.py --passphrase "choose-a-strong-passphrase"
```

- This writes the **private key** to `licensing\keys\private_key.pem`, which is git-ignored and
  never shipped.
- It writes the matching **public key** into `backend\app\licensing\public_key.py`, which is
  compiled into every build. Commit this change.

> **Back up `private_key.pem` and its passphrase offline**, for example in a password manager or on
> an encrypted USB drive. Anyone with this file can create licence keys. If you lose it, you can't
> issue keys for builds you've already shipped. Running `make_keys.py --force` creates a new pair,
> and every installer built afterwards rejects keys from the old pair.

### A5. Make the repository private

GitHub → repository → **Settings** → **Danger Zone** → **Change visibility** → **Private**.

---

## Part B: Build a release (every new version)

### B1. Update the code

```powershell
git pull
```
Then follow the README section **"Updating after `git pull`"** (dependencies and migrations).

### B2. Choose the version number

Use `MAJOR.MINOR.PATCH`, e.g. `1.0.0`, then `1.0.1` for fixes and `1.1.0` for new features. The
version appears in Windows "Apps & features", in the installer file name and in the app's Settings.

### B3. Build

From the project root, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File packaging\build.ps1 -Version 1.0.0
```

Optional:

| Flag | Use |
|---|---|
| `-HardExpiry 2027-06-30` | Every copy of **this build** stops on that date, whatever the licence says. Use it to force people onto newer versions. |
| `-SkipBackend` | Reuse the last compiled backend. Use this when only the UI changed: it's much faster. |
| `-ReuseNative` | Reuse the last native compile (Nuitka) and redo only the bundling step. Only when backend code is unchanged, e.g. after fixing a bundling error. |
| `-NoObfuscate` | Troubleshooting only. Never ship a build made with this. |

What the script does, and stops on any failure:

1. **Preflight:** checks the Python 3.12 venv, build tools, Node, and that the licence public key is set.
2. **Backend:**
   - copies `backend\app` with licence enforcement switched on
   - compiles it to a native `.pyd` (Nuitka)
   - bundles it with Python and its dependencies (PyInstaller)
   - runs `pa-backend.exe --self-test`
3. **UI:**
   - builds Next.js in standalone mode and adds the Prisma engine and migrations
   - **deletes `.env` files and databases** (Next copies `.env` into its output)
   - obfuscates the app's server code
   - smoke-tests a fresh database
4. **Installer:**
   - obfuscates the desktop shell
   - runs a **secret and protection scan**, which fails the build on any `.env`, `.db`, `.pem`, API key, or Python source shipped by mistake
   - builds the NSIS installer
   - checks the packaged files and switches off Electron debugging options (fuses)

The first build takes roughly 20–40 minutes, mostly Nuitka. Later builds are faster.

**Output:** `packaging\dist\PortfolioAnalyzer-Setup-1.0.0.exe`, plus its **SHA-256** printed at the
end. Send the SHA-256 along with the file so the recipient can check the download is intact.

### B4. Test before sending (10 minutes)

Use **Windows Sandbox** (Windows Pro: "Turn Windows features on or off" → Windows Sandbox), a VM, or
your own laptop.

1. Run the installer. Accept the terms, let the model download window finish, then launch the app.
2. The activation screen appears. Copy the Device ID.
3. Issue a short test key (see C3), e.g. `--days 2 --name "Test"`, and paste it.
4. Check:
   - **Portfolio:** add one stock.
   - **Insights:** loads.
   - **Settings → Licence:** shows the name, expiry and version.
   - **Settings:** add a Gemini key and run AI Strategy once.
5. Uninstall from "Apps & features".

Installed copies keep their data in `%LOCALAPPDATA%\PortfolioAnalyzer`, separate from your
development database. Uninstalling keeps that folder on purpose, so reinstalling doesn't reset a
licence.

---

## Part C: Send to a person (every recipient)

### C1. Share the installer

The file is too large for email. Upload it to Google Drive, OneDrive or Dropbox, and send the link
together with the SHA-256 from B3.

### C2. Send them the instructions

Copy and paste the text in [Part D](#part-d-instructions-to-send-recipients).

### C3. When they send their Device ID, issue their key

```powershell
backend\.venv\Scripts\python.exe licensing\issue_license.py --device SQL44-DC4FF-MZ3ZD-M3EU3 --days 30 --name "Ravi Kumar" --passphrase "your-passphrase"
```

| Option | Meaning |
|---|---|
| `--device` | The Device ID they sent (spaces, dashes and lower case are fine) |
| `--days` | How long it works, counted from activation (1–3650) |
| `--name` | Shown in their app as "Licensed to" |
| `--activate-within` | Days they have to activate it (default 14) |
| `--verify-only KEY` | Check and decode an existing key |

The command prints the key, which starts with `PA1-`. Send it back to them. Every key is logged in
`licensing\issued\licenses.csv` (git-ignored; it contains names, so keep it private).

### C4. Renewals

Issue a new key for the **same Device ID** with the new number of days. They can paste it in
**Settings → Licence → Enter a new licence key** before expiry, or on the activation screen after
expiry. A renewal starts counting from when it's activated, so either issue it close to the expiry
date or add the remaining days to `--days`.

### C5. A recipient's Device ID changed

The Device ID changes if they reinstall Windows or replace the motherboard. Issue a new key for the
new ID. Keys can't be moved between devices.

---

## Part D: Instructions to send recipients

> **Installing Portfolio Analyzer**
>
> 1. Download `PortfolioAnalyzer-Setup-<version>.exe` from the link I sent. (Optional: in PowerShell
>    run `Get-FileHash .\PortfolioAnalyzer-Setup-<version>.exe` and check it matches the SHA-256 I sent.)
> 2. Run it. If Windows shows "Windows protected your PC", click **More info → Run anyway**. The
>    app isn't code-signed yet.
> 3. Accept the terms and finish the installation. A window downloads the AI models (about 650 MB):
>    keep it open until it finishes. If it fails, the app still works; you can retry later from
>    **Start menu → Portfolio Analyzer - Download AI models**.
> 4. Open Portfolio Analyzer. It shows a **Device ID**. Click **Copy** and send it to me.
> 5. I'll reply with a licence key starting with `PA1-`. Paste it into the app and click
>    **Activate**.
> 6. For the AI features, create a free Gemini API key at https://aistudio.google.com/apikey and
>    paste it in **Settings**. It's stored encrypted, on your computer only.
>
> Your portfolio data stays on your computer. The app is for information only, not financial advice.
> Before your licence runs out the app shows a reminder; ask me for a renewal key.

---

## Security model

| Layer | Protection | Limits |
|---|---|---|
| Analysis engine (Python) | Compiled to native code with Nuitka; no `.py` source is shipped (the build scan enforces this) | Native code can still be disassembled with significant effort |
| Licence check | Runs inside the compiled engine. Keys are **Ed25519-signed**, so they can't be forged or edited without your private key. Device-locked. | A skilled attacker could patch the binary |
| Expiry | Network time from HTTPS servers; clock-rollback detection; activation recorded in two places with tamper detection; capped at activate-by + days | Fully offline and with both records wiped, re-activation can add at most (activate-by − activation) days |
| UI server (Next.js) | Minified, and the app's own server chunks are obfuscated; no source maps | Obfuscation slows analysis; it doesn't prevent it |
| Desktop shell (Electron) | Obfuscated; packed in `asar`; DevTools off; fuses block "run as Node", `NODE_OPTIONS` and the inspector | Same as above |
| Local services | Listen on 127.0.0.1 only, on random ports, with a random per-launch token | Other software on the same PC running as the same user is trusted by Windows |
| User secrets | Gemini key encrypted with AES-256-GCM using a per-install secret; that secret is protected by Windows DPAPI (per Windows user) | |
| Your private key | Never shipped; git-ignored; optional passphrase | Leaking it lets anyone mint keys. If that happens: `make_keys.py --force`, rebuild, and re-issue keys |

---

## Code signing (recommended before wide distribution)

Unsigned installers trigger the SmartScreen warning, and antivirus products sometimes flag
unsigned PyInstaller binaries as false positives. A code-signing certificate fixes both. Options
include OV/EV certificates from a certificate authority, or Microsoft's Azure Trusted Signing
service; check current pricing and eligibility. electron-builder signs automatically when
`CSC_LINK` and `CSC_KEY_PASSWORD` are set. See electron-builder's "Code Signing" docs. The backend
`pa-backend.exe` should be signed too (`signtool sign`), before the installer step.

---

## Troubleshooting the build

| Symptom | Fix |
|---|---|
| `Licence public key not set` | Do A4 once |
| App says "The licence key is not valid" for a key you just issued | The installed build contains a different public key than your private key (e.g. an engine compiled before the key was created, reused via `-SkipBackend` / `-ReuseNative`). Do a full build; the script now refuses reuse when `public_key.py` changed. |
| Nuitka: no C compiler | Install VS 2022 Build Tools (C++ workload), or let Nuitka download MinGW when asked |
| Self-test: `No module named 'app'` | Fixed in the current version (`pa_backend.spec` now bundles the compiled `app*.pyd` explicitly). Pull, then re-run with `-ReuseNative` to skip the long compile. |
| `Cannot find module '@noble/hashes/blake2.js'` (electron-builder) | Node.js older than 20.19, or edited files in `node_modules`. Install Node.js 22 LTS, delete `packaging\electron\node_modules`, re-run the build (it runs `npm ci`). |
| Self-test: `ModuleNotFoundError: X` | Add `X` to `EXTRA` in `packaging\backend\gen_bundle_imports.py` (or to `hiddenimports` in `pa_backend.spec`), then rebuild |
| `No app chunks matched` (obfuscation) | A refactor renamed the marker strings; update `MARKERS` in `packaging\electron\scripts\obfuscate-web.mjs` |
| `SECRET / PROTECTION SCAN FAILED` | Read the listed files. Never bypass this check: remove what it found |
| `Packaged app is incomplete` | A resource folder was not copied; check `packaging\build\web` and `packaging\build\backend` |
| `npm install` fails on Prisma / Electron downloads behind a corporate proxy | See README → "Corporate networks" (`npm config set node-options=--use-system-ca`) |
| Antivirus quarantines `pa-backend.exe` | False positive common with unsigned PyInstaller apps; sign the binaries (see above) or report it to the vendor |

### Recipient support

| Recipient sees | Cause / fix |
|---|---|
| "This licence key was issued for a different device" | Wrong Device ID used, or Windows reinstalled; issue a new key for the ID shown |
| "had to be activated by …" | Key not used within `--activate-within` days; issue a new key |
| "date appears to be set in the past" | Their PC clock is wrong; set the date and time automatically, then restart |
| "The analysis service stopped unexpectedly" | Antivirus or a damaged install; reinstall; logs are in `%LOCALAPPDATA%\PortfolioAnalyzer\logs` |
| Forecasts and sentiment show "Mock" | Model download didn't finish; Start menu → *Portfolio Analyzer - Download AI models*, then restart the app |

---

## Before you share it with others

These aren't technical blockers, but check them, especially if you plan to charge money:

- **Market data terms.** `yfinance` is an unofficial client for Yahoo Finance. Yahoo's terms
  limit its data to personal use, and distributing or selling an app that relies on it may breach
  them. For commercial distribution, consider a licensed market-data provider.
- **Investment-advice regulation.** In India, giving investment advice for a fee generally requires
  SEBI registration as an Investment Adviser. Other countries have similar rules. The disclaimers
  in the app help, but they don't replace this.
- **Licences of bundled components.** Electron, Next.js, PyTorch, Transformers and others are
  open-source under their own licences; electron-builder includes Chromium's notices. Chronos-Bolt
  is Apache-2.0; check FinBERT's model card for its current licence.
- **Terms of use.** `packaging\electron\build\license.txt` is a template shown during installation.
  Have it reviewed.

Get qualified legal advice for the first two points before wider or paid distribution.

---

## Files in this pipeline

```
PACKAGING.md                         this guide
packaging/
├── build.ps1                        one-command build (Part B)
├── requirements-build.txt           Nuitka + PyInstaller
├── assets/make_icon.py              regenerates the icon set (edit colours/shape here)
├── backend/                         PyInstaller entry, spec, import-manifest generator
└── electron/
    ├── src/                         desktop shell: main.js, preload.js, activation + splash screens
    ├── scripts/                     obfuscation, secret scan, after-pack checks + fuses
    └── build/                       icon.ico/png, installer.nsh (model download), license.txt
licensing/
├── make_keys.py                     A4: one-time key pair
├── issue_license.py                 C3: per-recipient keys
├── keys/      (git-ignored)         private_key.pem  <- never share
└── issued/    (git-ignored)         licenses.csv ledger
backend/app/licensing/               device ID, key verification, activation records (compiled into builds)
```
