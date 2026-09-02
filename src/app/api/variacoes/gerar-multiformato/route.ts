import { NextRequest, NextResponse } from "next/server";
import { gerarNarracao } from "@/lib/elevenlabs";
import { gerarImagem, sugerirTermosDeBusca } from "@/lib/gemini";
import { buscarVideoStock, baixarVideo } from "@/lib/pexels";
import { montarVideoComImagem, montarVideoComVideo, novoArquivoDeSaida } from "@/lib/video";
import { promises as fs } from "fs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Igual à rota /api/variacoes/gerar, mas gera a narração e o material visual
 * (imagem ou vídeo stock) UMA vez só e monta as DUAS versões finais do vídeo
 * a partir deles — 1080x1920 (vertical) e 1080x1080 (quadrado) — sem gastar
 * cota das APIs de narração/imagem/vídeo duas vezes.
 */
export async function POST(req: NextRequest) {
  const saidaVertical = novoArquivoDeSaida();
  const saidaQuadrado = novoArquivoDeSaida();
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
      await Promise.all([
        montarVideoComImagem({
          audioBuffer,
          imagemBuffer,
          textoOverlay,
          saidaPath: saidaVertical,
          formatoVideo: "vertical",
        }),
        montarVideoComImagem({
          audioBuffer,
          imagemBuffer,
          textoOverlay,
          saidaPath: saidaQuadrado,
          formatoVideo: "quadrado",
        }),
      ]);
    } else {
      // O Pexels indexa o catálogo majoritariamente em inglês — traduz a
      // descrição antes de buscar (mesma correção da rota de formato único).
      let termoBusca = descricaoVisual;
      try {
        const sugerido = await sugerirTermosDeBusca(descricaoVisual);
        if (sugerido) termoBusca = sugerido;
      } catch {
        // mantém a descrição original se a sugestão falhar
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
      await Promise.all([
        montarVideoComVideo({
          audioBuffer,
          videoBuffer,
          textoOverlay,
          saidaPath: saidaVertical,
          formatoVideo: "vertical",
        }),
        montarVideoComVideo({
          audioBuffer,
          videoBuffer,
          textoOverlay,
          saidaPath: saidaQuadrado,
          formatoVideo: "quadrado",
        }),
      ]);
    }

    const [bufVertical, bufQuadrado] = await Promise.all([
      fs.readFile(saidaVertical),
      fs.readFile(saidaQuadrado),
    ]);
    await Promise.all([fs.unlink(saidaVertical).catch(() => {}), fs.unlink(saidaQuadrado).catch(() => {})]);

    return NextResponse.json({
      vertical: bufVertical.toString("base64"),
      quadrado: bufQuadrado.toString("base64"),
    });
  } catch (err) {
    await fs.unlink(saidaVertical).catch(() => {});
    await fs.unlink(saidaQuadrado).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
