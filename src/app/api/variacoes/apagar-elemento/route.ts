import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { gerarMascaraPng } from "@/lib/video";
import { apagarElementoDoVideo } from "@/lib/wavespeed";

export const runtime = "nodejs";
// A IA de remoção (WaveSpeedAI) demora, em média, ~161s pra processar — dá
// bastante folga em cima disso, dentro do limite de 300s do plano Hobby.
export const maxDuration = 280;

/**
 * Chamada UMA vez por vídeo enviado (não a cada variação gerada): recebe o
 * vídeo original + a região marcada pelo usuário como "isso aqui pode
 * apagar" (retângulo normalizado 0-1), manda pra IA de remoção de elemento e
 * devolve a URL do vídeo já editado (salvo no Blob, reaproveitável por todas
 * as variações que usarem esse vídeo como visual).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const videoUrl: string | undefined = body.videoUrl;
    const regiao: { x: number; y: number; w: number; h: number } | undefined = body.regiao;

    if (!videoUrl) {
      return NextResponse.json({ error: "Informe videoUrl." }, { status: 400 });
    }
    if (
      !regiao ||
      typeof regiao.x !== "number" ||
      typeof regiao.y !== "number" ||
      typeof regiao.w !== "number" ||
      typeof regiao.h !== "number" ||
      regiao.w <= 0 ||
      regiao.h <= 0
    ) {
      return NextResponse.json({ error: "Marque uma área válida pra apagar antes de aplicar." }, { status: 400 });
    }

    const respostaVideo = await fetch(videoUrl);
    if (!respostaVideo.ok) {
      return NextResponse.json({ error: "Falha ao buscar o vídeo original enviado." }, { status: 400 });
    }
    const videoBuffer = Buffer.from(await respostaVideo.arrayBuffer());

    const mascaraBuffer = await gerarMascaraPng(videoBuffer, regiao);
    const blobMascara = await put(`temp-mascara/${Date.now()}-mascara.png`, mascaraBuffer, {
      access: "public",
      contentType: "image/png",
    });

    // Usa a própria URL do vídeo original (já pública, subida antes pelo
    // navegador direto pro Blob) — não precisa subir os bytes de novo.
    const videoEditadoBuffer = await apagarElementoDoVideo({ videoUrl, maskUrl: blobMascara.url });

    const blobVideoEditado = await put(`historico/${Date.now()}-editado-ia.mp4`, videoEditadoBuffer, {
      access: "public",
      contentType: "video/mp4",
    });

    return NextResponse.json({ videoUrl: blobVideoEditado.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
