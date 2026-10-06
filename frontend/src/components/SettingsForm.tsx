"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, KeyRound, Plus, Trash2, X } from "lucide-react";
import { Alert, Badge, Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/client";
import type { GeminiAttempt } from "@/lib/types";

interface PublicSettings {
  hasKey: boolean;
  keyHint: string | null;
  keyUnreadable: boolean;
  keyError: string | null;
  models: string[];
  modelsCustomised: boolean;
  defaultModels: string[];
}

interface TestResult {
  ok: boolean;
  model?: string;
  reason?: string;
  attempts: GeminiAttempt[];
}

export function SettingsForm() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [chain, setChain] = useState<string[]>([]);
  const [newModel, setNewModel] = useState("");
  const [discovered, setDiscovered] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "positive" | "negative"; text: string } | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const apply = (s: PublicSettings) => {
    setSettings(s);
    setChain(s.models);
  };

  useEffect(() => {
    api<PublicSettings>("/api/settings")
      .then(apply)
      .catch((e: Error) => setMessage({ tone: "negative", text: e.message }));
  }, []);

  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ tone: "negative", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const saveKey = (e: FormEvent) => {
    e.preventDefault();
    act("save-key", async () => {
      apply(await api<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify({ apiKey }) }));
      setApiKey("");
      setTest(null);
      setMessage({ tone: "positive", text: "API key saved (encrypted). Use “Test connection” to verify it." });
    });
  };

  const removeKey = () => {
    if (!window.confirm("Remove the saved Gemini API key? AI features will be locked.")) return;
    act("remove-key", async () => {
      apply(await api<PublicSettings>("/api/settings", { method: "DELETE" }));
      setTest(null);
      setMessage({ tone: "positive", text: "API key removed." });
    });
  };

  const runTest = () =>
    act("test", async () => {
      setTest(await api<TestResult>("/api/settings/test", { method: "POST" }));
    });

  const saveChain = (models: string[]) =>
    act("save-chain", async () => {
      apply(await api<PublicSettings>("/api/settings", { method: "PUT", body: JSON.stringify({ models }) }));
      setMessage({ tone: "positive", text: models.length ? "Model fallback chain saved." : "Model chain reset to defaults." });
    });

  const discover = () =>
    act("discover", async () => {
      setDiscovered((await api<{ models: string[] }>("/api/settings/models")).models);
    });

  const addModel = (m: string) => {
    const id = m.trim();
    if (id && !chain.includes(id)) setChain([...chain, id]);
    setNewModel("");
  };

  const move = (i: number, d: -1 | 1) => {
    const next = [...chain];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setChain(next);
  };

  const chainDirty = settings && chain.join(",") !== settings.models.join(",");

  return (
    <div className="max-w-2xl space-y-6">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <Card
        title="Gemini API key"
        description="Encrypted with APP_SECRET before it is stored in the local SQLite database. It is never sent to the browser."
        actions={
          settings &&
          (settings.hasKey ? (
            <Badge tone="positive">Saved ••••{settings.keyHint}</Badge>
          ) : settings.keyUnreadable ? (
            <Badge tone="warning">Unreadable</Badge>
          ) : (
            <Badge>Not set</Badge>
          ))
        }
      >
        {settings?.keyUnreadable && (
          <div className="mb-4">
            <Alert tone="warning">{settings.keyError}</Alert>
          </div>
        )}
        <form onSubmit={saveKey} className="flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={settings?.hasKey ? "Enter a new key to replace the saved one" : "Paste your Gemini API key"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="flex-1 font-mono"
            aria-label="Gemini API key"
          />
          <Button type="submit" disabled={!apiKey.trim()} loading={busy === "save-key"}>
            <KeyRound className="h-4 w-4" /> Save
          </Button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          Get a key from{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline">
            Google AI Studio
          </a>
          .
        </p>

        {settings?.hasKey && (
          <div className="mt-4 flex gap-2 border-t border-neutral-100 pt-4">
            <Button variant="secondary" onClick={runTest} loading={busy === "test"}>
              Test connection
            </Button>
            <Button variant="danger" onClick={removeKey} loading={busy === "remove-key"}>
              <Trash2 className="h-4 w-4" /> Remove key
            </Button>
          </div>
        )}

        {test && (
          <div className="mt-4 space-y-2">
            <Alert tone={test.ok ? "positive" : "negative"}>{test.ok ? `Connected. Answered by ${test.model}.` : test.reason}</Alert>
            <AttemptLog attempts={test.attempts} />
          </div>
        )}
      </Card>

      <Card
        title="Model fallback chain"
        description="Tried top to bottom. If a model is retired, rate-limited, overloaded or returns invalid output, the next one is used. If all fail, a rule-based strategy is shown instead."
        actions={settings?.modelsCustomised ? <Badge>Custom</Badge> : <Badge>Default</Badge>}
      >
        <ol className="space-y-1.5">
          {chain.map((m, i) => (
            <li key={m} className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-1.5 text-sm">
              <span className="num w-5 text-xs text-neutral-400">{i + 1}</span>
              <span className="flex-1 font-mono text-[13px]">{m}</span>
              <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" disabled={i === chain.length - 1} onClick={() => move(i, 1)} title="Move down">
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" disabled={chain.length === 1} onClick={() => setChain(chain.filter((x) => x !== m))} title="Remove">
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ol>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addModel(newModel);
          }}
          className="mt-3 flex gap-2"
        >
          <Input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="Add model id, e.g. gemini-2.5-pro" className="flex-1 font-mono" maxLength={80} />
          <Button type="submit" variant="secondary" disabled={!newModel.trim() || chain.length >= 10}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </form>

        {settings?.hasKey && (
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={discover} loading={busy === "discover"}>
              Discover models available to this key
            </Button>
            {discovered && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {discovered.length === 0 && <span className="text-xs text-neutral-500">No stable Gemini text models found.</span>}
                {discovered.map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={chain.includes(m)}
                    onClick={() => addModel(m)}
                    className="rounded border border-neutral-300 px-2 py-0.5 font-mono text-xs hover:bg-neutral-100 disabled:opacity-40"
                  >
                    + {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex gap-2 border-t border-neutral-100 pt-4">
          <Button onClick={() => saveChain(chain)} disabled={!chainDirty} loading={busy === "save-chain"}>
            Save chain
          </Button>
          <Button variant="secondary" onClick={() => saveChain([])} disabled={!settings?.modelsCustomised}>
            Reset to defaults
          </Button>
        </div>
      </Card>
    </div>
  );
}

function AttemptLog({ attempts }: { attempts: GeminiAttempt[] }) {
  if (!attempts.length) return null;
  return (
    <ul className="space-y-0.5 rounded-md bg-neutral-50 px-3 py-2 font-mono text-[11px] text-neutral-600">
      {attempts.map((a, i) => (
        <li key={i} className={a.ok ? "text-green-700" : undefined}>
          {a.ok ? "✓" : "✗"} {a.model}
          {a.error ? ` — ${a.error}` : ""}
        </li>
      ))}
    </ul>
  );
}
