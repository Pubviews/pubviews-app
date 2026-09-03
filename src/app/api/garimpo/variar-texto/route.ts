import { NextRequest, NextResponse } from "next/server";
import { gerarVariacoesDeTexto } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

const TIPOS_VALIDOS = new Set(["texto_principal", "titulo", "descricao"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const texto: string = body.texto;
    const tipo: string = body.tipo;
    const nicho: string = body.nicho || "";
    const quantidade: number = Math.min(Math.max(Number(body.quantidade) || 5, 1), 10);

    if (!texto || typeof texto !== "string") {
      return NextResponse.json({ error: "Informe o texto de referência (texto)." }, { status: 400 });
    }
    if (!TIPOS_VALIDOS.has(tipo)) {
      return NextResponse.json(
        { error: "tipo inválido — use texto_principal, titulo ou descricao." },
        { status: 400 }
      );
    }

    const variacoes = await gerarVariacoesDeTexto({
      texto,
      tipo: tipo as "texto_principal" | "titulo" | "descricao",
      nicho,
      quantidade,
    });
    return NextResponse.json({ variacoes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
