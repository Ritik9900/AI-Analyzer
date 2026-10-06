import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, readJson, validationError } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

const updateSchema = z
  .object({
    avgBuyPrice: z.number().positive().finite().optional(),
    quantity: z.number().positive().finite().optional(),
  })
  .refine((v) => v.avgBuyPrice !== undefined || v.quantity !== undefined, "Nothing to update");

async function parseId(ctx: Ctx): Promise<number | null> {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const notFound = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";

export async function PATCH(req: Request, ctx: Ctx) {
  const id = await parseId(ctx);
  if (!id) return jsonError(400, "VALIDATION", "Invalid position id");
  const parsed = updateSchema.safeParse(await readJson(req));
  if (!parsed.success) return validationError(parsed.error);

  try {
    const position = await prisma.position.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ position });
  } catch (err) {
    if (notFound(err)) return jsonError(404, "NOT_FOUND", "Position not found");
    throw err;
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const id = await parseId(ctx);
  if (!id) return jsonError(400, "VALIDATION", "Invalid position id");
  try {
    await prisma.position.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (notFound(err)) return jsonError(404, "NOT_FOUND", "Position not found");
    throw err;
  }
}
