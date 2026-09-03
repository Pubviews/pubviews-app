import { NextRequest, NextResponse } from "next/server";
import { gerarNarracao } from "@/lib/elevenlabs";
import { gerarImagem, sugerirTermosDeBusca } from "@/lib/gemini";
import { buscarVideoStock, baixarVideo } from "@/lib/pexels";
import { montarVideoComImagem, montarVideoComVideo, novoArquivoDeSaida } from "@/lib/video";
import { promises as fs } from "fs";

export const runtime = "nodejs";
// Gerar narração + baixar/gerar visual + renderizar com ffmpeg pode passar de
// 60s (principalmente vídeo original/stock) — o plano Hobby da Vercel aceita
// até 300s, então dá bastante margem (visto nos logs: vários timeouts reais
// de "Task timed out after 60 seconds" nesta rota e na de 2 formatos).
export const maxDuration = 280;

export async function POST(req: NextRequest) {
  const saidaPath = novoArquivoDeSaida();
  try {
    const body = await req.json();
    const texto: string = body.texto;
    const formato: "imagem" | "video" | "video_original" =
      body.formato === "video" ? "video" : body.formato === "video_original" ? "video_original" : "imagem";
    const descricaoVisual: string = body.descricaoVisual || texto;
    const textoOverlay: string | undefined = body.textoOverlay || undefined;
    const voiceId: string | undefined = body.voiceId || undefined;
    // URL do Vercel Blob (não os bytes direto) — o upload já aconteceu do
    // navegador pro Blob, então aqui só busca o arquivo, sem esbarrar no
    // limite de tamanho de requisição das Vercel Functions (~4.5MB).
    const videoOriginalUrl: string | undefined = body.videoOriginalUrl || undefined;

    if (!texto) {
      return NextResponse.json({ error: "Informe o texto da narração (texto)." }, { status: 400 });
    }
    if (formato === "video_original" && !videoOriginalUrl) {
      return NextResponse.json(
        { error: "Formato 'video_original' escolhido, mas nenhum vídeo original foi enviado (videoOriginalUrl)." },
        { status: 400 }
      );
    }

    const audioBuffer = await gerarNarracao(texto, voiceId);

    if (formato === "imagem") {
      const imagem = await gerarImagem(descricaoVisual);
      const imagemBuffer = Buffer.from(imagem.base64, "base64");
      await montarVideoComImagem({ audioBuffer, imagemBuffer, textoOverlay, saidaPath });
    } else if (formato === "video_original") {
      // Reaproveita o vídeo original enviado pelo usuário como visual — a
      // narração e o CTA são os novos, a cena continua sendo a do criativo
      // vencedor de verdade (não busca nada no Pexels nem gera imagem).
      const respostaVideo = await fetch(videoOriginalUrl!);
      if (!respostaVideo.ok) {
        return NextResponse.json({ error: "Falha ao buscar o vídeo original enviado." }, { status: 502 });
      }
      const videoBuffer = Buffer.from(await respostaVideo.arrayBuffer());
      // "conter" (sem cortar): o vídeo original pode ter texto/CTA já
      // embutido na imagem — cortar as bordas (modo padrão) cortaria esse
      // texto junto, deixando o resultado ruim (bug relatado pelo usuário).
      await montarVideoComVideo({ audioBuffer, videoBuffer, textoOverlay, saidaPath, ajusteDeQuadro: "conter" });
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
