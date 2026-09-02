import { NextRequest, NextResponse } from "next/server";
import { gerarVariacoesDeRoteiro, gerarVariacoesComVideoBase } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

interface VariacaoResposta {
  texto: string;
  usarVisualOriginal: boolean;
  descricaoVisual: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const referencia: string = body.referencia;
    const nicho: string = body.nicho || "";
    const quantidade: number = Math.min(Math.max(Number(body.quantidade) || 3, 1), 6);
    // Presente só quando o usuário analisou um vídeo próprio como referência —
    // nesse caso a IA decide, variação por variação, se reaproveita a cena
    // visual original ou gera uma nova (ver gerarVariacoesComVideoBase).
    const descricaoVisualOriginal: string = body.descricaoVisualOriginal || "";

    if (!referencia) {
      return NextResponse.json({ error: "Descreva o criativo de referência (referencia)." }, { status: 400 });
    }

    let variacoes: VariacaoResposta[];

    if (descricaoVisualOriginal) {
      const geradas = await gerarVariacoesComVideoBase({
        referencia,
        nicho,
        quantidade,
        descricaoVisualOriginal,
      });
      variacoes = geradas.length
        ? geradas
        : // fallback defensivo: se a IA não decidiu nada, trata como texto simples sem reaproveitar vídeo
          (await gerarVariacoesDeRoteiro({ referencia, nicho, quantidade })).map((texto) => ({
            texto,
            usarVisualOriginal: false,
            descricaoVisual: nicho || referencia,
          }));
    } else {
      const textos = await gerarVariacoesDeRoteiro({ referencia, nicho, quantidade });
      variacoes = textos.map((texto) => ({
        texto,
        usarVisualOriginal: false,
        descricaoVisual: nicho || referencia,
      }));
    }

    return NextResponse.json({ variacoes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
