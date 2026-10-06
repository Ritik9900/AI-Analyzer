import type { Metadata } from "next";
import { LicenseCard } from "@/components/LicenseStatus";
import { SettingsForm } from "@/components/SettingsForm";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-neutral-500">AI features stay locked until a Gemini API key is saved.</p>
      </div>
      <div className="space-y-6">
        <SettingsForm />
        <div className="max-w-2xl">
          <LicenseCard />
        </div>
      </div>
    </>
  );
}
