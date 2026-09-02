import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const FONT_PATH = path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf");
const FONT_FAMILY = "PV Button Font";
let fontRegistrada = false;
function garantirFonteRegistrada() {
  if (!fontRegistrada) {
    GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
    fontRegistrada = true;
  }
}

const W = 1080;
const H = 1920;

function tmpFile(ext: string): string {
  return path.join(os.tmpdir(), `pv-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
}

async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration ?? 5);
    });
  });
}

/**
 * Desenha um botão de CTA (fundo escuro, cantos arredondados, texto branco em negrito)
 * como um PNG com transparência, para sobrepor no vídeo — visual de botão de verdade,
 * não uma barra de texto com fundo retangular.
 */
function renderBotaoPng(texto: string): Buffer {
  garantirFonteRegistrada();

  const fontSize = 46;
  const paddingX = 52;
  const paddingY = 30;
  const raio = 22;

  const medindo = createCanvas(10, 10).getContext("2d");
  medindo.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
  const larguraTexto = medindo.measureText(texto).width;

  const largura = Math.ceil(larguraTexto + paddingX * 2);
  const altura = Math.ceil(fontSize + paddingY * 2);

  const canvas = createCanvas(largura, altura);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.moveTo(raio, 0);
  ctx.lineTo(largura - raio, 0);
  ctx.arcTo(largura, 0, largura, raio, raio);
  ctx.lineTo(largura, altura - raio);
  ctx.arcTo(largura, altura, largura - raio, altura, raio);
  ctx.lineTo(raio, altura);
  ctx.arcTo(0, altura, 0, altura - raio, raio);
  ctx.lineTo(0, raio);
  ctx.arcTo(0, 0, raio, 0, raio);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, largura / 2, altura / 2 + 2);

  return canvas.toBuffer("image/png");
}

interface MontarVideoOpts {
  audioBuffer: Buffer;
  textoOverlay?: string;
  saidaPath: string;
}

async function prepararBotao(textoOverlay: string | undefined): Promise<string | null> {
  if (!textoOverlay) return null;
  const botaoPath = tmpFile("png");
  await fs.writeFile(botaoPath, renderBotaoPng(textoOverlay));
  return botaoPath;
}

/**
 * Monta um vídeo vertical (1080x1920) a partir de UMA IMAGEM estática + narração,
 * com um leve efeito de zoom (Ken Burns) e, opcionalmente, um botão de CTA sobreposto.
 */
export async function montarVideoComImagem(
  opts: MontarVideoOpts & { imagemBuffer: Buffer }
): Promise<void> {
  const imgPath = tmpFile("png");
  const audioPath = tmpFile("mp3");
  await fs.writeFile(imgPath, opts.imagemBuffer);
  await fs.writeFile(audioPath, opts.audioBuffer);
  const botaoPath = await prepararBotao(opts.textoOverlay);

  const duration = await getAudioDuration(audioPath);
  const fps = 30;
  const totalFrames = Math.ceil(duration * fps);

  const filtros = [
    // Ajusta a imagem para preencher 1080x1920 (crop central) antes do zoom.
    `[0:v]scale=${W * 1.5}:${H * 1.5}:force_original_aspect_ratio=increase,crop=${W * 1.5}:${H * 1.5}` +
      `,zoompan=z='min(zoom+0.0008,1.15)':d=${totalFrames}:s=${W}x${H}:fps=${fps}[zoomed]`,
  ];
  let lastLabel = "zoomed";

  if (botaoPath) {
    filtros.push(`[${lastLabel}][2:v]overlay=(main_w-overlay_w)/2:main_h-420[out]`);
    lastLabel = "out";
  }

  const cmd = ffmpeg().input(imgPath).inputOptions(["-loop 1"]).input(audioPath);
  if (botaoPath) cmd.input(botaoPath).inputOptions(["-loop 1"]);

  await new Promise<void>((resolve, reject) => {
    cmd
      .complexFilter(filtros, lastLabel)
      .outputOptions([
        "-map 1:a",
        `-t ${duration}`,
        "-c:v libx264",
        "-pix_fmt yuv420p",
        "-c:a aac",
        "-shortest",
      ])
      .save(opts.saidaPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });

  await fs.unlink(imgPath).catch(() => {});
  await fs.unlink(audioPath).catch(() => {});
  if (botaoPath) await fs.unlink(botaoPath).catch(() => {});
}

/**
 * Monta um vídeo vertical (1080x1920) a partir de um CLIPE DE VÍDEO (stock) + narração,
 * cortando/repetindo o clipe para bater com a duração do áudio.
 */
export async function montarVideoComVideo(
  opts: MontarVideoOpts & { videoBuffer: Buffer }
): Promise<void> {
  const vidPath = tmpFile("mp4");
  const audioPath = tmpFile("mp3");
  await fs.writeFile(vidPath, opts.videoBuffer);
  await fs.writeFile(audioPath, opts.audioBuffer);
  const botaoPath = await prepararBotao(opts.textoOverlay);

  const duration = await getAudioDuration(audioPath);

  const filtros = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setpts=PTS-STARTPTS[cropped]`,
  ];
  let lastLabel = "cropped";

  if (botaoPath) {
    filtros.push(`[${lastLabel}][2:v]overlay=(main_w-overlay_w)/2:main_h-420[out]`);
    lastLabel = "out";
  }

  const cmd = ffmpeg().input(vidPath).inputOptions(["-stream_loop -1"]).input(audioPath);
  if (botaoPath) cmd.input(botaoPath).inputOptions(["-loop 1"]);

  await new Promise<void>((resolve, reject) => {
    cmd
      .complexFilter(filtros, lastLabel)
      .outputOptions([
        "-map 1:a",
        `-t ${duration}`,
        "-c:v libx264",
        "-pix_fmt yuv420p",
        "-c:a aac",
        "-shortest",
      ])
      .save(opts.saidaPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });

  await fs.unlink(vidPath).catch(() => {});
  await fs.unlink(audioPath).catch(() => {});
  if (botaoPath) await fs.unlink(botaoPath).catch(() => {});
}

export function novoArquivoDeSaida(): string {
  return tmpFile("mp4");
}
