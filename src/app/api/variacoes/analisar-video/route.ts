import { NextRequest, NextResponse } from "next/server";
import { analisarVideoDeReferencia } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

// Limite pro que a Gemini aceita como vídeo inline (base64) numa chamada só.
const TAMANHO_MAXIMO_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const videoUrl: string = body.videoUrl;
    const mimeType: string = body.mimeType || "video/mp4";

    if (!videoUrl) {
      return NextResponse.json({ error: "Envie a URL do vídeo (videoUrl)." }, { status: 400 });
    }

    // O arquivo já está no Vercel Blob (upload feito direto do navegador,
    // sem passar pelo corpo desta função) — busca os bytes aqui no servidor,
    // sem o limite de tamanho de requisição das Vercel Functions.
    const resposta = await fetch(videoUrl);
    if (!resposta.ok) {
      return NextResponse.json({ error: `Falha ao buscar o vídeo enviado (${resposta.status}).` }, { status: 502 });
    }
    const arrayBuffer = await resposta.arrayBuffer();
    if (arrayBuffer.byteLength > TAMANHO_MAXIMO_BYTES) {
      return NextResponse.json(
        {
          error: `Vídeo muito grande (~${(arrayBuffer.byteLength / (1024 * 1024)).toFixed(
            1
          )}MB) pra IA analisar de uma vez. Envie um arquivo de até ${(TAMANHO_MAXIMO_BYTES / (1024 * 1024)).toFixed(
            0
          )}MB (tente comprimir ou cortar o vídeo).`,
        },
        { status: 413 }
      );
    }

    const videoBase64 = Buffer.from(arrayBuffer).toString("base64");
    const analise = await analisarVideoDeReferencia(videoBase64, mimeType);
    return NextResponse.json(analise);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
