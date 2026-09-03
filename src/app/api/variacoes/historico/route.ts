import { NextRequest, NextResponse } from "next/server";
import { listarHistorico } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Lista o histórico de variações já geradas (mais recente primeiro).
 * Query params opcionais: limit, antesDoId (paginação), nicho (filtro).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit")) || 20;
    const antesDoId = Number(searchParams.get("antesDoId")) || undefined;
    const nicho = searchParams.get("nicho") || undefined;

    const itens = await listarHistorico({ limit, antesDoId, nicho });
    return NextResponse.json({ itens });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
