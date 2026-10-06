import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";

/*
 * Applies prisma/migrations/*\/migration.sql to the local SQLite file in the packaged desktop app,
 * where the Prisma CLI is not shipped. Applied migrations are tracked in _pa_migrations, so new
 * migrations in future versions are applied on the next launch. Development keeps using
 * `npx prisma migrate deploy` (this runs only when PA_PACKAGED=1).
 */

function statements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) =>
      s
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

export async function applyMigrations(dir = process.env.PA_MIGRATIONS_DIR ?? path.join(process.cwd(), "prisma", "migrations")) {
  await prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "_pa_migrations" ("name" TEXT NOT NULL PRIMARY KEY, "applied_at" TEXT NOT NULL)',
  );
  const done = new Set((await prisma.$queryRawUnsafe<{ name: string }[]>('SELECT "name" FROM "_pa_migrations"')).map((r) => r.name));
  const folders = (await readdir(dir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const name of folders) {
    if (done.has(name)) continue;
    const sql = await readFile(path.join(dir, name, "migration.sql"), "utf8");
    for (const stmt of statements(sql)) await prisma.$executeRawUnsafe(stmt);
    await prisma.$executeRawUnsafe('INSERT INTO "_pa_migrations" ("name", "applied_at") VALUES (?, ?)', name, new Date().toISOString());
    console.log(`[migrate] applied ${name}`);
  }
}
