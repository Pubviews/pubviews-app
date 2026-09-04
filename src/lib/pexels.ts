import { env } from "./env";

interface VideoPexels {
  url: string; // URL da página do vídeo no Pexels — o slug (ex: ".../american-football-player-1234/") reflete o conteúdo real, então dá pra usar como sinal de relevância (ver escolherMelhorResultado).
  video_files?: { link: string; quality: string; width: number; height: number; file_type: string }[];
}

/**
 * Extrai palavras "de conteúdo" (>= 3 letras) de um termo de busca, em minúsculo
 * — usada tanto pra pontuar a relevância dos resultados quanto derivada do
 * termo sugerido pelo Gemini (sugerirTermosDeBusca).
 */
function palavrasDeConteudo(termo: string): string[] {
  return termo
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3);
}

/**
 * A API do Pexels devolve os resultados já ordenados por relevância dela, mas
 * "relevância" pra ela é só correspondência textual ampla — pra uma busca
 * como "NFL stadium crowd", ela pode devolver como 1º resultado um vídeo
 * genérico de futebol comum (soccer)/atleta se não tiver muita coisa de
 * futebol americano especificamente no catálogo (foi o que aconteceu: o
 * usuário pediu futebol americano e recebeu vídeo de basquete/alongamento
 * numa vez, e de campo de futebol comum em outra). Como mitigação (sem
 * precisar de outra chamada de IA por vídeo, o que seria caro e lento),
 * pontua os primeiros resultados pela quantidade de palavras-chave da busca
 * que aparecem no slug da URL do vídeo (que é gerado a partir do
 * título/descrição real do vídeo no Pexels) e prefere o de maior pontuação —
 * só reordena dentro dos resultados retornados, nunca busca nada fora deles.
 */

/**
 * Pontua um vídeo pela quantidade de palavras-chave que aparecem no slug,
 * mas dando mais peso pras primeiras palavras — sugerirTermosDeBusca (Gemini)
 * já é instruído a colocar a palavra-chave MAIS específica primeiro (ex:
 * "NFL" antes de "stadium"/"crowd"), então um vídeo que bate com essa
 * palavra específica deve pesar mais que um que só bate com as genéricas
 * (sem isso, "stadium"+"crowd" batendo num vídeo de futebol comum podia
 * empatar ou vencer um vídeo de "NFL" que não menciona as outras duas).
 */
function pontuarPeloSlug(slug: string, palavras: string[]): number {
  // Peso EXPONENCIAL (não linear): a palavra mais específica (1ª) precisa
  // pesar mais que a SOMA de todas as outras juntas, senão um vídeo genérico
  // que bate com 2-3 palavras comuns (ex: "stadium"+"crowd") vence um vídeo
  // que bate só com a palavra específica (ex: "nfl") — foi exatamente esse
  // caso que passou batido com peso linear (testado com dados sintéticos).
  return palavras.reduce((soma, palavra, indice) => {
    const peso = 2 ** (palavras.length - 1 - indice);
    return slug.includes(palavra) ? soma + peso : soma;
  }, 0);
}

function escolherMelhorResultado(videos: VideoPexels[], termoBusca: string): { video: VideoPexels | null; pontuacao: number } {
  if (videos.length === 0) return { video: null, pontuacao: -1 };
  const palavras = palavrasDeConteudo(termoBusca);
  if (palavras.length === 0) return { video: videos[0], pontuacao: 0 };

  let melhor = videos[0];
  let melhorPontuacao = -1;
  for (const video of videos) {
    const slug = (video.url || "").toLowerCase();
    const pontuacao = pontuarPeloSlug(slug, palavras);
    // Em empate, mantém a ordem de relevância original do Pexels (o primeiro
    // com a maior pontuação encontrado vence, não o último).
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhor = video;
    }
  }
  return { video: melhor, pontuacao: melhorPontuacao };
}

async function buscarNoPexels(termo: string, key: string): Promise<VideoPexels[]> {
  const res = await fetch(
    // per_page maior (20, não mais 5) pra dar mais candidatos pra
    // escolherMelhorResultado comparar — sem isso, um resultado ruim em 1º
    // lugar nunca tinha alternativa nenhuma pra competir.
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(termo)}&per_page=20&orientation=portrait`,
    { headers: { Authorization: key } }
  );
  if (!res.ok) throw new Error(`Pexels erro ${res.status}`);
  const json = await res.json();
  return json.videos ?? [];
}

/**
 * Busca um vídeo de banco (stock) no Pexels que combine com o termo, e devolve
 * a URL do arquivo de vídeo em qualidade HD (pronta para baixar).
 */
export async function buscarVideoStock(termo: string): Promise<{ url: string; largura: number; altura: number } | null> {
  const key = env.pexelsApiKey();
  const videos = await buscarNoPexels(termo, key);
  let { video } = escolherMelhorResultado(videos, termo);

  // A palavra-chave mais específica (1ª — sugerirTermosDeBusca sempre coloca
  // a mais importante primeiro, ex: "nfl" antes de "stadium"/"crowd") não
  // aparece em NENHUM dos candidatos retornados pra busca combinada — sinal
  // de que a busca combinada (ex: "nfl stadium crowd game") diluiu demais a
  // relevância pro Pexels e ele devolveu só conteúdo genérico que bate com
  // as palavras mais comuns (stadium/crowd), sem achar nada do esporte
  // específico pedido (foi exatamente o que aconteceu: usuário pediu futebol
  // AMERICANO e recebeu futebol comum/basquete, ambos com "stadium"/"crowd"
  // batendo igual). Tenta de novo só com essa palavra específica sozinha —
  // busca mais estreita que pode achar o conteúdo de nicho que a combinada
  // não achou nos 20 primeiros resultados — e junta com os candidatos
  // originais antes de escolher de novo. Só entra aqui nesse caso ruim
  // específico, então não adiciona latência na maioria das gerações.
  const palavras = palavrasDeConteudo(termo);
  const maisEspecifica = palavras[0];
  const ninguemTemAMaisEspecifica =
    !!maisEspecifica && !videos.some((v) => (v.url || "").toLowerCase().includes(maisEspecifica));
  if (ninguemTemAMaisEspecifica && maisEspecifica !== termo.toLowerCase().trim()) {
    try {
      const videosAlternativos = await buscarNoPexels(maisEspecifica, key);
      const candidatos = [...videos, ...videosAlternativos];
      const melhorGeral = escolherMelhorResultado(candidatos, termo);
      if (melhorGeral.video) video = melhorGeral.video;
    } catch {
      // mantém o resultado da 1ª busca se a de fallback falhar
    }
  }

  if (!video) return null;

  const files: { link: string; quality: string; width: number; height: number; file_type: string }[] =
    video.video_files ?? [];
  const mp4Files = files.filter((f) => f.file_type === "video/mp4");
  const hd =
    mp4Files.find((f) => f.quality === "hd" && f.width <= 1080) ||
    mp4Files.sort((a, b) => a.width - b.width)[0];
  if (!hd) return null;

  return { url: hd.link, largura: hd.width, altura: hd.height };
}

export async function baixarVideo(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar vídeo do Pexels: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
