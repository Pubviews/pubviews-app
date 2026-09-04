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

// Opções de fonte pra "reescrever" um texto embutido no vídeo original (ver
// sobreporTextoNovo mais abaixo) — poucas opções, mas com "caras" bem
// diferentes entre si (não só pesos diferentes da mesma fonte), pra troca de
// fonte realmente mudar a aparência do criativo. Todas de licença OFL (uso
// comercial livre).
interface OpcaoDeFonte {
  arquivo: string;
  family: string;
  label: string;
}

const FONTES_TEXTO: Record<string, OpcaoDeFonte> = {
  padrao: { arquivo: "DejaVuSans-Bold.ttf", family: FONT_FAMILY, label: "Padrão (sem serifa)" },
  impacto: { arquivo: "Anton.ttf", family: "PV Anton", label: "Impacto (condensada, tipo cartaz)" },
  condensada: { arquivo: "BebasNeue.ttf", family: "PV Bebas", label: "Condensada (caixa alta)" },
  elegante: { arquivo: "PlayfairDisplay-Bold.ttf", family: "PV Playfair", label: "Elegante (serifada)" },
  moderna: { arquivo: "Poppins-Bold.ttf", family: "PV Poppins", label: "Moderna (arredondada)" },
};

let fontesTextoRegistradas = false;
function garantirFontesTextoRegistradas() {
  if (fontesTextoRegistradas) return;
  for (const opcao of Object.values(FONTES_TEXTO)) {
    if (opcao.family === FONT_FAMILY) continue; // já registrada por garantirFonteRegistrada()
    GlobalFonts.registerFromPath(path.join(process.cwd(), "public", "fonts", opcao.arquivo), opcao.family);
  }
  fontesTextoRegistradas = true;
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

// Posição vertical do selo e da seta no formato "vídeo stock" (ver
// montarVideoComVideo) — usuário relatou que os dois ficavam "quase no
// centro" do criativo com os valores antigos (seta a 48% da altura, selo
// 180px acima do CTA), longe demais da base onde o CTA de verdade fica.
const SELO_OFFSET_ACIMA_CTA_PX = 130;
const SETA_Y_PROPORCAO = 0.63;

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
 * Calcula a cor média de uma imagem/frame numa região (por padrão, a imagem
 * inteira), reduzindo-a a uma amostra pequena para o cálculo ser rápido.
 */
async function corMediaAmostra(
  bufferImagem: Buffer,
  regiao: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 1, h: 1 }
): Promise<CorRgb> {
  const img = await loadImage(bufferImagem);
  const sx = img.width * regiao.x;
  const sy = img.height * regiao.y;
  const sw = img.width * regiao.w;
  const sh = img.height * regiao.h;

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

/**
 * Calcula a cor média de uma imagem/frame na região onde o botão de CTA vai
 * ficar sobreposto (centro, próximo à base) — usa corMediaAmostra acima.
 */
async function corMediaRegiaoDoBotao(bufferImagem: Buffer): Promise<CorRgb> {
  return corMediaAmostra(bufferImagem, { x: 0.2, y: 0.68, w: 0.6, h: 0.28 });
}

function escurecer([r, g, b]: CorRgb, fator: number): CorRgb {
  return [Math.round(r * fator), Math.round(g * fator), Math.round(b * fator)];
}

function paraHexFfmpeg([r, g, b]: CorRgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `0x${h(r)}${h(g)}${h(b)}`;
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
function renderBotaoPng(texto: string, corFundo: string, corTexto: string, fontSize = 46): Buffer {
  garantirFonteRegistrada();

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

/**
 * Desenha uma seta apontando pra baixo (haste + ponta triangular), como um
 * PNG com transparência — elemento gráfico GENÉRICO (não tenta imitar nenhum
 * ícone/logo específico), pensado pra chamar atenção pro CTA/selo abaixo
 * dela num "vídeo stock" (fundo real do Pexels, sem o elemento embutido que
 * o vídeo original tinha). Um contorno escuro sutil garante leitura mesmo
 * sobre fundos claros.
 */
function renderSetaPng(cor: string, altura = 120): Buffer {
  const largura = Math.round(altura * 0.72);
  const espessuraHaste = Math.round(largura * 0.32);
  const alturaPonta = Math.round(altura * 0.42);

  const canvas = createCanvas(largura, altura);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = cor;
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(2, Math.round(largura * 0.05));
  ctx.lineJoin = "round";

  ctx.beginPath();
  // Haste (retângulo vertical, centralizado).
  const hasteX = (largura - espessuraHaste) / 2;
  const alturaHaste = altura - alturaPonta;
  ctx.moveTo(hasteX, 0);
  ctx.lineTo(hasteX + espessuraHaste, 0);
  ctx.lineTo(hasteX + espessuraHaste, alturaHaste);
  // Ponta triangular.
  ctx.lineTo(largura, alturaHaste);
  ctx.lineTo(largura / 2, altura);
  ctx.lineTo(0, alturaHaste);
  ctx.lineTo(hasteX, alturaHaste);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  return canvas.toBuffer("image/png");
}

/**
 * Desenha uma faixa (banner) de texto de largura fixa — pensada pro título
 * no topo do vídeo (ex: "APP TO WATCH NFL LIVE") num "vídeo stock". Sempre
 * estática (sem animação): título costuma ficar melhor parado, é o
 * selo/seta abaixo dele que chamam o movimento.
 *
 * `semFundo`: variação sem a faixa colorida atrás — só o texto "flutuando"
 * direto por cima do vídeo (pedido do usuário, pra poder testar as duas
 * versões). Sem uma cor sólida atrás pra garantir contraste, o texto ganha
 * um contorno escuro (stroke) grosso o bastante pra continuar legível em
 * cima de qualquer cena do vídeo, clara ou escura.
 */
function renderFaixaDeTextoPng(texto: string, corTexto: string, corFundo: string, largura: number, semFundo = false): Buffer {
  garantirFonteRegistrada();

  const altura = Math.round(largura * 0.12);
  const paddingX = Math.round(largura * 0.06);
  const larguraMax = largura - paddingX * 2;

  let fontSize = Math.round(altura * 0.5);
  const medindo = createCanvas(10, 10).getContext("2d");
  while (fontSize > 10) {
    medindo.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
    if (medindo.measureText(texto).width <= larguraMax) break;
    fontSize -= 1;
  }

  const canvas = createCanvas(largura, altura);
  const ctx = canvas.getContext("2d");

  if (!semFundo) {
    ctx.fillStyle = corFundo;
    ctx.fillRect(0, 0, largura, altura);
  }

  ctx.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (semFundo) {
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.16));
    ctx.strokeText(texto, largura / 2, altura / 2 + 2, larguraMax);
  }
  ctx.fillStyle = corTexto;
  ctx.fillText(texto, largura / 2, altura / 2 + 2, larguraMax);

  return canvas.toBuffer("image/png");
}

interface MontarVideoOpts {
  audioBuffer: Buffer;
  textoOverlay?: string;
  saidaPath: string;
  /** "vertical" (1080x1920, padrão) ou "quadrado" (1080x1080). */
  formatoVideo?: FormatoVideo;
  /** Animação do botão de CTA — "estatico" (padrão) quando não informado. */
  animacaoCta?: AnimacaoCta;
}

/**
 * Elementos gráficos extras, opcionais, só usados no fluxo de "vídeo stock"
 * (ver montarVideoComVideo + gerar/route.ts) — pensados pra repor, com
 * formas/textos GENÉRICOS desenhados pelo nosso próprio motor (nunca por IA
 * generativa, pelo mesmo motivo de tudo mais nesse app: precisão de texto),
 * o tipo de elemento que o vídeo ORIGINAL tinha embutido na imagem (título,
 * selo "LIVE", seta) e que um vídeo de banco de imagens não tem.
 */
export interface ElementosGraficos {
  /** Faixa de texto no topo (ex: título do anúncio) — sempre estática. */
  tituloTopo?: { texto: string; corTexto: string; corFundo: string; semFundo?: boolean };
  /** Selo tipo "LIVE" (mesmo visual do botão de CTA, só que menor). */
  selo?: { texto: string; corTexto: string; corFundo: string; animacao: AnimacaoCta };
  /** Seta apontando pra baixo, do lado direito. */
  seta?: { cor: string; animacao: AnimacaoCta };
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

// "estatico" (padrão de antes): botão parado, sem nenhum movimento.
// "pulsar": cresce e volta ao tamanho normal, num ciclo suave (efeito de
// "batimento") — chama atenção sem ficar irritante.
// "piscar": a opacidade oscila entre bem visível e mais apagado — pisca,
// sem nunca sumir de vez (evita parecer um bug).
// "saltar": o elemento sobe e volta pra posição de descanso, num ciclo mais
// rápido (efeito de "chamar atenção pra baixo") — pensado pra seta/ícone
// apontando (ver renderSetaPng), mas funciona pra qualquer elemento fixo.
export type AnimacaoCta = "estatico" | "pulsar" | "piscar" | "saltar";

// FPS da animação do botão em si (independente do fps do vídeo final — o
// filtro overlay do ffmpeg segura o frame mais recente até o próximo PTS
// chegar, então não precisa bater com o fps do vídeo pra ficar suave).
const BOTAO_ANIMACAO_FPS = 20;
// Quanto o botão cresce no pico do "pulsar" (12% maior que o tamanho normal).
const PULSAR_ESCALA_MAX = 0.12;
// Duração de um ciclo completo de cada animação, em segundos.
const PULSAR_PERIODO_S = 1.0;
const PISCAR_PERIODO_S = 0.8;
// Opacidade mínima no fundo do "piscar" (nunca chega a sumir de vez).
const PISCAR_OPACIDADE_MIN = 0.4;
// "saltar": quanto o elemento sobe no pico do salto (22% da própria altura)
// e a duração de um ciclo completo (mais rápido que o "pulsar" — fica mais
// parecido com uma seta "cutucando" pra chamar atenção).
const SALTAR_PROPORCAO = 0.22;
const SALTAR_PERIODO_S = 0.7;

interface EntradaDeBotao {
  /** Caminho pra usar como -i do ffmpeg: um PNG único (estático) ou um padrão de sequência (animado). */
  inputPath: string;
  /** Opções de input do ffmpeg específicas dessa entrada (ex: "-loop 1" ou "-framerate 20"). */
  inputOptions: string[];
  /**
   * Quanto subtrair da posição vertical de overlay calculada pro botão
   * estático, pra compensar a folga extra do canvas (só o "pulsar" precisa
   * de folga pro botão crescer sem cortar) — assim a base do botão fica
   * sempre alinhada com a mesma margem, animado ou não.
   */
  overlayYOffset: number;
  /** Pasta de frames a apagar no final (só quando for uma sequência animada). */
  dirParaLimpar: string | null;
}

/**
 * Prepara a entrada de ffmpeg do botão de CTA — um PNG único (parado) ou uma
 * sequência de PNGs (animado, "pulsar"/"piscar") cobrindo a duração inteira
 * do vídeo — escolhendo a cor de maior contraste contra uma amostra do
 * criativo (imagem estática ou frame do vídeo). Se a amostra não estiver
 * disponível por algum motivo, cai no preto como antes.
 */
async function prepararEntradaBotao(
  textoOverlay: string | undefined,
  amostraParaCor: Buffer | null,
  animacao: AnimacaoCta,
  duracaoSegundos: number
): Promise<EntradaDeBotao | null> {
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

  const botaoBuffer = renderBotaoPng(textoOverlay, corEscolhida.hex, corEscolhida.texto);
  return animarPng(botaoBuffer, animacao, duracaoSegundos);
}

/**
 * Gera a "entrada" de ffmpeg (um PNG único parado, ou uma sequência de PNGs
 * de UM ciclo completo da animação, repetida em loop pelo próprio ffmpeg) pra
 * QUALQUER elemento gráfico fixo já renderizado como PNG com transparência —
 * botão de CTA, selo, seta etc. Extraído de dentro do que antes só o botão de
 * CTA usava (prepararEntradaBotao, acima), pra virar reutilizável pelos
 * outros elementos de overlay do "vídeo stock" (ver montarVideoComVideo).
 *
 * IMPORTANTE (bug corrigido): antes, gerava um frame pra cada 1/FPS segundo
 * da duração INTEIRA do vídeo (ex: um vídeo de 60s virava ~1200 PNGs só pra
 * esse elemento). Como cada animação é um ciclo que se repete (pulsar/
 * piscar/saltar sempre voltam ao ponto de partida), isso é redundante: só
 * precisa renderizar UM ciclo (poucos frames) e deixar o próprio ffmpeg
 * repeti-lo com "-stream_loop -1", do mesmo jeito que já faz com o vídeo de
 * fundo. Com vários elementos animados ao mesmo tempo (selo + seta, por
 * exemplo) o custo antigo multiplicava e podia estourar o tempo limite da
 * função na Vercel — foi isso que causou o "terminou sem devolver resultado"
 * relatado pelo usuário ao usar título+selo+seta juntos num vídeo mais longo.
 */
async function animarPng(buffer: Buffer, animacao: AnimacaoCta, duracaoSegundos: number): Promise<EntradaDeBotao> {
  if (animacao === "estatico") {
    const caminho = tmpFile("png");
    await fs.writeFile(caminho, buffer);
    return { inputPath: caminho, inputOptions: ["-loop 1"], overlayYOffset: 0, dirParaLimpar: null };
  }

  const imagemBase = await loadImage(buffer);
  // "pulsar" e "saltar" precisam de um canvas maior que o elemento (folga pro
  // crescimento/salto não cortar nas bordas) — "piscar" só muda opacidade,
  // então usa exatamente o tamanho do elemento, sem deslocar nada.
  const folga =
    animacao === "pulsar" || animacao === "saltar" ? 1 + Math.max(PULSAR_ESCALA_MAX, SALTAR_PROPORCAO) + 0.06 : 1;
  const larguraCanvas = Math.ceil(imagemBase.width * folga);
  const alturaCanvas = Math.ceil(imagemBase.height * folga);
  // Desenha sempre ancorado na base do canvas (não centralizado) — assim,
  // combinado com o overlayYOffset abaixo, a borda inferior do elemento cai
  // exatamente na mesma posição do elemento estático, com ou sem folga extra.
  const overlayYOffset = alturaCanvas - imagemBase.height;

  const periodo = animacao === "pulsar" ? PULSAR_PERIODO_S : animacao === "saltar" ? SALTAR_PERIODO_S : PISCAR_PERIODO_S;
  // Frames de UM ciclo só (os períodos acima foram escolhidos pra caber num
  // número inteiro de frames no FPS usado, então o loop fecha sem "salto"
  // perceptível no ponto de emenda). Nunca gera mais frames do que a duração
  // real pediria, pra vídeos bem curtos não desperdiçar trabalho à toa.
  const framesPorCiclo = Math.max(1, Math.round(periodo * BOTAO_ANIMACAO_FPS));
  const framesParaDuracaoInteira = Math.max(1, Math.ceil(duracaoSegundos * BOTAO_ANIMACAO_FPS) + BOTAO_ANIMACAO_FPS);
  const totalFrames = Math.min(framesPorCiclo, framesParaDuracaoInteira);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pv-anim-"));

  for (let i = 0; i < totalFrames; i++) {
    const t = i / BOTAO_ANIMACAO_FPS;
    // Onda suave 0 -> 1 -> 0 ao longo do período (em vez de um seno cru, que
    // começaria "no meio do movimento" em t=0).
    const fase = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / periodo);

    const canvas = createCanvas(larguraCanvas, alturaCanvas);
    const ctx = canvas.getContext("2d");

    if (animacao === "pulsar") {
      const escala = 1 + PULSAR_ESCALA_MAX * fase;
      const w = imagemBase.width * escala;
      const h = imagemBase.height * escala;
      ctx.drawImage(imagemBase, (larguraCanvas - w) / 2, alturaCanvas - h, w, h);
    } else if (animacao === "saltar") {
      const deslocamento = imagemBase.height * SALTAR_PROPORCAO * fase;
      ctx.drawImage(
        imagemBase,
        (larguraCanvas - imagemBase.width) / 2,
        alturaCanvas - imagemBase.height - deslocamento,
        imagemBase.width,
        imagemBase.height
      );
    } else {
      ctx.globalAlpha = 1 - (1 - PISCAR_OPACIDADE_MIN) * fase;
      ctx.drawImage(imagemBase, 0, 0, imagemBase.width, imagemBase.height);
      ctx.globalAlpha = 1;
    }

    const nomeArquivo = `f${String(i).padStart(5, "0")}.png`;
    await fs.writeFile(path.join(dir, nomeArquivo), canvas.toBuffer("image/png"));
  }

  return {
    inputPath: path.join(dir, "f%05d.png"),
    // "-stream_loop -1" repete essa sequência curta (um ciclo) indefinidamente
    // — o ffmpeg corta no tamanho certo depois, via "-t <duração>" no output.
    inputOptions: [`-framerate ${BOTAO_ANIMACAO_FPS}`, "-stream_loop -1"],
    overlayYOffset,
    dirParaLimpar: dir,
  };
}

/** Apaga a entrada do botão (arquivo único ou pasta de frames), sem derrubar a geração se falhar. */
async function limparEntradaBotao(entrada: EntradaDeBotao | null): Promise<void> {
  if (!entrada) return;
  if (entrada.dirParaLimpar) {
    await fs.rm(entrada.dirParaLimpar, { recursive: true, force: true }).catch(() => {});
  } else {
    await fs.unlink(entrada.inputPath).catch(() => {});
  }
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

  const duration = await getAudioDuration(audioPath);
  const entradaBotao = await prepararEntradaBotao(
    opts.textoOverlay,
    opts.imagemBuffer,
    opts.animacaoCta ?? "estatico",
    duration
  );

  const fps = 30;
  const totalFrames = Math.ceil(duration * fps);

  const filtros = [
    // Ajusta a imagem para preencher o formato de saída (crop central) antes do zoom.
    `[0:v]scale=${W * 1.5}:${H * 1.5}:force_original_aspect_ratio=increase,crop=${W * 1.5}:${H * 1.5}` +
      `,zoompan=z='min(zoom+0.0008,1.15)':d=${totalFrames}:s=${W}x${H}:fps=${fps}[zoomed]`,
  ];
  let lastLabel = "zoomed";

  if (entradaBotao) {
    const deslocamento = entradaBotao.overlayYOffset > 0 ? `-${entradaBotao.overlayYOffset}` : "";
    filtros.push(`[${lastLabel}][2:v]overlay=(main_w-overlay_w)/2:main_h-${margemInferior}${deslocamento}[out]`);
    lastLabel = "out";
  }

  const cmd = ffmpeg().input(imgPath).inputOptions(["-loop 1"]).input(audioPath);
  if (entradaBotao) cmd.input(entradaBotao.inputPath).inputOptions(entradaBotao.inputOptions);

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
  await limparEntradaBotao(entradaBotao);
}

// Faixas de variação aplicadas ao vídeo quando remixarVisual está ligado —
// sorteadas a cada chamada, pra cada variação (e cada formato) sair com um
// tratamento visual ligeiramente diferente entre si, além de diferente do
// vídeo original.
function sortear(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Monta um vídeo vertical (1080x1920) a partir de um CLIPE DE VÍDEO (stock) + narração,
 * cortando/repetindo o clipe para bater com a duração do áudio.
 */
export async function montarVideoComVideo(
  opts: MontarVideoOpts & {
    videoBuffer: Buffer;
    ajusteDeQuadro?: AjusteDeQuadro;
    remixarVisual?: boolean;
    elementos?: ElementosGraficos;
  }
): Promise<void> {
  const { largura: W, altura: H } = FORMATOS[opts.formatoVideo ?? "vertical"];
  const margemInferior = Math.round(H * MARGEM_INFERIOR_PROPORCAO);
  const ajuste = opts.ajusteDeQuadro ?? "cobrir";

  const vidPath = tmpFile("mp4");
  const audioPath = tmpFile("mp3");
  await fs.writeFile(vidPath, opts.videoBuffer);
  await fs.writeFile(audioPath, opts.audioBuffer);

  const duration = await getAudioDuration(audioPath);
  const frameParaCor = await extrairFrameDoVideo(vidPath);
  const entradaBotao = await prepararEntradaBotao(
    opts.textoOverlay,
    frameParaCor,
    opts.animacaoCta ?? "estatico",
    duration
  );

  // Elementos gráficos extras (só relevantes no fluxo de "vídeo stock" — ver
  // ElementosGraficos acima e gerar/route.ts) — cada um preparado do mesmo
  // jeito que o botão de CTA (PNG estático ou sequência animada via
  // animarPng), só que com posição fixa própria (título no topo, selo acima
  // do CTA, seta do lado direito).
  const elementos = opts.elementos;
  const entradaTitulo = elementos?.tituloTopo?.texto
    ? await animarPng(
        renderFaixaDeTextoPng(
          elementos.tituloTopo.texto,
          elementos.tituloTopo.corTexto,
          elementos.tituloTopo.corFundo,
          W,
          elementos.tituloTopo.semFundo
        ),
        "estatico",
        duration
      )
    : null;
  const entradaSelo = elementos?.selo?.texto
    ? await animarPng(
        renderBotaoPng(elementos.selo.texto, elementos.selo.corFundo, elementos.selo.corTexto, 34),
        elementos.selo.animacao,
        duration
      )
    : null;
  const entradaSeta = elementos?.seta
    ? await animarPng(renderSetaPng(elementos.seta.cor), elementos.seta.animacao, duration)
    : null;

  let filtros: string[];

  if (ajuste === "conter" && opts.remixarVisual) {
    // Usado só pro formato "vídeo original": em vez de reexportar o clipe
    // praticamente idêntico (só trocando o áudio), aplica um retoque visual —
    // corta uma borda fina (também tira qualquer marca d'água/elemento colado
    // na beirada), um leve ajuste de cor/contraste/matiz e uma vinheta sutil,
    // e troca o fundo desfocado (quando o vídeo não preenche o quadro todo)
    // por uma cor sólida derivada do próprio vídeo — sorteado a cada geração,
    // pra cada variação sair com uma "cara" um pouco diferente da outra.
    let corFundo: CorRgb = [20, 20, 20];
    if (frameParaCor) {
      try {
        corFundo = escurecer(await corMediaAmostra(frameParaCor), 0.35);
      } catch {
        // mantém o fallback escuro se a amostragem falhar
      }
    }
    const corFundoHex = paraHexFfmpeg(corFundo);

    // 2ª rodada de ajuste: usuário testou em vídeo real e pediu mais
    // intensidade ainda. O corte de borda é o único ajuste com risco real
    // (testado: com CTA de texto largo, um corte de 10%+ já cortava as
    // pontas do texto — inaceitável) — por isso ele NÃO sobe mais, fica no
    // mesmo teto testado e aprovado antes. Quem sobe bastante é tudo que não
    // tem esse risco: cor/contraste/matiz/vinheta.
    const zoomCorte = sortear(0.85, 0.93); // corta de 7% a 15% da borda (mesmo teto de antes)
    const matizGraus = Math.round(sortear(-32, 32));
    const contraste = sortear(1.08, 1.28);
    const brilho = sortear(-0.06, 0.09);
    const saturacao = sortear(1.25, 1.6);

    filtros = [
      `color=c=${corFundoHex}:s=${W}x${H}[fundo]`,
      `[0:v]crop=iw*${zoomCorte.toFixed(3)}:ih*${zoomCorte.toFixed(3)},` +
        `eq=contrast=${contraste.toFixed(3)}:brightness=${brilho.toFixed(3)}:saturation=${saturacao.toFixed(3)},` +
        `hue=h=${matizGraus},vignette=PI/3.3,` +
        `scale=${W}:${H}:force_original_aspect_ratio=decrease[frente]`,
      `[fundo][frente]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,setpts=PTS-STARTPTS[cropped]`,
    ];
  } else if (ajuste === "conter") {
    filtros = [
      // Fundo: preenche o quadro todo (cortando) e desfoca, só pra não
      // deixar barras pretas feias nas laterais/topo-base.
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=30[fundo]`,
      // Primeiro plano: o vídeo INTEIRO, sem cortar nada (encolhe pra caber).
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[frente]`,
      `[fundo][frente]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,setpts=PTS-STARTPTS[cropped]`,
    ];
  } else {
    filtros = [`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setpts=PTS-STARTPTS[cropped]`];
  }
  let lastLabel = "cropped";

  // Camadas sobrepostas na ordem título -> selo -> seta -> botão de CTA,
  // cada uma como seu próprio input de ffmpeg com índice dinâmico (em vez do
  // "[2:v]" fixo de antes, que só previa UM elemento opcional possível).
  const cmd = ffmpeg().input(vidPath).inputOptions(["-stream_loop -1"]).input(audioPath);
  let proximoIndice = 2;

  function aplicarOverlay(entrada: EntradaDeBotao | null, x: string, y: string) {
    if (!entrada) return;
    cmd.input(entrada.inputPath).inputOptions(entrada.inputOptions);
    const indice = proximoIndice++;
    const deslocamento = entrada.overlayYOffset > 0 ? `-${entrada.overlayYOffset}` : "";
    const label = `ov${indice}`;
    filtros.push(`[${lastLabel}][${indice}:v]overlay=${x}:${y}${deslocamento}[${label}]`);
    lastLabel = label;
  }

  // Título: faixa de largura inteira, perto do topo.
  aplicarOverlay(entradaTitulo, "0", `round(main_h*0.05)`);
  // Selo: centralizado, um pouco acima de onde o CTA fica — offset menor que
  // antes (SELO_OFFSET_ACIMA_CTA_PX, era 180) porque o usuário achou que
  // selo/seta estavam "quase no centro" do criativo, longe demais da base.
  aplicarOverlay(entradaSelo, "(main_w-overlay_w)/2", `main_h-${margemInferior}-${SELO_OFFSET_ACIMA_CTA_PX}`);
  // Seta: lado direito, mais pra baixo que o centro (SETA_Y_PROPORCAO, era
  // 0.48 — ficava bem no meio do criativo) — mesmo motivo acima.
  aplicarOverlay(entradaSeta, "main_w*0.8-overlay_w/2", `main_h*${SETA_Y_PROPORCAO}-overlay_h/2`);
  // Botão de CTA: mesma posição de sempre (base, centralizado).
  aplicarOverlay(entradaBotao, "(main_w-overlay_w)/2", `main_h-${margemInferior}`);

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
  await Promise.all([
    limparEntradaBotao(entradaBotao),
    limparEntradaBotao(entradaTitulo),
    limparEntradaBotao(entradaSelo),
    limparEntradaBotao(entradaSeta),
  ]);
}

export function novoArquivoDeSaida(): string {
  return tmpFile("mp4");
}

export interface DimensoesVideo {
  largura: number;
  altura: number;
  duracaoSegundos: number;
}

/**
 * Lê as dimensões e a duração reais de um vídeo com ffprobe — em vez de
 * confiar só no que o navegador reportou, pra máscara/overlay e vídeo
 * baterem certinho. Usada pra gerar a máscara de remoção, posicionar o texto
 * novo, e (duração) pra montar o vídeo estático de uma imagem editada por IA
 * (ver funções abaixo).
 */
export async function obterDimensoesDoVideo(videoBuffer: Buffer): Promise<DimensoesVideo> {
  const vidPath = tmpFile("mp4");
  await fs.writeFile(vidPath, videoBuffer);
  try {
    const dados = await new Promise<{ width?: number; height?: number; duration?: number }>((resolve, reject) => {
      ffmpeg.ffprobe(vidPath, (err, data) => {
        if (err) return reject(err);
        const streamDeVideo = data.streams.find((s) => s.codec_type === "video");
        resolve({ width: streamDeVideo?.width, height: streamDeVideo?.height, duration: data.format.duration });
      });
    });
    return {
      largura: dados.width || 1080,
      altura: dados.height || 1920,
      duracaoSegundos: dados.duration || 15,
    };
  } finally {
    await fs.unlink(vidPath).catch(() => {});
  }
}

/**
 * Extrai um frame (meio do vídeo) como imagem PNG, a partir dos bytes do
 * vídeo — usada pra pegar um frame representativo pra editar como imagem
 * (ver src/app/api/variacoes/editar-frame-ia/route.ts). Reaproveita
 * extrairFrameDoVideo (já usada internamente pra amostra de cor do botão).
 */
export async function extrairFrameComoImagem(videoBuffer: Buffer): Promise<Buffer> {
  const vidPath = tmpFile("mp4");
  await fs.writeFile(vidPath, videoBuffer);
  try {
    const frame = await extrairFrameDoVideo(vidPath);
    if (!frame) throw new Error("Não consegui extrair um frame do vídeo pra editar.");
    return frame;
  } finally {
    await fs.unlink(vidPath).catch(() => {});
  }
}

/**
 * Monta um vídeo "estático" (a mesma imagem do início ao fim, sem zoom) a
 * partir de uma imagem já editada — usada quando o vídeo original era, na
 * prática, uma imagem/card parado (ver editarImagemComIA em src/lib/gemini.ts):
 * em vez de reconstruir com efeito de zoom (que mudaria a "cara" do
 * original), mantém o mesmo estilo estático de antes. Sem áudio — a
 * narração é adicionada depois, no mesmo pipeline que já processa o "vídeo
 * original" normalmente (montarVideoComVideo, via videoOriginalUrlEditado).
 */
export async function montarVideoEstaticoDeImagem(imagemBuffer: Buffer, duracaoSegundos: number): Promise<Buffer> {
  const imgPath = tmpFile("png");
  const outPath = tmpFile("mp4");
  await fs.writeFile(imgPath, imagemBuffer);

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(imgPath)
      .inputOptions(["-loop 1"])
      .outputOptions([
        `-t ${Math.max(0.5, duracaoSegundos)}`,
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2", // largura/altura pares — exigido pelo libx264/yuv420p
        "-c:v libx264",
        "-pix_fmt yuv420p",
        "-r 24",
      ])
      .save(outPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });

  const resultado = await fs.readFile(outPath);
  await fs.unlink(imgPath).catch(() => {});
  await fs.unlink(outPath).catch(() => {});
  return resultado;
}

/**
 * Gera uma imagem de máscara (preto = manter, branco = apagar), do tamanho
 * real do vídeo, a partir de uma região normalizada (0 a 1, relativa à
 * largura/altura) marcada pelo usuário no navegador — usada pela IA de
 * remoção de elemento (WaveSpeedAI, ver src/lib/wavespeed.ts).
 */
export function gerarMascaraPng(
  dimensoes: DimensoesVideo,
  regiao: { x: number; y: number; w: number; h: number }
): Buffer {
  const { largura, altura } = dimensoes;
  const canvas = createCanvas(largura, altura);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, largura, altura);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(
    Math.round(regiao.x * largura),
    Math.round(regiao.y * altura),
    Math.round(regiao.w * largura),
    Math.round(regiao.h * altura)
  );
  return canvas.toBuffer("image/png");
}

function medirLarguraTexto(texto: string, fontSize: number, family: string): number {
  const medindo = createCanvas(10, 10).getContext("2d");
  medindo.font = `bold ${fontSize}px "${family}"`;
  return medindo.measureText(texto).width;
}

/**
 * Renderiza um texto (uma linha só, cor e fonte escolhidas pelo usuário) num
 * PNG transparente do tamanho exato de uma caixa em pixels — encolhendo o
 * tamanho da fonte automaticamente até caber na largura da caixa. Usada pra
 * "reescrever" um texto que foi apagado do vídeo original (ver
 * sobreporImagemFixa abaixo): em vez de pedir pra uma IA generativa redesenhar
 * o texto (nada confiável pra texto — erra letra, kerning etc.), a gente
 * mesmo desenha o texto novo, com controle total de fonte/cor/posição.
 */
export function renderTextoEmCaixaPng(
  texto: string,
  corTexto: string,
  larguraCaixa: number,
  alturaCaixa: number,
  fonteId: string
): Buffer {
  garantirFonteRegistrada();
  garantirFontesTextoRegistradas();
  const fonte = FONTES_TEXTO[fonteId] || FONTES_TEXTO.padrao;

  const larguraMax = Math.max(10, Math.round(larguraCaixa * 0.94));
  const alturaMax = Math.max(10, Math.round(alturaCaixa * 0.8));

  let fontSize = alturaMax;
  while (fontSize > 8 && medirLarguraTexto(texto, fontSize, fonte.family) > larguraMax) {
    fontSize -= 1;
  }

  const canvas = createCanvas(Math.max(1, Math.round(larguraCaixa)), Math.max(1, Math.round(alturaCaixa)));
  const ctx = canvas.getContext("2d");
  ctx.font = `bold ${fontSize}px "${fonte.family}"`;
  ctx.fillStyle = corTexto;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, larguraCaixa / 2, alturaCaixa / 2, larguraMax);
  return canvas.toBuffer("image/png");
}

/**
 * Sobrepõe uma imagem PNG (com transparência) num ponto fixo (x,y em pixels,
 * canto superior-esquerdo) de um vídeo, do início ao fim, sem mexer em mais
 * nada — usada pra desenhar o texto novo (renderTextoEmCaixaPng) por cima do
 * vídeo já com o elemento antigo apagado pela IA.
 */
export async function sobreporImagemFixa(
  videoBuffer: Buffer,
  imagemBuffer: Buffer,
  posicao: { x: number; y: number }
): Promise<Buffer> {
  const vidPath = tmpFile("mp4");
  const imgPath = tmpFile("png");
  const outPath = tmpFile("mp4");
  await fs.writeFile(vidPath, videoBuffer);
  await fs.writeFile(imgPath, imagemBuffer);

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(vidPath)
      .input(imgPath)
      .inputOptions(["-loop 1"])
      .complexFilter([`[0:v][1:v]overlay=${Math.round(posicao.x)}:${Math.round(posicao.y)}:shortest=1[out]`], "out")
      .outputOptions(["-map 0:a?", "-c:v libx264", "-pix_fmt yuv420p", "-c:a copy", "-shortest"])
      .save(outPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });

  const resultado = await fs.readFile(outPath);
  await fs.unlink(vidPath).catch(() => {});
  await fs.unlink(imgPath).catch(() => {});
  await fs.unlink(outPath).catch(() => {});
  return resultado;
}

/**
 * Sobrepõe um texto (já renderizado por renderTextoEmCaixaPng) numa IMAGEM
 * (não vídeo) numa posição em pixels — usada pra "corrigir"/escrever um
 * texto preciso por cima do resultado da IA de edição de imagem (Gemini),
 * já que IA generativa não é confiável pra ortografia/tipografia (mesmo
 * motivo de sobreporImagemFixa, usada no fluxo de apagar elemento). Ao
 * contrário dela (que trabalha em cima de um VÍDEO via ffmpeg), aqui as
 * duas entradas já são imagens — dá pra compor direto com canvas, sem
 * precisar do ffmpeg.
 */
export async function sobreporTextoEmImagem(
  imagemBuffer: Buffer,
  textoPngBuffer: Buffer,
  posicao: { x: number; y: number }
): Promise<Buffer> {
  const base = await loadImage(imagemBuffer);
  const textoImg = await loadImage(textoPngBuffer);
  const canvas = createCanvas(base.width, base.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(base, 0, 0, base.width, base.height);
  ctx.drawImage(textoImg, posicao.x, posicao.y);
  return canvas.toBuffer("image/png");
}

/**
 * Lê largura/altura reais de uma imagem (buffer PNG/JPEG) — usada pra
 * calcular a posição em pixels de uma região normalizada (0 a 1) marcada
 * sobre ela, quando a imagem em questão não é necessariamente do mesmo
 * tamanho do vídeo original (ex: a imagem editada pela IA do Gemini, que
 * pode voltar em outra resolução — ver editar-frame-ia/route.ts).
 */
export async function obterDimensoesDaImagem(imagemBuffer: Buffer): Promise<{ largura: number; altura: number }> {
  const img = await loadImage(imagemBuffer);
  return { largura: img.width, altura: img.height };
}

/** As opções de fonte disponíveis pra "reescrever texto" — pra popular o seletor no front. */
export function listarOpcoesDeFonte(): { id: string; label: string }[] {
  return Object.entries(FONTES_TEXTO).map(([id, opcao]) => ({ id, label: opcao.label }));
}
