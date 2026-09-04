import { env } from "./env";

// Cliente pro "Video Eraser" da WaveSpeedAI — remove de verdade um elemento
// do vídeo (ex: o botão/CTA embutido na imagem do criativo), usando uma
// máscara ESTÁTICA (mesma área em todos os frames — funciona bem porque o
// elemento que a gente quer tirar é um overlay parado, não um objeto em
// movimento). Diferente do retoque de cor/corte/vinheta em video.ts (que só
// disfarça visualmente o quadro inteiro), essa API apaga o pedaço marcado de
// verdade — só que é paga (~$0.02/s de vídeo) e demora (~161s em média), por
// isso é chamada só UMA vez por vídeo enviado (não a cada variação gerada) —
// ver /api/variacoes/apagar-elemento.
const WAVESPEED_API_BASE = "https://api.wavespeed.ai/api/v3";
const WAVESPEED_ERASER_PATH = "/wavespeed-ai/video-eraser";

// Timeout de espera pra não travar pra sempre uma função serverless (que já
// tem um limite de ~280-290s na Vercel) — dá uma folga de segurança em cima
// da média documentada de ~161s.
const TIMEOUT_ESPERA_MS = 260_000;
const INTERVALO_INICIAL_MS = 3_000;
const INTERVALO_MAXIMO_MS = 10_000;

interface RespostaSubmissao {
  data?: { id?: string; urls?: { get?: string } };
  id?: string;
  urls?: { get?: string };
}

interface RespostaStatus {
  data?: {
    status?: string;
    outputs?: string[];
  };
  status?: string;
  outputs?: string[];
}

function aguardar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Manda apagar uma região (máscara estática, imagem branco-sobre-preto) de um
 * vídeo já hospedado publicamente (video/maskUrl precisam ser URLs
 * acessíveis — usamos o próprio Vercel Blob pra isso), espera terminar
 * (fazendo polling) e devolve os bytes do vídeo já processado.
 */
export async function apagarElementoDoVideo(params: { videoUrl: string; maskUrl: string }): Promise<Buffer> {
  const apiKey = env.waveSpeedApiKey();

  const respostaSubmissao = await fetch(`${WAVESPEED_API_BASE}${WAVESPEED_ERASER_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ video: params.videoUrl, mask_image: params.maskUrl }),
  });

  if (!respostaSubmissao.ok) {
    const corpo = await respostaSubmissao.text().catch(() => "");
    throw new Error(`Falha ao enviar o vídeo pra IA de remoção (status ${respostaSubmissao.status}): ${corpo.slice(0, 300)}`);
  }

  const submissao: RespostaSubmissao = await respostaSubmissao.json();
  const idPredicao = submissao.data?.id || submissao.id;
  const urlDePolling = submissao.data?.urls?.get || submissao.urls?.get;
  const statusUrl = urlDePolling || (idPredicao ? `${WAVESPEED_API_BASE}/predictions/${idPredicao}/result` : null);

  if (!statusUrl) {
    throw new Error("A IA de remoção não devolveu um jeito de acompanhar o processamento (resposta inesperada).");
  }

  const inicio = Date.now();
  let intervalo = INTERVALO_INICIAL_MS;

  while (true) {
    if (Date.now() - inicio > TIMEOUT_ESPERA_MS) {
      throw new Error(
        "A remoção do elemento pela IA demorou demais e foi cancelada por segurança. Tente de novo — se persistir, tente com um vídeo mais curto."
      );
    }
    await aguardar(intervalo);
    intervalo = Math.min(intervalo * 1.3, INTERVALO_MAXIMO_MS);

    const respostaStatus = await fetch(statusUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!respostaStatus.ok) continue; // tenta de novo no próximo ciclo em vez de derrubar tudo por uma falha passageira

    const status: RespostaStatus = await respostaStatus.json();
    const dados = status.data || status;
    const situacao = dados.status;

    if (situacao === "completed") {
      const urlDeSaida = dados.outputs?.[0];
      if (!urlDeSaida) {
        throw new Error("A IA de remoção terminou o processamento mas não devolveu o vídeo resultante.");
      }
      const respostaVideo = await fetch(urlDeSaida);
      if (!respostaVideo.ok) {
        throw new Error("Falha ao baixar o vídeo já processado pela IA de remoção.");
      }
      return Buffer.from(await respostaVideo.arrayBuffer());
    }

    if (situacao === "failed" || situacao === "cancelled" || situacao === "timeout") {
      throw new Error(`A IA de remoção não conseguiu processar o vídeo (status: ${situacao}).`);
    }
    // "created" ou "processing" -> continua esperando no próximo ciclo do loop
  }
}
