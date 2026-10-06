"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const status = $("status");
  const keyBox = $("key");
  const activateBtn = $("activate");

  function show(kind, text) {
    status.className = `status ${kind}`;
    status.textContent = text;
  }

  function fmtDate(iso) {
    return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
  }

  async function load() {
    const info = await window.pa.info();
    if (!info) return;
    $("version").textContent = `${info.product} ${info.version}`;
    $("device").textContent = info.status.device_id || "Unavailable";
    show(info.status.state === "missing" ? "info" : "error", info.status.message);
  }

  $("copy").addEventListener("click", async () => {
    await window.pa.copy($("device").textContent.trim());
    $("copy").textContent = "Copied";
    setTimeout(() => ($("copy").textContent = "Copy"), 1500);
  });

  keyBox.addEventListener("input", () => {
    activateBtn.disabled = keyBox.value.replace(/\s/g, "").length < 20;
  });

  activateBtn.addEventListener("click", async () => {
    activateBtn.disabled = true;
    show("info", "Checking the licence key…");
    try {
      const r = await window.pa.activate(keyBox.value);
      if (r && r.valid) {
        show("ok", `Activated for ${r.licensee}. Valid until ${fmtDate(r.expires_at)} (${r.days_left} days). Opening the app…`);
        keyBox.disabled = true;
        return;
      }
      show("error", (r && r.message) || "Activation failed.");
    } catch (err) {
      show("error", `Activation failed: ${err.message}`);
    }
    activateBtn.disabled = false;
  });

  $("quit").addEventListener("click", () => window.pa.quit());
  load().catch((err) => show("error", `Could not read the licence status: ${err.message}`));
})();
