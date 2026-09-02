import { env } from "./env";

/**
 * Busca um vídeo de banco (stock) no Pexels que combine com o termo, e devolve
 * a URL do arquivo de vídeo em qualidade HD (pronta para baixar).
 */
export async function buscarVideoStock(termo: string): Promise<{ url: string; largura: number; altura: number } | null> {
  const key = env.pexelsApiKey();
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(termo)}&per_page=5&orientation=portrait`,
    { headers: { Authorization: key } }
  );
  if (!res.ok) throw new Error(`Pexels erro ${res.status}`);
  const json = await res.json();
  const video = json.videos?.[0];
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
