// Runs once when the Next.js server starts. In the packaged desktop app it prepares the local
// database before the first request; in development it does nothing.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.PA_PACKAGED === "1") {
    const { applyMigrations } = await import("@/lib/migrate");
    await applyMigrations();
  }
}
