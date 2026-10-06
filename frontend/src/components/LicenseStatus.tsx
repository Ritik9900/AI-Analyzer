"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Clock } from "lucide-react";
import { Alert, Badge, Button, Card, Stat } from "@/components/ui";
import { api } from "@/lib/client";

interface License {
  enforced: boolean;
  state: string;
  valid: boolean;
  message: string;
  device_id?: string | null;
  licensee?: string | null;
  expires_at?: string | null;
  days_left?: number | null;
  build_version?: string;
}

const WARN_DAYS = 7;

function useLicense(): [License | null, () => void] {
  const [lic, setLic] = useState<License | null>(null);
  const reload = useCallback(() => {
    api<License>("/api/license")
      .then(setLic)
      .catch(() => setLic(null));
  }, []);
  useEffect(reload, [reload]);
  return [lic, reload];
}

const fmtDay = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

/** Thin banner under the header when a licence is about to expire (desktop app only). */
export function LicenseBanner() {
  const [lic] = useLicense();
  if (!lic?.enforced || !lic.valid || lic.days_left == null || lic.days_left > WARN_DAYS) return null;
  return (
    <div role="status" className="border-b border-amber-200 bg-amber-50 text-amber-900">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-xs sm:px-6">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Your licence expires in {lic.days_left} day{lic.days_left === 1 ? "" : "s"} ({fmtDay(lic.expires_at)}). Contact the person who shared this app
        for a renewal key.
      </div>
    </div>
  );
}

/** Settings card with licence details (desktop app only). */
export function LicenseCard() {
  const [lic, reload] = useLicense();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (!lic?.enforced) return null;

  const activate = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<License>("/api/license", { method: "POST", body: JSON.stringify({ key }) });
      setResult(r.valid ? { ok: true, text: `New key active until ${fmtDay(r.expires_at)}.` } : { ok: false, text: r.message });
      if (r.valid) {
        setKey("");
        reload();
      }
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Licence"
      description="This copy is licensed to one device."
      actions={lic.valid ? <Badge tone="positive"><BadgeCheck className="h-3.5 w-3.5" /> Active</Badge> : <Badge tone="negative">{lic.state.replace(/_/g, " ")}</Badge>}
    >
      {!lic.valid && (
        <div className="mb-4">
          <Alert tone="negative">{lic.message}</Alert>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label="Licensed to" value={lic.licensee ?? "—"} />
        <Stat label="Expires" value={fmtDay(lic.expires_at)} sub={lic.days_left != null ? `${lic.days_left} days left` : undefined} />
        <Stat label="Device ID" value={<span className="font-mono text-xs">{lic.device_id ?? "—"}</span>} />
        <Stat label="App version" value={lic.build_version ?? "—"} />
      </dl>
      <div className="mt-5 border-t border-neutral-100 pt-4">
        <label htmlFor="renewal-key" className="text-xs font-medium text-neutral-700">
          Enter a new licence key (renewal)
        </label>
        <textarea
          id="renewal-key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          spellCheck={false}
          placeholder="PA1-…"
          className="mt-1.5 h-20 w-full resize-none rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200"
        />
        <div className="mt-2 flex items-center gap-3">
          <Button size="sm" onClick={activate} loading={busy} disabled={key.replace(/\s/g, "").length < 20}>
            Activate new key
          </Button>
          {result && <span className={result.ok ? "text-xs text-green-700" : "text-xs text-red-700"}>{result.text}</span>}
        </div>
      </div>
    </Card>
  );
}
