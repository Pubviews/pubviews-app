import { NextRequest, NextResponse } from "next/server";
import { gerarNarracao } from "@/lib/elevenlabs";
import { gerarImagem, sugerirTermosDeBusca } from "@/lib/gemini";
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
      // O Pexels indexa o catálogo majoritariamente em inglês — buscar com a
      // descrição em português (ex: "curso de empilhadeira") costuma trazer
      // resultados aleatórios/sem relação. Por isso a descrição passa antes
      // pelo Gemini, que sugere palavras-chave em inglês pra busca.
      let termoBusca = descricaoVisual;
      try {
        const sugerido = await sugerirTermosDeBusca(descricaoVisual);
        if (sugerido) termoBusca = sugerido;
      } catch {
        // se a sugestão falhar, tenta a busca com a descrição original mesmo
      }

      const stock = await buscarVideoStock(termoBusca);
      if (!stock) {
        return NextResponse.json(
          {
            error: `Nenhum vídeo encontrado no Pexels para: "${termoBusca}". Tente outra descrição.`,
          },
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
