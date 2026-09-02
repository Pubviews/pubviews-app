import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const FONT_PATH = path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf");
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

function escreverTextoFiltro(texto: string): string {
  // Escapa caracteres especiais do filtro drawtext do ffmpeg.
  const escapado = texto
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")
    .replace(/%/g, "\\%");
  return escapado;
}

interface MontarVideoOpts {
  audioBuffer: Buffer;
  textoOverlay?: string;
  saidaPath: string;
}

/**
 * Monta um vídeo vertical (1080x1920) a partir de UMA IMAGEM estática + narração,
 * com um leve efeito de zoom (Ken Burns) e, opcionalmente, um texto sobreposto.
 */
export async function montarVideoComImagem(
  opts: MontarVideoOpts & { imagemBuffer: Buffer }
): Promise<void> {
  const imgPath = tmpFile("png");
  const audioPath = tmpFile("mp3");
  await fs.writeFile(imgPath, opts.imagemBuffer);
  await fs.writeFile(audioPath, opts.audioBuffer);

  const duration = await getAudioDuration(audioPath);
  const fps = 30;
  const totalFrames = Math.ceil(duration * fps);

  const filtros = [
    // Ajusta a imagem para preencher 1080x1920 (crop central) antes do zoom.
    `[0:v]scale=${W * 1.5}:${H * 1.5}:force_original_aspect_ratio=increase,crop=${W * 1.5}:${H * 1.5}` +
      `,zoompan=z='min(zoom+0.0008,1.15)':d=${totalFrames}:s=${W}x${H}:fps=${fps}[zoomed]`,
  ];
  let lastLabel = "zoomed";

  if (opts.textoOverlay) {
    const texto = escreverTextoFiltro(opts.textoOverlay);
    filtros.push(
      `[${lastLabel}]drawtext=fontfile=${FONT_PATH}:text='${texto}':fontsize=54:fontcolor=white:` +
        `box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-380:line_spacing=10:fix_bounds=1[out]`
    );
    lastLabel = "out";
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(imgPath)
      .inputOptions(["-loop 1"])
      .input(audioPath)
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

  const duration = await getAudioDuration(audioPath);

  const filtros = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setpts=PTS-STARTPTS[cropped]`,
  ];
  let lastLabel = "cropped";

  if (opts.textoOverlay) {
    const texto = escreverTextoFiltro(opts.textoOverlay);
    filtros.push(
      `[${lastLabel}]drawtext=fontfile=${FONT_PATH}:text='${texto}':fontsize=54:fontcolor=white:` +
        `box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-380:line_spacing=10:fix_bounds=1[out]`
    );
    lastLabel = "out";
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(vidPath)
      .inputOptions(["-stream_loop -1"])
      .input(audioPath)
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
}

export function novoArquivoDeSaida(): string {
  return tmpFile("mp4");
}
