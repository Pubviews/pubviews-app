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
 * como "american football stadium", ela pode devolver como 1º resultado um
 * vídeo genérico de "sports"/atleta se não tiver muita coisa de futebol
 * americano especificamente no catálogo (foi o que aconteceu: o usuário pediu
 * futebol americano e recebeu um vídeo de basquete/alongamento). Como
 * mitigação (sem precisar de outra chamada de IA por vídeo, o que seria caro
 * e lento), pontua os primeiros resultados pela quantidade de
 * palavras-chave da busca que aparecem no slug da URL do vídeo (que é gerado
 * a partir do título/descrição real do vídeo no Pexels) e prefere o de maior
 * pontuação — só reordena dentro dos resultados retornados, nunca busca nada
 * fora deles.
 */
function escolherMelhorResultado(videos: VideoPexels[], termoBusca: string): VideoPexels | null {
  if (videos.length === 0) return null;
  const palavras = palavrasDeConteudo(termoBusca);
  if (palavras.length === 0) return videos[0];

  let melhor = videos[0];
  let melhorPontuacao = -1;
  videos.forEach((video, indice) => {
    const slug = (video.url || "").toLowerCase();
    const pontuacao = palavras.filter((p) => slug.includes(p)).length;
    // Em empate, mantém a ordem de relevância original do Pexels (o primeiro
    // com a maior pontuação encontrado vence, não o último).
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhor = video;
    }
    void indice;
  });
  return melhor;
}

/**
 * Busca um vídeo de banco (stock) no Pexels que combine com o termo, e devolve
 * a URL do arquivo de vídeo em qualidade HD (pronta para baixar).
 */
export async function buscarVideoStock(termo: string): Promise<{ url: string; largura: number; altura: number } | null> {
  const key = env.pexelsApiKey();
  const res = await fetch(
    // per_page maior (15, não mais 5) pra dar mais candidatos pra
    // escolherMelhorResultado comparar — sem isso, um resultado ruim em 1º
    // lugar nunca tinha alternativa nenhuma pra competir.
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(termo)}&per_page=15&orientation=portrait`,
    { headers: { Authorization: key } }
  );
  if (!res.ok) throw new Error(`Pexels erro ${res.status}`);
  const json = await res.json();
  const videos: VideoPexels[] = json.videos ?? [];
  const video = escolherMelhorResultado(videos, termo);
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
