import { NextRequest, NextResponse } from "next/server";
import { gerarNarracao } from "@/lib/elevenlabs";
import { gerarImagem, sugerirTermosDeBusca } from "@/lib/gemini";
import { buscarVideoStock, baixarVideo } from "@/lib/pexels";
import {
  montarVideoComImagem,
  montarVideoComVideo,
  novoArquivoDeSaida,
  type AnimacaoCta,
  type ElementosGraficos,
} from "@/lib/video";
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

const ANIMACOES_CTA_VALIDAS = new Set<AnimacaoCta>(["estatico", "pulsar", "piscar", "saltar"]);
function lerAnimacaoCta(valor: unknown): AnimacaoCta {
  return ANIMACOES_CTA_VALIDAS.has(valor as AnimacaoCta) ? (valor as AnimacaoCta) : "estatico";
}

/**
 * Lê os elementos gráficos extras (título/selo/seta — ver ElementosGraficos
 * em src/lib/video.ts), só usados no formato "video" (banco de imagens): o
 * usuário digita o texto/cor de cada um no front, tudo opcional e
 * independente entre si (cada um só entra se tiver o texto preenchido, ou —
 * no caso da seta — se o toggle tiver sido ligado).
 */
function lerElementosGraficos(valor: unknown): ElementosGraficos | undefined {
  if (!valor || typeof valor !== "object") return undefined;
  const v = valor as Record<string, unknown>;
  const elementos: ElementosGraficos = {};

  if (v.tituloTopo && typeof v.tituloTopo === "object") {
    const t = v.tituloTopo as Record<string, unknown>;
    const texto = typeof t.texto === "string" ? t.texto.trim() : "";
    if (texto) {
      elementos.tituloTopo = {
        texto,
        corTexto: typeof t.corTexto === "string" && t.corTexto ? t.corTexto : "#ffffff",
        corFundo: typeof t.corFundo === "string" && t.corFundo ? t.corFundo : "#111111",
        semFundo: t.semFundo === true,
      };
    }
  }
  if (v.selo && typeof v.selo === "object") {
    const s = v.selo as Record<string, unknown>;
    const texto = typeof s.texto === "string" ? s.texto.trim() : "";
    if (texto) {
      elementos.selo = {
        texto,
        corTexto: typeof s.corTexto === "string" && s.corTexto ? s.corTexto : "#ffffff",
        corFundo: typeof s.corFundo === "string" && s.corFundo ? s.corFundo : "#e53935",
        animacao: lerAnimacaoCta(s.animacao),
      };
    }
  }
  if (v.seta && typeof v.seta === "object") {
    const s = v.seta as Record<string, unknown>;
    elementos.seta = {
      cor: typeof s.cor === "string" && s.cor ? s.cor : "#ffd600",
      animacao: lerAnimacaoCta(s.animacao),
    };
  }

  return Object.keys(elementos).length > 0 ? elementos : undefined;
}

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
        const animacaoCta = lerAnimacaoCta(body.animacaoCta);
        // Só usados no formato "video" (banco de imagens) — ver lerElementosGraficos.
        const elementosGraficos = lerElementosGraficos(body.elementos);
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
          await montarVideoComImagem({ audioBuffer, imagemBuffer, textoOverlay, animacaoCta, saidaPath });
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
          // "conter" (sem cortar forte): o vídeo original pode ter texto/CTA já
          // embutido na imagem — cortar as bordas no modo padrão ("cobrir")
          // cortaria esse texto junto, deixando o resultado ruim (bug relatado
          // pelo usuário). Nunca desenha o botão de overlay aqui: o vídeo
          // original já tem o próprio CTA embutido na imagem, e sobrepor outro
          // botão em cima ficava com os dois se cruzando (outro bug relatado).
          // remixarVisual DESLIGADO: chegou a ficar ligado (retoque de
          // cor/contraste/matiz/vinheta sorteado a cada geração), mas o
          // usuário agora edita o vídeo original manualmente antes de subir
          // (via os fluxos de IA acima, na tela de variações) — então esse
          // retoque automático só atrapalhava (deixava o vídeo escuro por
          // cima de uma edição que já tinha sido feita com cuidado).
          await montarVideoComVideo({
            audioBuffer,
            videoBuffer,
            textoOverlay: undefined,
            saidaPath,
            ajusteDeQuadro: "conter",
            remixarVisual: false,
          });
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
          await montarVideoComVideo({
            audioBuffer,
            videoBuffer,
            textoOverlay,
            animacaoCta,
            saidaPath,
            elementos: elementosGraficos,
          });
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
