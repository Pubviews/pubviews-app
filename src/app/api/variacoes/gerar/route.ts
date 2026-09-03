import { NextRequest, NextResponse } from "next/server";
import { gerarNarracao } from "@/lib/elevenlabs";
import { gerarImagem, sugerirTermosDeBusca } from "@/lib/gemini";
import { buscarVideoStock, baixarVideo } from "@/lib/pexels";
import { montarVideoComImagem, montarVideoComVideo, novoArquivoDeSaida } from "@/lib/video";
import { promises as fs } from "fs";
import { put } from "@vercel/blob";
import { salvarNoHistorico } from "@/lib/db";

export const runtime = "nodejs";
// Gerar narração + baixar/gerar visual + renderizar com ffmpeg pode passar de
// 60s (principalmente vídeo original/stock) — o plano Hobby da Vercel aceita
// até 300s, então dá bastante margem (visto nos logs: vários timeouts reais
// de "Task timed out after 60 seconds" nesta rota e na de 2 formatos).
export const maxDuration = 280;

const encoder = new TextEncoder();

/**
 * Resposta em stream (NDJSON: uma linha JSON por evento) em vez de esperar
 * tudo terminar pra responder — assim o navegador consegue mostrar o
 * progresso real (narração -> visual -> render) em vez de um spinner cego
 * parado por até uns 2 minutos. Sempre HTTP 200; sucesso e erro viram
 * eventos {"tipo":"concluido",...} / {"tipo":"erro",...} dentro do stream.
 */
export async function POST(req: NextRequest) {
  const saidaPath = novoArquivoDeSaida();

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
        const voiceId: string | undefined = body.voiceId || undefined;
        // URL do Vercel Blob (não os bytes direto) — o upload já aconteceu do
        // navegador pro Blob, então aqui só busca o arquivo, sem esbarrar no
        // limite de tamanho de requisição das Vercel Functions (~4.5MB).
        const videoOriginalUrl: string | undefined = body.videoOriginalUrl || undefined;
        // Só pra salvar no histórico (não afetam a geração em si).
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
          emitir({ tipo: "progresso", etapa: "visual", mensagem: "Gerando imagem com IA...", pct: 20 });
          const imagem = await gerarImagem(descricaoVisual);
          const imagemBuffer = Buffer.from(imagem.base64, "base64");
          emitir({ tipo: "progresso", etapa: "render", mensagem: "Montando o vídeo...", pct: 55 });
          await montarVideoComImagem({ audioBuffer, imagemBuffer, textoOverlay, saidaPath });
        } else if (formato === "video_original") {
          // Reaproveita o vídeo original enviado pelo usuário como visual — só a
          // narração é nova, a cena continua sendo a do criativo vencedor de
          // verdade (não busca nada no Pexels nem gera imagem).
          emitir({ tipo: "progresso", etapa: "visual", mensagem: "Preparando o vídeo original...", pct: 20 });
          const respostaVideo = await fetch(videoOriginalUrl!);
          if (!respostaVideo.ok) {
            emitir({ tipo: "erro", error: "Falha ao buscar o vídeo original enviado." });
            return;
          }
          const videoBuffer = Buffer.from(await respostaVideo.arrayBuffer());
          emitir({ tipo: "progresso", etapa: "render", mensagem: "Montando o vídeo...", pct: 55 });
          // "conter" (sem cortar): o vídeo original pode ter texto/CTA já
          // embutido na imagem — cortar as bordas (modo padrão) cortaria esse
          // texto junto, deixando o resultado ruim (bug relatado pelo usuário).
          // Nunca desenha o botão de overlay aqui: o vídeo original já tem o
          // próprio CTA embutido na imagem, e sobrepor outro botão em cima
          // ficava com os dois se cruzando (outro bug relatado pelo usuário).
          await montarVideoComVideo({ audioBuffer, videoBuffer, textoOverlay: undefined, saidaPath, ajusteDeQuadro: "conter" });
        } else {
          // O Pexels indexa o catálogo majoritariamente em inglês — buscar com a
          // descrição em português (ex: "curso de empilhadeira") costuma trazer
          // resultados aleatórios/sem relação. Por isso a descrição passa antes
          // pelo Gemini, que sugere palavras-chave em inglês pra busca.
          emitir({ tipo: "progresso", etapa: "visual", mensagem: "Buscando vídeo de banco de imagens...", pct: 20 });
          let termoBusca = descricaoVisual;
          try {
            const sugerido = await sugerirTermosDeBusca(descricaoVisual);
            if (sugerido) termoBusca = sugerido;
          } catch {
            // se a sugestão falhar, tenta a busca com a descrição original mesmo
          }

          const stock = await buscarVideoStock(termoBusca);
          if (!stock) {
            emitir({ tipo: "erro", error: `Nenhum vídeo encontrado no Pexels para: "${termoBusca}". Tente outra descrição.` });
            return;
          }
          const videoBuffer = await baixarVideo(stock.url);
          emitir({ tipo: "progresso", etapa: "render", mensagem: "Montando o vídeo...", pct: 55 });
          await montarVideoComVideo({ audioBuffer, videoBuffer, textoOverlay, saidaPath });
        }

        emitir({ tipo: "progresso", etapa: "finalizando", mensagem: "Finalizando...", pct: 95 });
        const videoFinal = await fs.readFile(saidaPath);
        await fs.unlink(saidaPath).catch(() => {});

        // Salva no histórico pra poder voltar depois/compartilhar — nunca
        // derruba a geração se isso falhar (banco fora do ar, não
        // configurado etc.): o usuário já tem o vídeo pronto de qualquer jeito.
        let historicoId: number | undefined;
        try {
          const blob = await put(`historico/${Date.now()}-vertical.mp4`, videoFinal, {
            access: "public",
            contentType: "video/mp4",
          });
          historicoId = await salvarNoHistorico({
            nicho,
            referencia,
            roteiro: texto,
            formato,
            formatoVideo: "vertical",
            videoUrl: blob.url,
          });
        } catch (errHistorico) {
          console.error("Falha ao salvar no histórico:", errHistorico);
        }

        emitir({ tipo: "concluido", videoBase64: videoFinal.toString("base64"), historicoId, pct: 100 });
      } catch (err) {
        await fs.unlink(saidaPath).catch(() => {});
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
