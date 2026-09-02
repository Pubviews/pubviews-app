import { NextRequest, NextResponse } from "next/server";
import { gerarVariacoesDeRoteiro } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const referencia: string = body.referencia;
    const nicho: string = body.nicho || "";
    const quantidade: number = Math.min(Math.max(Number(body.quantidade) || 3, 1), 6);

    if (!referencia) {
      return NextResponse.json({ error: "Descreva o criativo de referência (referencia)." }, { status: 400 });
    }

    const variacoes = await gerarVariacoesDeRoteiro({ referencia, nicho, quantidade });
    return NextResponse.json({ variacoes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
