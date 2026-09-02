import { NextRequest, NextResponse } from "next/server";
import { analisarVideoDeReferencia } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

// Limite conservador pro vídeo enviado como referência: precisa caber no
// pedido em base64 enviado pra API do Gemini (a Gemini recomenda usar a File
// API acima de ~20MB inline) e no corpo da requisição HTTP.
const TAMANHO_MAXIMO_BYTES = 18 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const videoBase64: string = body.videoBase64;
    const mimeType: string = body.mimeType || "video/mp4";

    if (!videoBase64) {
      return NextResponse.json({ error: "Envie o vídeo (videoBase64)." }, { status: 400 });
    }

    const tamanhoAproximado = Math.ceil((videoBase64.length * 3) / 4);
    if (tamanhoAproximado > TAMANHO_MAXIMO_BYTES) {
      return NextResponse.json(
        {
          error: `Vídeo muito grande (~${(tamanhoAproximado / (1024 * 1024)).toFixed(
            1
          )}MB). Envie um arquivo de até ${(TAMANHO_MAXIMO_BYTES / (1024 * 1024)).toFixed(0)}MB (tente comprimir ou cortar o vídeo).`,
        },
        { status: 413 }
      );
    }

    const analise = await analisarVideoDeReferencia(videoBase64, mimeType);
    return NextResponse.json(analise);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
