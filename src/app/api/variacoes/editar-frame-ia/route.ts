import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { obterDimensoesDoVideo, extrairFrameComoImagem, montarVideoEstaticoDeImagem } from "@/lib/video";
import { editarImagemComIA } from "@/lib/gemini";

export const runtime = "nodejs";
// IA de edição de IMAGEM (Gemini) é bem mais rápida que a de vídeo
// (WaveSpeedAI) — não deve chegar nem perto do limite de 300s do Hobby, mas
// deixa uma folga confortável mesmo assim.
export const maxDuration = 120;

/**
 * Caminho alternativo ao de apagar-elemento (WaveSpeedAI): pra quando o
 * "vídeo original" enviado é, na prática, uma imagem/card estático (sem
 * movimento de cena) — o usuário descreve em texto o que quer mudar (trocar
 * um ícone, mudar um texto etc.), opcionalmente com uma imagem de
 * referência do elemento novo, igual ele testaria num app de edição de
 * imagem por IA. A gente extrai um frame do vídeo, edita como IMAGEM
 * (categoria de IA muito mais precisa pra isso do que edição de vídeo), e
 * remonta um vídeo estático (mesma duração do original) com o resultado —
 * que fica no MESMO lugar (videoOriginalUrlEditado) usado pelo caminho da
 * WaveSpeedAI, então o resto do app nem precisa saber qual dos dois foi usado.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const videoUrl: string | undefined = body.videoUrl;
    const instrucao: string | undefined = typeof body.instrucao === "string" ? body.instrucao.trim() : undefined;
    const imagemReferenciaUrl: string | undefined = body.imagemReferenciaUrl || undefined;

    if (!videoUrl) {
      return NextResponse.json({ error: "Informe videoUrl." }, { status: 400 });
    }
    if (!instrucao) {
      return NextResponse.json({ error: "Descreva a alteração que você quer fazer." }, { status: 400 });
    }

    const respostaVideo = await fetch(videoUrl);
    if (!respostaVideo.ok) {
      return NextResponse.json({ error: "Falha ao buscar o vídeo original enviado." }, { status: 400 });
    }
    const videoBuffer = Buffer.from(await respostaVideo.arrayBuffer());

    const [dimensoes, frameBuffer] = await Promise.all([
      obterDimensoesDoVideo(videoBuffer),
      extrairFrameComoImagem(videoBuffer),
    ]);

    let imagemReferenciaBase64: string | undefined;
    let mimeTypeReferencia: string | undefined;
    if (imagemReferenciaUrl) {
      const respostaRef = await fetch(imagemReferenciaUrl);
      if (respostaRef.ok) {
        const bufRef = Buffer.from(await respostaRef.arrayBuffer());
        imagemReferenciaBase64 = bufRef.toString("base64");
        mimeTypeReferencia = respostaRef.headers.get("content-type") || "image/png";
      }
    }

    const editada = await editarImagemComIA({
      imagemBase64: frameBuffer.toString("base64"),
      mimeType: "image/png",
      instrucao,
      imagemReferenciaBase64,
      mimeTypeReferencia,
    });
    const imagemEditadaBuffer = Buffer.from(editada.base64, "base64");

    const videoResultado = await montarVideoEstaticoDeImagem(imagemEditadaBuffer, dimensoes.duracaoSegundos);

    const blobVideoEditado = await put(`historico/${Date.now()}-editado-imagem-ia.mp4`, videoResultado, {
      access: "public",
      contentType: "video/mp4",
    });

    return NextResponse.json({ videoUrl: blobVideoEditado.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
