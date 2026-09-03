import { NextRequest, NextResponse } from "next/server";
import { gerarNarracao } from "@/lib/elevenlabs";
import { gerarImagem, sugerirTermosDeBusca } from "@/lib/gemini";
import { buscarVideoStock, baixarVideo } from "@/lib/pexels";
import { montarVideoComImagem, montarVideoComVideo, novoArquivoDeSaida, type AnimacaoCta } from "@/lib/video";
import { promises as fs } from "fs";
import { put } from "@vercel/blob";
import { salvarNoHistorico } from "@/lib/db";

export const runtime = "nodejs";
// Gera narração + visual UMA vez e renderiza DOIS vídeos com ffmpeg — mais
// pesado que a rota de formato único, então precisa de ainda mais margem.
// Confirmado nos logs da Vercel: vários "Task timed out after 60 seconds"
// nesta rota. O plano Hobby aceita até 300s.
export const maxDuration = 290;

const encoder = new TextEncoder();

const ANIMACOES_CTA_VALIDAS = new Set<AnimacaoCta>(["estatico", "pulsar", "piscar"]);
function lerAnimacaoCta(valor: unknown): AnimacaoCta {
  return ANIMACOES_CTA_VALIDAS.has(valor as AnimacaoCta) ? (valor as AnimacaoCta) : "estatico";
}

/**
 * Igual à rota /api/variacoes/gerar, mas gera a narração e o material visual
 * (imagem ou vídeo stock) UMA vez só e monta as DUAS versões finais do vídeo
 * a partir deles — 1080x1920 (vertical) e 1080x1080 (quadrado) — sem gastar
 * cota das APIs de narração/imagem/vídeo duas vezes.
 *
 * Também em stream (NDJSON), pelo mesmo motivo da rota de formato único —
 * ver comentário lá.
 */
export async function POST(req: NextRequest) {
  const saidaVertical = novoArquivoDeSaida();
  const saidaQuadrado = novoArquivoDeSaida();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function emitir(evento: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(evento) + "\n"));
      }

      try {
        const body = await req.json();
        const texto: string = body.texto;
        const formato: "imagem" | "video" | "video_original" =
          body.formato === "video" ? "video" : body.formato === "video_original" ? "video_original" : "imagem";
        const descricaoVisual: string = body.descricaoVisual || texto;
        const textoOverlay: string | undefined = body.textoOverlay || undefined;
        const animacaoCta = lerAnimacaoCta(body.animacaoCta);
        const voiceId: string | undefined = body.voiceId || undefined;
        const videoOriginalUrl: string | undefined = body.videoOriginalUrl || undefined;
        const nicho: string | undefined = body.nicho || undefined;
        const referencia: string | undefined = body.referencia || undefined;

        if (!texto) {
          emitir({ tipo: "erro", error: "Informe o texto da narração (texto)." });
          return;
        }
        if (formato === "video_original" && !videoOriginalUrl) {
          emitir({
            tipo: "erro",
            error: "Formato 'video_original' escolhido, mas nenhum vídeo original foi enviado (videoOriginalUrl).",
          });
          return;
        }

        emitir({ tipo: "progresso", etapa: "narracao", mensagem: "Gerando narração...", pct: 5 });
        const audioBuffer = await gerarNarracao(texto, voiceId);

        if (formato === "imagem") {
          emitir({ tipo: "progresso", etapa: "visual", mensagem: "Gerando imagem com IA...", pct: 15 });
          const imagem = await gerarImagem(descricaoVisual);
          const imagemBuffer = Buffer.from(imagem.base64, "base64");
          emitir({ tipo: "progresso", etapa: "render", mensagem: "Renderizando os 2 formatos (vertical e quadrado)...", pct: 40 });
          await Promise.all([
            montarVideoComImagem({
              audioBuffer,
              imagemBuffer,
              textoOverlay,
              animacaoCta,
              saidaPath: saidaVertical,
              formatoVideo: "vertical",
            }),
            montarVideoComImagem({
              audioBuffer,
              imagemBuffer,
              textoOverlay,
              animacaoCta,
              saidaPath: saidaQuadrado,
              formatoVideo: "quadrado",
            }),
          ]);
        } else if (formato === "video_original") {
          emitir({ tipo: "progresso", etapa: "visual", mensagem: "Preparando o vídeo original...", pct: 15 });
          const respostaVideo = await fetch(videoOriginalUrl!);
          if (!respostaVideo.ok) {
            emitir({ tipo: "erro", error: "Falha ao buscar o vídeo original enviado." });
            return;
          }
          const videoBuffer = Buffer.from(await respostaVideo.arrayBuffer());
          emitir({ tipo: "progresso", etapa: "render", mensagem: "Renderizando os 2 formatos (vertical e quadrado)...", pct: 40 });
          // "conter" (sem cortar): o vídeo original pode ter texto/CTA já
          // embutido na imagem — cortar as bordas (modo padrão) cortaria esse
          // texto junto, deixando o resultado ruim (bug relatado pelo usuário).
          // Nunca desenha o botão de overlay aqui: o vídeo original já tem o
          // próprio CTA embutido na imagem, e sobrepor outro botão em cima
          // ficava com os dois se cruzando (outro bug relatado pelo usuário).
          await Promise.all([
            montarVideoComVideo({
              audioBuffer,
              videoBuffer,
              textoOverlay: undefined,
              saidaPath: saidaVertical,
              formatoVideo: "vertical",
              ajusteDeQuadro: "conter",
            }),
            montarVideoComVideo({
              audioBuffer,
              videoBuffer,
              textoOverlay: undefined,
              saidaPath: saidaQuadrado,
              formatoVideo: "quadrado",
              ajusteDeQuadro: "conter",
            }),
          ]);
        } else {
          // O Pexels indexa o catálogo majoritariamente em inglês — traduz a
          // descrição antes de buscar (mesma correção da rota de formato único).
          emitir({ tipo: "progresso", etapa: "visual", mensagem: "Buscando vídeo de banco de imagens...", pct: 15 });
          let termoBusca = descricaoVisual;
          try {
            const sugerido = await sugerirTermosDeBusca(descricaoVisual);
            if (sugerido) termoBusca = sugerido;
          } catch {
            // mantém a descrição original se a sugestão falhar
          }

          const stock = await buscarVideoStock(termoBusca);
          if (!stock) {
            emitir({ tipo: "erro", error: `Nenhum vídeo encontrado no Pexels para: "${termoBusca}". Tente outra descrição.` });
            return;
          }
          const videoBuffer = await baixarVideo(stock.url);
          emitir({ tipo: "progresso", etapa: "render", mensagem: "Renderizando os 2 formatos (vertical e quadrado)...", pct: 40 });
          await Promise.all([
            montarVideoComVideo({
              audioBuffer,
              videoBuffer,
              textoOverlay,
              animacaoCta,
              saidaPath: saidaVertical,
              formatoVideo: "vertical",
            }),
            montarVideoComVideo({
              audioBuffer,
              videoBuffer,
              textoOverlay,
              animacaoCta,
              saidaPath: saidaQuadrado,
              formatoVideo: "quadrado",
            }),
          ]);
        }

        emitir({ tipo: "progresso", etapa: "finalizando", mensagem: "Finalizando os 2 vídeos...", pct: 90 });
        const [bufVertical, bufQuadrado] = await Promise.all([
          fs.readFile(saidaVertical),
          fs.readFile(saidaQuadrado),
        ]);
        await Promise.all([fs.unlink(saidaVertical).catch(() => {}), fs.unlink(saidaQuadrado).catch(() => {})]);

        // Salva os 2 formatos no histórico (uma linha pra cada) — best-effort,
        // igual à rota de formato único (ver comentário lá).
        let historicoIdVertical: number | undefined;
        let historicoIdQuadrado: number | undefined;
        try {
          const [blobVertical, blobQuadrado] = await Promise.all([
            put(`historico/${Date.now()}-vertical.mp4`, bufVertical, { access: "public", contentType: "video/mp4" }),
            put(`historico/${Date.now()}-quadrado.mp4`, bufQuadrado, { access: "public", contentType: "video/mp4" }),
          ]);
          [historicoIdVertical, historicoIdQuadrado] = await Promise.all([
            salvarNoHistorico({ nicho, referencia, roteiro: texto, formato, formatoVideo: "vertical", videoUrl: blobVertical.url }),
            salvarNoHistorico({ nicho, referencia, roteiro: texto, formato, formatoVideo: "quadrado", videoUrl: blobQuadrado.url }),
          ]);
        } catch (errHistorico) {
          console.error("Falha ao salvar no histórico:", errHistorico);
        }

        emitir({
          tipo: "concluido",
          vertical: bufVertical.toString("base64"),
          quadrado: bufQuadrado.toString("base64"),
          historicoIdVertical,
          historicoIdQuadrado,
          pct: 100,
        });
      } catch (err) {
        await fs.unlink(saidaVertical).catch(() => {});
        await fs.unlink(saidaQuadrado).catch(() => {});
        const message = err instanceof Error ? err.message : String(err);
        emitir({ tipo: "erro", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
