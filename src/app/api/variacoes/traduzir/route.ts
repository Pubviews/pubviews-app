import { NextRequest, NextResponse } from "next/server";
import { traduzirCriativo } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Traduz o roteiro (narração) e os elementos de texto do vídeo (CTA,
 * título, selo) de um card de variação pra um idioma alvo — usado pelo
 * botão "Traduzir" na tela de Variações, que cria um card novo (cópia) já
 * com os textos traduzidos (ver corpoDaGeracao/traduzirCard em page.tsx).
 * Não gera nenhum áudio/vídeo aqui — só traduz o texto; a narração nova é
 * gerada normalmente quando o usuário clicar em "Gerar vídeo" no card
 * traduzido, do mesmo jeito que qualquer outro card.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const texto: string = body.texto;
    const textoOverlay: string | undefined = typeof body.textoOverlay === "string" && body.textoOverlay.trim() ? body.textoOverlay : undefined;
    const tituloTopo: string | undefined = typeof body.tituloTopo === "string" && body.tituloTopo.trim() ? body.tituloTopo : undefined;
    const seloTexto: string | undefined = typeof body.seloTexto === "string" && body.seloTexto.trim() ? body.seloTexto : undefined;
    const idioma: string = body.idioma;

    if (!texto || typeof texto !== "string") {
      return NextResponse.json({ error: "Informe o roteiro (texto) a traduzir." }, { status: 400 });
    }
    if (!idioma || typeof idioma !== "string") {
      return NextResponse.json({ error: "Informe o idioma de destino (idioma)." }, { status: 400 });
    }

    const traduzido = await traduzirCriativo({ texto, textoOverlay, tituloTopo, seloTexto, idioma });
    return NextResponse.json(traduzido);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
