import { NextRequest, NextResponse } from "next/server";
import { gerarNarracao } from "@/lib/elevenlabs";
import { gerarImagem } from "@/lib/gemini";
import { buscarVideoStock, baixarVideo } from "@/lib/pexels";
import { montarVideoComImagem, montarVideoComVideo, novoArquivoDeSaida } from "@/lib/video";
import { promises as fs } from "fs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const saidaPath = novoArquivoDeSaida();
  try {
    const body = await req.json();
    const texto: string = body.texto;
    const formato: "imagem" | "video" = body.formato === "video" ? "video" : "imagem";
    const descricaoVisual: string = body.descricaoVisual || texto;
    const textoOverlay: string | undefined = body.textoOverlay || undefined;
    const voiceId: string | undefined = body.voiceId || undefined;

    if (!texto) {
      return NextResponse.json({ error: "Informe o texto da narração (texto)." }, { status: 400 });
    }

    const audioBuffer = await gerarNarracao(texto, voiceId);

    if (formato === "imagem") {
      const imagem = await gerarImagem(descricaoVisual);
      const imagemBuffer = Buffer.from(imagem.base64, "base64");
      await montarVideoComImagem({ audioBuffer, imagemBuffer, textoOverlay, saidaPath });
    } else {
      const stock = await buscarVideoStock(descricaoVisual);
      if (!stock) {
        return NextResponse.json(
          { error: `Nenhum vídeo encontrado no Pexels para: "${descricaoVisual}". Tente outra descrição.` },
          { status: 404 }
        );
      }
      const videoBuffer = await baixarVideo(stock.url);
      await montarVideoComVideo({ audioBuffer, videoBuffer, textoOverlay, saidaPath });
    }

    const videoFinal = await fs.readFile(saidaPath);
    await fs.unlink(saidaPath).catch(() => {});

    return new NextResponse(new Uint8Array(videoFinal), {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="variacao-${Date.now()}.mp4"`,
      },
    });
  } catch (err) {
    await fs.unlink(saidaPath).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
