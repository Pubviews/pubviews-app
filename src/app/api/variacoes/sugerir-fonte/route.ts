import { NextRequest, NextResponse } from "next/server";
import { extrairFrameComoImagem, listarOpcoesDeFonte } from "@/lib/video";
import { sugerirFonteSemelhante } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Sugere, a partir de um frame do vídeo original, qual das fontes
 * disponíveis mais parece com a que já estava no criativo — usada só pra
 * pré-selecionar o seletor de fonte nos fluxos de reescrever/corrigir texto
 * (o usuário sempre pode trocar manualmente). Chamada de conveniência: se
 * falhar por qualquer motivo, quem chama simplesmente mantém "padrão" como
 * já era antes dessa função existir.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const videoUrl: string | undefined = body.videoUrl;
    if (!videoUrl) {
      return NextResponse.json({ error: "Informe videoUrl." }, { status: 400 });
    }

    const respostaVideo = await fetch(videoUrl);
    if (!respostaVideo.ok) {
      return NextResponse.json({ error: "Falha ao buscar o vídeo." }, { status: 400 });
    }
    const videoBuffer = Buffer.from(await respostaVideo.arrayBuffer());

    const frameBuffer = await extrairFrameComoImagem(videoBuffer);
    const fonte = await sugerirFonteSemelhante(frameBuffer.toString("base64"), "image/png", listarOpcoesDeFonte());

    return NextResponse.json({ fonte });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
