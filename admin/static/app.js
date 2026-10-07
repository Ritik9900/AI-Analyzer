"use strict";
/* Portfolio Analyzer admin console. Vanilla JS; all values rendered as text (never innerHTML). */

// ---------- tiny helpers ----------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") Object.assign(el.style, v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((e) => `${(e.loc || []).slice(1).join(".")}: ${e.msg}`).join("; ") : `Request failed (${res.status})`);
  }
  return data;
}

function toast(msg, bad = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `show${bad ? " bad" : ""}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ""), 2600);
}

async function copy(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Copy failed: select and copy manually", true);
  }
}

const fmtDate = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtMoney = (a, c) => (a == null ? "—" : `${c ? c + " " : ""}${Number(a).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const fmtBytes = (b) => (b == null ? "—" : `${(b / 1024 / 1024).toFixed(0)} MB`);
const fmtDur = (s) => (s == null ? "—" : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
const badge = (status, label) => h("span", { class: `badge b-${status}` }, label || status);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + Number(n));
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

function card(title, desc, actions, ...body) {
  return h("section", { class: "card" },
    h("div", { class: "card-h" }, h("div", {}, h("h2", {}, title), desc ? h("p", {}, desc) : null), actions ? h("div", { class: "actions" }, actions) : null),
    h("div", { class: "card-b" }, body));
}

function table(cols, rows, onClick) {
  if (!rows.length) return h("div", { class: "empty" }, "Nothing here yet.");
  return h("div", { class: "table-wrap" },
    h("table", {},
      h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "num" : "" }, c.label)))),
      h("tbody", {}, rows.map((r) => h("tr", { class: onClick ? "click" : "", onclick: onClick ? () => onClick(r) : null },
        cols.map((c) => h("td", { class: `${c.num ? "num" : ""} ${c.cls || ""}` }, c.render ? c.render(r) : r[c.key] ?? "—")))))));
}

function modal(title, ...body) {
  const root = document.getElementById("modal-root");
  const close = () => { root.replaceChildren(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => e.key === "Escape" && close();
  document.addEventListener("keydown", onKey);
  root.replaceChildren(h("div", { class: "modal-back", onclick: (e) => e.target === e.currentTarget && close() },
    h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "card-h" }, h("h2", {}, title), h("button", { class: "small", onclick: close, "aria-label": "Close" }, "Close")),
      h("div", { class: "card-b" }, body))));
  return close;
}

function field(label, input, hint) {
  return h("label", {}, label, hint ? h("span", { class: "hint" }, ` ${hint}`) : null, input);
}

const view = () => document.getElementById("view");
function render(...nodes) {
  view().replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));
}

// ---------- key status pill ----------
async function refreshKeyPill() {
  const pill = document.getElementById("keypill");
  try {
    const k = await api("/api/keys");
    if (!k.private_key_exists) { pill.textContent = "No signing key"; pill.className = "pill bad"; }
    else if (!k.unlocked) { pill.textContent = "Key locked"; pill.className = "pill warn"; }
    else if (k.matches_build === false) { pill.textContent = "Key mismatch"; pill.className = "pill bad"; }
    else { pill.textContent = "Key unlocked"; pill.className = "pill ok"; }
    return k;
  } catch {
    pill.textContent = "Signed out"; pill.className = "pill bad";
  }
}

// ---------- views ----------
const licenseCols = [
  { label: "Recipient", render: (l) => h("div", {}, h("div", {}, l.recipient_name), h("div", { class: "muted mono" }, l.device_id)) },
  { label: "Issued", render: (l) => fmtDate(l.issued_on), cls: "nowrap" },
  { label: "Days", key: "days", num: true },
  { label: "Activated", render: (l) => (l.activated_on ? fmtDate(l.activated_on) : h("span", { class: "muted" }, `by ${fmtDate(l.activate_by)}`)), cls: "nowrap" },
  { label: "Expires", render: (l) => h("span", { class: l.soon ? "soon" : "" }, fmtDate(l.expires), l.status === "unconfirmed" || l.status === "awaiting" ? h("span", { class: "muted" }, " (latest)") : null), cls: "nowrap" },
  { label: "Left", render: (l) => (l.days_left == null ? "—" : `${l.days_left}d`), num: true },
  { label: "Status", render: (l) => badge(l.status, l.label) },
  { label: "Build", render: (l) => l.build_version || "—" },
  { label: "Amount", render: (l) => fmtMoney(l.amount, l.currency), num: true },
];

async function viewDashboard() {
  const s = await api("/api/summary");
  const max = Math.max(1, ...s.issued_by_month.map((m) => m.count));
  const tile = (label, value, sub, href) => h("a", { class: "tile", href: href || "#/licenses" }, h("div", { class: "l" }, label), h("div", { class: "v" }, value), sub ? h("div", { class: "s" }, sub) : null);
  const keyAlert = !s.keys.private_key_exists
    ? h("div", { class: "alert bad" }, "No signing key yet. Create it in ", h("a", { href: "#/tools" }, "Keys & tools"), " before issuing licences.")
    : !s.keys.unlocked ? h("div", { class: "alert warn" }, "Signing key is locked. ", h("a", { href: "#/tools" }, "Unlock it"), " to issue licences.") : null;
  render(
    h("h1", {}, "Dashboard"), h("p", { class: "sub" }, "Licences you have issued and the state of your builds."),
    keyAlert,
    h("div", { class: "tiles" },
      tile("Active", s.counts.active, "activation recorded", "#/licenses?status=active"),
      tile("Awaiting activation", s.counts.awaiting, "within activate-by", "#/licenses?status=awaiting"),
      tile("Activation not recorded", s.counts.unconfirmed, "past activate-by", "#/licenses?status=unconfirmed"),
      tile("Expiring ≤ 7 days", s.expiring_soon.length, null, "#/licenses?status=soon"),
      tile("Expired", s.counts.expired, null, "#/licenses?status=expired"),
      tile("Recipients", s.recipients, `${s.licenses} licences`, "#/recipients"),
      tile("Revenue", s.revenue.length ? s.revenue.map((r) => fmtMoney(r.amount, r.currency)).join(" · ") : "—", "recorded amounts", "#/licenses")),
    h("div", { class: "grid g2" },
      card("Expiring soon", "Contact these people about renewals", null,
        table(licenseCols.filter((c) => ["Recipient", "Expires", "Left", "Status"].includes(c.label)), s.expiring_soon, (l) => openLicense(l.id))),
      card("Licences issued per month", "Last 12 months", null,
        h("div", { class: "bars" }, s.issued_by_month.map((m) => h("div", { class: "bar-row", title: `${m.count} issued in ${m.label}` },
          h("span", { class: "muted" }, m.label),
          h("div", { class: "bar-track" }, h("div", { class: "bar", style: { width: `${(m.count / max) * 100}%` } })),
          h("span", { class: "num" }, m.count)))))),
    card("Recently issued", null, h("a", { class: "btn", href: "#/issue" }, "Issue licence"), table(licenseCols, s.recent, (l) => openLicense(l.id))),
    card("Last build", null, h("a", { class: "btn", href: "#/builds" }, "Builds"),
      s.last_build ? h("dl", { class: "kv" },
        h("dt", {}, "Version"), h("dd", {}, s.last_build.version, " ", badge(s.last_build.status)),
        h("dt", {}, "Started"), h("dd", {}, fmtDateTime(s.last_build.started_at)),
        h("dt", {}, "Installer"), h("dd", { class: "mono" }, s.last_build.installer_path || "—"),
        h("dt", {}, "SHA-256"), h("dd", { class: "mono" }, s.last_build.sha256 || "—")) : h("div", { class: "empty" }, "No builds yet.")),
  );
}

async function viewLicenses(params) {
  const status = params.get("status") || "";
  const q = params.get("q") || "";
  const rows = await api(`/api/licenses?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
  const sel = h("select", { "aria-label": "Status", onchange: (e) => go(`#/licenses?status=${e.target.value}&q=${encodeURIComponent(search.value)}`) },
    [["", "All statuses"], ["active", "Active"], ["awaiting", "Awaiting activation"], ["unconfirmed", "Activation not recorded"], ["soon", "Expiring ≤ 7 days"], ["expired", "Expired"], ["revoked", "Revoked"]]
      .map(([v, l]) => h("option", { value: v, selected: v === status }, l)));
  const search = h("input", { type: "search", placeholder: "Search name, email, device, notes…", value: q, onkeydown: (e) => e.key === "Enter" && go(`#/licenses?status=${sel.value}&q=${encodeURIComponent(search.value)}`) });
  render(
    h("h1", {}, "Licences"), h("p", { class: "sub" }, "Every key you have issued. Click a row for the key, the message to send, and actions."),
    card(`${rows.length} licence${rows.length === 1 ? "" : "s"}`, null,
      [h("div", { style: { minWidth: "180px" } }, sel), h("div", { style: { minWidth: "240px" } }, search),
        h("a", { class: "btn", href: "/api/export/licenses.csv" }, "Export CSV"), h("a", { class: "btn", href: "#/issue" }, "Issue licence")],
      table(licenseCols, rows, (l) => openLicense(l.id))),
  );
}

async function openLicense(id) {
  const l = await api(`/api/licenses/${id}`);
  const actDate = h("input", { type: "date", min: l.issued_on, max: l.activate_by, value: l.activated_on || "" });
  const notes = h("textarea", { value: l.notes || "" });
  const amount = h("input", { type: "number", min: "0", step: "any", value: l.amount ?? "" });
  const currency = h("input", { value: l.currency || "INR", maxlength: "8" });
  const save = async (body, msg) => {
    try { await api(`/api/licenses/${id}`, { method: "PATCH", body }); toast(msg); close(); route(); } catch (e) { toast(e.message, true); }
  };
  const close = modal(`Licence · ${l.recipient_name}`,
    h("dl", { class: "kv" },
      h("dt", {}, "Status"), h("dd", {}, badge(l.status, l.label), l.days_left != null ? ` ${l.days_left} days left` : ""),
      h("dt", {}, "Recipient"), h("dd", {}, l.recipient_name, l.recipient_email ? ` · ${l.recipient_email}` : ""),
      h("dt", {}, "Device ID"), h("dd", { class: "mono" }, l.device_id),
      h("dt", {}, "Licence ID"), h("dd", { class: "mono" }, l.license_id),
      h("dt", {}, "Validity"), h("dd", {}, `${l.days} days from activation`),
      h("dt", {}, "Issued / activate by"), h("dd", {}, `${fmtDate(l.issued_on)} / ${fmtDate(l.activate_by)}`),
      h("dt", {}, "Latest possible expiry"), h("dd", {}, fmtDate(l.latest_expiry)),
      h("dt", {}, "Installer version"), h("dd", {}, l.build_version || "—"),
      h("dt", {}, "Source"), h("dd", {}, l.source === "imported" ? "Imported from CLI ledger" : "Issued in admin")),
    h("h2", { style: { margin: "16px 0 6px" } }, "Licence key"),
    h("div", { class: "keybox" }, l.key),
    h("div", { class: "actions", style: { marginTop: "8px" } },
      h("button", { onclick: () => copy(l.key, "Key copied") }, "Copy key"),
      h("button", { onclick: () => copy(l.message, "Message copied") }, "Copy message to send"),
      h("button", { onclick: () => { close(); go(`#/issue?renew=${l.id}`); } }, "Renew…")),
    h("h2", { style: { margin: "18px 0 6px" } }, "Records"),
    h("div", { class: "alert info" }, "Keys work offline, so the app can't report activations back to you. When the recipient confirms they activated it, record the date here for exact expiry tracking."),
    h("form", { onsubmit: (e) => e.preventDefault() },
      h("div", { class: "row" },
        field("Activated on", actDate, "(from the recipient)"),
        field("Amount", amount),
        field("Currency", currency)),
      field("Notes", notes),
      h("div", { class: "actions", style: { marginTop: "12px" } },
        h("button", { class: "primary", onclick: () => save({ activated_on: actDate.value || null, clear_activated_on: !actDate.value && !!l.activated_on, notes: notes.value, amount: amount.value === "" ? null : Number(amount.value), currency: currency.value || null }, "Saved") }, "Save"),
        h("button", { class: "danger", onclick: () => confirm(l.revoked ? "Mark as not revoked?" : "Mark this licence as revoked in your records?\n\nNote: offline keys keep working on the device until they expire; this only updates your records.") && save({ revoked: !l.revoked }, l.revoked ? "Revocation removed" : "Marked revoked") }, l.revoked ? "Undo revoke" : "Mark revoked"))),
  );
}

async function viewIssue(params) {
  const [recipients, builds, keys] = await Promise.all([api("/api/recipients"), api("/api/builds"), api("/api/keys")]);
  const renew = params.get("renew") ? await api(`/api/licenses/${params.get("renew")}`) : null;
  const versions = [...new Set(builds.builds.filter((b) => b.status === "succeeded").map((b) => b.version))];

  const recSel = h("select", {}, h("option", { value: "" }, "— New recipient —"),
    recipients.map((r) => h("option", { value: r.id, selected: renew && renew.recipient_id === r.id }, `${r.name}${r.email ? ` (${r.email})` : ""}`)));
  const newName = h("input", { placeholder: "Full name (shown in their app)", maxlength: "80" });
  const newEmail = h("input", { type: "email", placeholder: "optional" });
  const newPhone = h("input", { placeholder: "optional" });
  const newBox = h("div", { class: "row" }, field("Name", newName), field("Email", newEmail), field("Phone", newPhone));
  const device = h("input", { class: "mono", placeholder: "XXXXX-XXXXX-XXXXX-XXXXX", value: renew ? renew.device_id : "" });
  const days = h("input", { type: "number", min: "1", max: "3650", value: renew ? renew.days : 30 });
  const within = h("input", { type: "number", min: "1", max: "365", value: 14 });
  const build = h("input", { list: "versions", placeholder: versions[0] || "e.g. 1.0.0", value: versions[0] || "" });
  const amount = h("input", { type: "number", min: "0", step: "any", placeholder: "optional" });
  const currency = h("input", { value: "INR", maxlength: "8" });
  const notes = h("textarea", { placeholder: "optional", value: renew ? `Renewal of licence ${renew.license_id}` : "" });
  const summary = h("div", { class: "alert info" });
  const submit = h("button", { class: "primary", type: "submit", disabled: !keys.unlocked }, "Issue licence key");

  const update = () => {
    newBox.style.display = recSel.value ? "none" : "";
    const ab = addDays(today(), within.value || 0);
    summary.textContent = `Valid for ${days.value || "?"} days from activation on this one device. Must be activated by ${fmtDate(ab)}; it can never run past ${fmtDate(addDays(ab, days.value || 0))}.`;
  };
  [recSel, days, within].forEach((el) => el.addEventListener("input", update));
  update();

  const onSubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      const body = {
        device_id: device.value, days: Number(days.value), activate_within: Number(within.value),
        build_version: build.value || null, amount: amount.value === "" ? null : Number(amount.value), currency: currency.value || null,
        notes: notes.value || null, renewal_of: renew ? renew.id : null,
        ...(recSel.value ? { recipient_id: Number(recSel.value) } : { new_recipient: { name: newName.value, email: newEmail.value || null, phone: newPhone.value || null } }),
      };
      const l = await api("/api/licenses", { method: "POST", body });
      toast("Licence issued");
      go("#/licenses");
      openLicense(l.id);
    } catch (err) {
      toast(err.message, true);
      submit.disabled = !keys.unlocked;
    }
  };

  render(
    h("h1", {}, renew ? `Renew licence · ${renew.recipient_name}` : "Issue licence"),
    h("p", { class: "sub" }, "Creates a signed key for one device. Paste the Device ID the recipient sent you from the app's activation screen."),
    keys.unlocked ? null : h("div", { class: "alert warn" }, "Unlock the signing key first: ", h("a", { href: "#/tools" }, "Keys & tools"), "."),
    renew ? h("div", { class: "alert info" }, `A renewal counts from when it is activated. Issue it close to the current expiry (${fmtDate(renew.expires)}), or add the remaining days.`) : null,
    card("Licence details", null, null,
      h("form", { onsubmit: onSubmit },
        h("div", { class: "row" }, field("Recipient", recSel)),
        newBox,
        h("div", { class: "row" }, field("Device ID", device, "(from their activation screen)")),
        h("div", { class: "row" },
          h("div", {}, field("Valid for (days)", days, "from activation"),
            h("div", { class: "quick" }, [7, 30, 90, 180, 365].map((n) => h("button", { type: "button", onclick: () => { days.value = n; update(); } }, `${n}d`)))),
          field("Must activate within (days)", within),
          h("div", {}, field("Installer version sent", build), h("datalist", { id: "versions" }, versions.map((v) => h("option", { value: v }))))),
        h("div", { class: "row" }, field("Amount", amount), field("Currency", currency)),
        field("Notes", notes),
        h("div", { style: { marginTop: "14px" } }, summary),
        h("div", { class: "actions" }, submit, h("a", { class: "btn", href: "#/licenses" }, "Cancel")))),
  );
}

async function viewRecipients() {
  const rows = await api("/api/recipients");
  const name = h("input", { maxlength: "80", required: true });
  const email = h("input", { type: "email" });
  const phone = h("input", {});
  const add = async (e) => {
    e.preventDefault();
    try { await api("/api/recipients", { method: "POST", body: { name: name.value, email: email.value || null, phone: phone.value || null } }); toast("Recipient added"); route(); } catch (err) { toast(err.message, true); }
  };
  render(
    h("h1", {}, "Recipients"), h("p", { class: "sub" }, "People you have shared the app with."),
    card("Add recipient", null, null, h("form", { onsubmit: add }, h("div", { class: "row" }, field("Name", name), field("Email", email), field("Phone", phone)), h("button", { class: "primary", type: "submit" }, "Add"))),
    card(`${rows.length} recipient${rows.length === 1 ? "" : "s"}`, null, null,
      table([
        { label: "Name", key: "name" },
        { label: "Email", render: (r) => r.email || "—" },
        { label: "Phone", render: (r) => r.phone || "—" },
        { label: "Licences", key: "licenses", num: true },
        { label: "Devices", render: (r) => h("span", { class: "mono" }, (r.devices || "—").split(",").join("\n")) },
        { label: "Last issued", render: (r) => fmtDate(r.last_issued), cls: "nowrap" },
      ], rows, (r) => openRecipient(r.id))),
  );
}

async function openRecipient(id) {
  const r = await api(`/api/recipients/${id}`);
  const name = h("input", { value: r.name, maxlength: "80" });
  const email = h("input", { type: "email", value: r.email || "" });
  const phone = h("input", { value: r.phone || "" });
  const notes = h("textarea", { value: r.notes || "" });
  const close = modal(`Recipient · ${r.name}`,
    h("form", { onsubmit: async (e) => { e.preventDefault(); try { await api(`/api/recipients/${id}`, { method: "PUT", body: { name: name.value, email: email.value || null, phone: phone.value || null, notes: notes.value || null } }); toast("Saved"); close(); route(); } catch (err) { toast(err.message, true); } } },
      h("div", { class: "row" }, field("Name", name), field("Email", email), field("Phone", phone)),
      field("Notes", notes),
      h("div", { class: "actions", style: { marginTop: "12px" } }, h("button", { class: "primary", type: "submit" }, "Save"), h("button", { type: "button", onclick: () => { close(); go("#/issue"); } }, "Issue licence…"))),
    h("h2", { style: { margin: "18px 0 6px" } }, "Licences"),
    table(licenseCols.filter((c) => c.label !== "Recipient"), r.licenses, (l) => { close(); openLicense(l.id); }),
  );
}

let logTimer = null;
async function viewBuilds() {
  const data = await api("/api/builds");
  const version = h("input", { value: data.suggested_version, pattern: "\\d+\\.\\d+\\.\\d+" });
  const expiry = h("input", { type: "date" });
  const skip = h("input", { type: "checkbox" });
  const reuse = h("input", { type: "checkbox" });
  const noobf = h("input", { type: "checkbox" });
  const logEl = h("pre", { class: "log", "aria-live": "off" }, "Select a build to see its log.");
  const logTitle = h("h2", {}, "Build log");
  let offset = 0;
  let watching = null;

  const watch = async (id) => {
    clearTimeout(logTimer);
    if (watching !== id) { watching = id; offset = 0; logEl.textContent = ""; logTitle.textContent = `Build log · #${id}`; }
    try {
      const r = await api(`/api/builds/${id}/log?offset=${offset}`);
      if (r.text) {
        const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
        logEl.append(r.text);
        offset = r.offset;
        if (atBottom) logEl.scrollTop = logEl.scrollHeight;
      }
      if (r.status === "running") logTimer = setTimeout(() => watch(id), 1000);
      else if (data.running === id) route(); // finished: refresh history
    } catch (e) { logEl.append(`\n[${e.message}]`); }
  };

  const start = async (e) => {
    e.preventDefault();
    if (noobf.checked && !confirm("Builds without obfuscation must never be sent to anyone. Continue?")) return;
    try {
      const b = await api("/api/builds", { method: "POST", body: { version: version.value, hard_expiry: expiry.value || null, skip_backend: skip.checked, reuse_native: reuse.checked, no_obfuscate: noobf.checked } });
      toast(`Build #${b.id} started`);
      await route();
    } catch (err) { toast(err.message, true); }
  };

  render(
    h("h1", {}, "Builds"), h("p", { class: "sub" }, "Runs packaging\\build.ps1 on this computer and keeps a history of every installer."),
    card("New build", "The first build takes 20–40 minutes; keep this console running.", h("button", { onclick: () => api("/api/open/dist", { method: "POST" }).then(() => toast("Opened dist folder")) }, "Open dist folder"),
      h("form", { onsubmit: start },
        h("div", { class: "row" }, field("Version", version, "(MAJOR.MINOR.PATCH)"), field("Hard expiry", expiry, "(optional: this build stops on that date)")),
        h("div", { class: "row" },
          h("label", { class: "check" }, skip, "Skip backend (UI-only change)"),
          h("label", { class: "check" }, reuse, "Reuse compiled engine (bundling fix only)"),
          h("label", { class: "check" }, noobf, "No obfuscation (troubleshooting only)")),
        h("div", { class: "actions" },
          h("button", { class: "primary", type: "submit", disabled: !!data.running }, data.running ? "A build is running…" : "Start build"),
          data.running ? h("button", { type: "button", class: "danger", onclick: async () => { if (confirm("Cancel the running build?")) { await api("/api/builds/cancel", { method: "POST" }); toast("Cancelling…"); setTimeout(route, 1500); } } }, "Cancel build") : null))),
    h("section", { class: "card" }, h("div", { class: "card-h" }, logTitle), h("div", { class: "card-b" }, logEl)),
    card("History", null, null,
      table([
        { label: "#", key: "id", num: true },
        { label: "Version", key: "version" },
        { label: "Status", render: (b) => badge(b.status) },
        { label: "Started", render: (b) => fmtDateTime(b.started_at), cls: "nowrap" },
        { label: "Duration", render: (b) => fmtDur(b.duration_s), num: true },
        { label: "Size", render: (b) => fmtBytes(b.size_bytes), num: true },
        { label: "Hard expiry", render: (b) => fmtDate(b.hard_expiry) },
        { label: "Commit", render: (b) => h("span", { class: "mono" }, b.git_commit || "—") },
        { label: "SHA-256", render: (b) => (b.sha256 ? h("button", { class: "small", onclick: (e) => { e.stopPropagation(); copy(b.sha256, "SHA-256 copied"); } }, "Copy") : "—") },
      ], data.builds, (b) => watch(b.id))),
  );
  const focus = data.running || (data.builds[0] && data.builds[0].id);
  if (focus) watch(focus);
}

async function viewTools() {
  const k = await refreshKeyPill();
  const pass = h("input", { type: "password", autocomplete: "off", placeholder: k.encrypted ? "Passphrase" : "No passphrase set (leave empty)" });
  const keyArea = h("textarea", { class: "mono", placeholder: "PA1-…" });
  const verifyOut = h("div", {});
  const genPass = h("input", { type: "password", autocomplete: "new-password", minlength: "8" });
  const genPass2 = h("input", { type: "password", autocomplete: "new-password" });
  const genConfirm = h("input", { placeholder: "Type CREATE" });
  const audit = await api("/api/audit");

  const keyCard = !k.private_key_exists
    ? card("Create your signing key", "One time only. See PACKAGING.md A4.", null,
        h("div", { class: "alert warn" }, "This creates licensing\\keys\\private_key.pem and writes the public key into backend\\app\\licensing\\public_key.py. Back up the .pem file and passphrase offline; commit public_key.py; rebuild before issuing keys."),
        h("form", { onsubmit: async (e) => { e.preventDefault(); if (genPass.value !== genPass2.value) return toast("Passphrases differ", true); try { await api("/api/keys/generate", { method: "POST", body: { passphrase: genPass.value, confirm: genConfirm.value } }); toast("Key pair created and unlocked"); route(); } catch (err) { toast(err.message, true); } } },
          h("div", { class: "row" }, field("Passphrase", genPass, "(min 8 chars)"), field("Repeat passphrase", genPass2), field("Confirm", genConfirm)),
          h("button", { class: "primary", type: "submit" }, "Create key pair")))
    : card("Signing key", null, null,
        h("dl", { class: "kv" },
          h("dt", {}, "Private key"), h("dd", { class: "mono" }, k.private_key_path),
          h("dt", {}, "Protected by passphrase"), h("dd", {}, k.encrypted ? "Yes" : "No (consider re-creating it with a passphrase)"),
          h("dt", {}, "Public key in builds"), h("dd", {}, k.build_public_key_set ? h("span", { class: "mono" }, `${k.public_key_fingerprint}…`) : "Not set"),
          h("dt", {}, "Matches builds"), h("dd", {}, k.matches_build == null ? "Unlock to check" : k.matches_build ? "Yes" : h("strong", { style: { color: "var(--red)" } }, "NO: keys would be rejected by builds")),
          h("dt", {}, "State"), h("dd", {}, k.unlocked ? badge("active", "Unlocked for this session") : badge("unconfirmed", "Locked"))),
        h("form", { style: { marginTop: "14px" }, onsubmit: async (e) => { e.preventDefault(); try { await api(k.unlocked ? "/api/keys/lock" : "/api/keys/unlock", { method: "POST", body: { passphrase: pass.value } }); toast(k.unlocked ? "Locked" : "Unlocked"); route(); } catch (err) { toast(err.message, true); } } },
          k.unlocked ? null : h("div", { class: "row" }, field("Passphrase", pass)),
          h("button", { class: "primary", type: "submit" }, k.unlocked ? "Lock now" : "Unlock"),
          h("span", { class: "muted", style: { marginLeft: "10px", fontSize: "12px" } }, "The passphrase is never stored; the key stays in memory until you lock it or stop the console.")));

  render(
    h("h1", {}, "Keys & tools"), h("p", { class: "sub" }, "Signing key, key checker, import/export and the audit trail."),
    keyCard,
    h("div", { class: "grid g2" },
      card("Check a licence key", "Decodes a key and shows which licence it is.", null,
        field("Key", keyArea),
        h("div", { class: "actions", style: { marginTop: "10px" } }, h("button", { onclick: async () => {
          try {
            const r = await api("/api/verify", { method: "POST", body: { key: keyArea.value } });
            verifyOut.replaceChildren(r.valid
              ? h("div", { class: "alert ok" }, `Valid · ${r.payload.name} · device ${r.payload.device} · ${r.payload.days} days · issued ${r.payload.issued} · activate by ${r.payload.activate_by}`, r.license ? h("div", {}, h("a", { href: "#", onclick: (e) => { e.preventDefault(); openLicense(r.license.id); } }, "Open licence record")) : h("div", {}, "Not in this database (issued elsewhere or before the console)."))
              : h("div", { class: "alert bad" }, r.message));
          } catch (err) { toast(err.message, true); }
        } }, "Check")),
        h("div", { style: { marginTop: "10px" } }, verifyOut)),
      card("Import & export", null, null,
        h("p", { style: { marginTop: 0 } }, "Import keys issued earlier with licensing\\issue_license.py (licensing\\issued\\licenses.csv). Already-imported keys are skipped."),
        h("div", { class: "actions" },
          h("button", { onclick: async () => { try { const r = await api("/api/import-ledger", { method: "POST" }); toast(`Imported ${r.added}, skipped ${r.skipped}`); } catch (err) { toast(err.message, true); } } }, "Import CLI ledger"),
          h("a", { class: "btn", href: "/api/export/licenses.csv" }, "Export licences CSV"),
          h("button", { onclick: () => api("/api/open/data", { method: "POST" }).then(() => toast("Opened data folder")) }, "Open data folder")),
        h("p", { class: "muted", style: { fontSize: "12px" } }, "Back up admin\\data\\admin.db together with your private key: it is your only record of who has which licence."))),
    card("Audit trail", "Last 200 actions", null,
      table([{ label: "When", render: (a) => fmtDateTime(a.at), cls: "nowrap" }, { label: "Action", key: "action" }, { label: "Detail", render: (a) => a.detail || "" }], audit)),
  );
}

// ---------- router ----------
const routes = { dashboard: viewDashboard, licenses: viewLicenses, issue: viewIssue, recipients: viewRecipients, builds: viewBuilds, tools: viewTools };
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
async function route() {
  clearTimeout(logTimer);
  const [path, query] = (location.hash.slice(2) || "dashboard").split("?");
  const name = routes[path] ? path : "dashboard";
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#/${name}`));
  try {
    await routes[name](new URLSearchParams(query || ""));
  } catch (e) {
    render(h("div", { class: "alert bad" }, e.message));
  }
  refreshKeyPill();
}
window.addEventListener("hashchange", route);
route();
