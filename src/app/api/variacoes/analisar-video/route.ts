import { NextRequest, NextResponse } from "next/server";
import { analisarVideoDeReferencia } from "@/lib/gemini";

export const runtime = "nodejs";
// Analisar o vídeo inteiro com a IA pode passar de 60s pra arquivos maiores —
// o plano Hobby da Vercel aceita até 300s, então dá margem de sobra aqui (o
// timeout interno da chamada pra Gemini, em gemini.ts, é o que garante que a
// função sempre devolve uma resposta em vez de ficar presa até esse limite
// ser atingido na marra).
export const maxDuration = 150;

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
    // sem o limite de tamanho de requisição das Vercel Functions. Timeout
    // próprio pra nunca ficar presa aqui indefinidamente se o Blob demorar.
    let resposta: Response;
    try {
      resposta = await fetch(videoUrl, { signal: AbortSignal.timeout(20000) });
    } catch (err) {
      const timeout = err instanceof Error && err.name === "TimeoutError";
      return NextResponse.json(
        {
          error: timeout
            ? "Demorou demais pra buscar o vídeo enviado (timeout). Tente de novo."
            : `Falha ao buscar o vídeo enviado: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 502 }
      );
    }
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
