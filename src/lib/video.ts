import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
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

// Formatos de saída suportados: vertical (padrão, Stories/Reels) e quadrado
// (feed). Ambos usam a mesma largura — só a altura muda — então o botão de
// CTA (dimensionado em pixels absolutos) fica com o mesmo tamanho visual
// nos dois, e a margem em relação à base é recalculada proporcionalmente.
export type FormatoVideo = "vertical" | "quadrado";

const FORMATOS: Record<FormatoVideo, { largura: number; altura: number }> = {
  vertical: { largura: 1080, altura: 1920 },
  quadrado: { largura: 1080, altura: 1080 },
};

// Proporção original da margem inferior do botão (420px numa altura de 1920px).
const MARGEM_INFERIOR_PROPORCAO = 420 / 1920;

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

// ---------------------------------------------------------------------------
// Cor do botão de CTA: em vez de uma cor fixa, o botão usa uma cor de
// DESTAQUE (de uma paleta de cores clássicas de alta conversão) escolhida
// automaticamente pelo maior contraste contra a região do vídeo/imagem onde
// ele será sobreposto — assim ele sempre "salta aos olhos" em vez de se
// misturar com o fundo do criativo.
// ---------------------------------------------------------------------------

type CorRgb = [number, number, number];

interface OpcaoCorBotao {
  hex: string;
  bg: CorRgb;
  texto: string;
}

// Só cores vívidas de alta conversão entram na disputa por contraste — preto
// e branco puros ficam de fora de propósito: eles "vencem" o cálculo de
// contraste WCAG contra quase qualquer fundo de foto (por serem os extremos
// de luminância), o que faria o botão voltar a ser sempre preto/branco e
// perder a variação que o objetivo aqui é justamente ter.
const PALETA_CTA: OpcaoCorBotao[] = [
  { hex: "#ff6b00", bg: [255, 107, 0], texto: "#ffffff" }, // laranja
  { hex: "#00c853", bg: [0, 200, 83], texto: "#ffffff" }, // verde
  { hex: "#ffd600", bg: [255, 214, 0], texto: "#111111" }, // amarelo
  { hex: "#e53935", bg: [229, 57, 53], texto: "#ffffff" }, // vermelho
  { hex: "#2979ff", bg: [41, 121, 255], texto: "#ffffff" }, // azul
  { hex: "#7c4dff", bg: [124, 77, 255], texto: "#ffffff" }, // roxo
  { hex: "#ff4081", bg: [255, 64, 129], texto: "#ffffff" }, // rosa
];

// Usada apenas quando a amostragem de cor falha (ex: imagem corrompida) —
// nunca entra na disputa de contraste normal.
const COR_FALLBACK: OpcaoCorBotao = { hex: "#111111", bg: [17, 17, 17], texto: "#ffffff" };

function luminanciaRelativa([r, g, b]: CorRgb): number {
  const canal = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function razaoContraste(a: CorRgb, b: CorRgb): number {
  const la = luminanciaRelativa(a);
  const lb = luminanciaRelativa(b);
  const [maior, menor] = la > lb ? [la, lb] : [lb, la];
  return (maior + 0.05) / (menor + 0.05);
}

/**
 * Calcula a cor média de uma imagem/frame na região onde o botão de CTA vai
 * ficar sobreposto (centro, próximo à base), reduzindo-a a uma amostra
 * pequena para o cálculo ser rápido.
 */
async function corMediaRegiaoDoBotao(bufferImagem: Buffer): Promise<CorRgb> {
  const img = await loadImage(bufferImagem);
  const sx = img.width * 0.2;
  const sy = img.height * 0.68;
  const sw = img.width * 0.6;
  const sh = img.height * 0.28;

  const amostra = 32;
  const canvas = createCanvas(amostra, amostra);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, amostra, amostra);
  const { data } = ctx.getImageData(0, 0, amostra, amostra);

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n += 1;
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

// Contraste mínimo (razão WCAG) pra uma cor ser considerada "legível o
// suficiente" contra o fundo. Abaixo disso a cor fica de fora da disputa.
const CONTRASTE_MINIMO = 2.2;

/**
 * Escolhe uma cor do CTA entre as que têm contraste suficiente contra o
 * fundo, sorteando entre elas — em vez de sempre pegar a de MAIOR contraste.
 *
 * Por quê: como as cores da paleta têm luminâncias bem diferentes entre si
 * (amarelo é a mais "clara" de longe), e a maioria dos fundos de foto/vídeo
 * cai numa faixa de luminância média, a cor de luminância mais extrema
 * (amarelo) praticamente sempre vencia o cálculo de contraste — o botão
 * ficava sempre amarelo, o oposto da variedade que o objetivo aqui era ter.
 * Sortear entre as opções "boas o bastante" mantém a legibilidade (nenhuma
 * cor com contraste ruim é usada) e devolve a variação visual entre os
 * criativos gerados.
 */
function escolherCorDeMaiorContraste(corDeFundo: CorRgb): OpcaoCorBotao {
  const comContraste = PALETA_CTA.map((opcao) => ({
    opcao,
    contraste: razaoContraste(opcao.bg, corDeFundo),
  })).sort((a, b) => b.contraste - a.contraste);

  const qualificadas = comContraste.filter((c) => c.contraste >= CONTRASTE_MINIMO);
  // Se nenhuma bater o mínimo (fundo muito "do meio termo"), usa as 2 melhores
  // mesmo assim — ainda é melhor que travar numa cor fixa.
  const candidatas = qualificadas.length > 0 ? qualificadas : comContraste.slice(0, 2);

  const escolhida = candidatas[Math.floor(Math.random() * candidatas.length)];
  return escolhida.opcao;
}

/**
 * Extrai um frame (meio do vídeo) de um clipe, para servir de amostra de cor
 * — assim o botão também se adapta a criativos em vídeo, não só imagem.
 */
async function extrairFrameDoVideo(vidPath: string): Promise<Buffer | null> {
  const framePath = tmpFile("png");
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(vidPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .screenshots({
          timestamps: ["50%"],
          filename: path.basename(framePath),
          folder: path.dirname(framePath),
        });
    });
    const buf = await fs.readFile(framePath);
    return buf;
  } catch {
    return null;
  } finally {
    await fs.unlink(framePath).catch(() => {});
  }
}

/**
 * Desenha um botão de CTA (cantos arredondados, texto em negrito) como um
 * PNG com transparência, para sobrepor no vídeo — visual de botão de
 * verdade, com a cor escolhida automaticamente para contrastar com o
 * criativo em vez de uma cor fixa.
 */
function renderBotaoPng(texto: string, corFundo: string, corTexto: string): Buffer {
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

  ctx.fillStyle = corFundo;
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

  ctx.fillStyle = corTexto;
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
  /** "vertical" (1080x1920, padrão) ou "quadrado" (1080x1080). */
  formatoVideo?: FormatoVideo;
}

/**
 * Como encaixar o vídeo de origem no formato de saída:
 * - "cobrir" (padrão): preenche o quadro todo, cortando as bordas que sobram
 *   (bom pra vídeo de banco de imagens, onde não tem nada importante nas bordas).
 * - "conter": encaixa o vídeo inteiro sem cortar nada, com fundo desfocado
 *   preenchendo o resto (bom pro vídeo ORIGINAL do usuário, que pode ter
 *   texto/CTA já embutido na imagem — cortar cortaria esse texto também).
 */
export type AjusteDeQuadro = "cobrir" | "conter";

/**
 * Prepara o PNG do botão de CTA, escolhendo a cor de maior contraste contra
 * uma amostra do criativo (imagem estática ou frame do vídeo). Se a amostra
 * não estiver disponível por algum motivo, cai no preto como antes.
 */
async function prepararBotao(
  textoOverlay: string | undefined,
  amostraParaCor: Buffer | null
): Promise<string | null> {
  if (!textoOverlay) return null;

  let corEscolhida = COR_FALLBACK;
  if (amostraParaCor) {
    try {
      const corDeFundo = await corMediaRegiaoDoBotao(amostraParaCor);
      corEscolhida = escolherCorDeMaiorContraste(corDeFundo);
    } catch {
      // mantém o fallback preto se a amostragem falhar
    }
  }

  const botaoPath = tmpFile("png");
  await fs.writeFile(botaoPath, renderBotaoPng(textoOverlay, corEscolhida.hex, corEscolhida.texto));
  return botaoPath;
}

/**
 * Monta um vídeo vertical (1080x1920) a partir de UMA IMAGEM estática + narração,
 * com um leve efeito de zoom (Ken Burns) e, opcionalmente, um botão de CTA sobreposto.
 */
export async function montarVideoComImagem(
  opts: MontarVideoOpts & { imagemBuffer: Buffer }
): Promise<void> {
  const { largura: W, altura: H } = FORMATOS[opts.formatoVideo ?? "vertical"];
  const margemInferior = Math.round(H * MARGEM_INFERIOR_PROPORCAO);

  const imgPath = tmpFile("png");
  const audioPath = tmpFile("mp3");
  await fs.writeFile(imgPath, opts.imagemBuffer);
  await fs.writeFile(audioPath, opts.audioBuffer);
  const botaoPath = await prepararBotao(opts.textoOverlay, opts.imagemBuffer);

  const duration = await getAudioDuration(audioPath);
  const fps = 30;
  const totalFrames = Math.ceil(duration * fps);

  const filtros = [
    // Ajusta a imagem para preencher o formato de saída (crop central) antes do zoom.
    `[0:v]scale=${W * 1.5}:${H * 1.5}:force_original_aspect_ratio=increase,crop=${W * 1.5}:${H * 1.5}` +
      `,zoompan=z='min(zoom+0.0008,1.15)':d=${totalFrames}:s=${W}x${H}:fps=${fps}[zoomed]`,
  ];
  let lastLabel = "zoomed";

  if (botaoPath) {
    filtros.push(`[${lastLabel}][2:v]overlay=(main_w-overlay_w)/2:main_h-${margemInferior}[out]`);
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
  opts: MontarVideoOpts & { videoBuffer: Buffer; ajusteDeQuadro?: AjusteDeQuadro }
): Promise<void> {
  const { largura: W, altura: H } = FORMATOS[opts.formatoVideo ?? "vertical"];
  const margemInferior = Math.round(H * MARGEM_INFERIOR_PROPORCAO);
  const ajuste = opts.ajusteDeQuadro ?? "cobrir";

  const vidPath = tmpFile("mp4");
  const audioPath = tmpFile("mp3");
  await fs.writeFile(vidPath, opts.videoBuffer);
  await fs.writeFile(audioPath, opts.audioBuffer);

  const frameParaCor = await extrairFrameDoVideo(vidPath);
  const botaoPath = await prepararBotao(opts.textoOverlay, frameParaCor);

  const duration = await getAudioDuration(audioPath);

  const filtros =
    ajuste === "conter"
      ? [
          // Fundo: preenche o quadro todo (cortando) e desfoca, só pra não
          // deixar barras pretas feias nas laterais/topo-base.
          `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=30[fundo]`,
          // Primeiro plano: o vídeo INTEIRO, sem cortar nada (encolhe pra caber).
          `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[frente]`,
          `[fundo][frente]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,setpts=PTS-STARTPTS[cropped]`,
        ]
      : [
          `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setpts=PTS-STARTPTS[cropped]`,
        ];
  let lastLabel = "cropped";

  if (botaoPath) {
    filtros.push(`[${lastLabel}][2:v]overlay=(main_w-overlay_w)/2:main_h-${margemInferior}[out]`);
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
