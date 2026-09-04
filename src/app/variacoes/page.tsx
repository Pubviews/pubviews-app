"use client";

import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { upload } from "@vercel/blob/client";

interface RegiaoNormalizada {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Deixa o usuário marcar (arrastando o mouse) um retângulo sobre um frame do
 * vídeo original — essa área é o que a IA de remoção (WaveSpeedAI) vai tentar
 * apagar de verdade (ex: o botão/CTA embutido na imagem). Captura o frame
 * direto no navegador (sem precisar de nenhuma chamada ao servidor só pra
 * isso) usando um <video> oculto + canvas.
 */
function SeletorDeMascara({
  videoUrl,
  regiao,
  onRegiaoChange,
}: {
  videoUrl: string;
  regiao: RegiaoNormalizada | null;
  onRegiaoChange: (r: RegiaoNormalizada | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameImgRef = useRef<HTMLImageElement | null>(null);
  const arrastandoRef = useRef<{ x: number; y: number } | null>(null);
  const [carregandoFrame, setCarregandoFrame] = useState(true);
  const [erroFrame, setErroFrame] = useState<string | null>(null);
  const [alturaCanvas, setAlturaCanvas] = useState(500);
  const LARGURA_CANVAS = 320;

  function desenhar(regiaoAtual: RegiaoNormalizada | null) {
    const canvas = canvasRef.current;
    const img = frameImgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (regiaoAtual && regiaoAtual.w > 0 && regiaoAtual.h > 0) {
      const x = regiaoAtual.x * canvas.width;
      const y = regiaoAtual.y * canvas.height;
      const w = regiaoAtual.w * canvas.width;
      const h = regiaoAtual.h * canvas.height;
      ctx.fillStyle = "rgba(229,57,53,0.35)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(229,57,53,0.95)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }
  }

  useEffect(() => {
    let cancelado = false;
    frameImgRef.current = null;

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = videoUrl;

    function aoFalhar() {
      if (cancelado) return;
      setErroFrame("Não foi possível carregar um frame do vídeo pra marcar a área. Pode aplicar a remoção mesmo assim descrevendo com cuidado, ou pular essa etapa.");
      setCarregandoFrame(false);
    }

    video.addEventListener("error", aoFalhar);
    video.addEventListener("loadedmetadata", () => {
      if (cancelado) return;
      try {
        video.currentTime = Math.min(1, (video.duration || 2) / 2);
      } catch {
        aoFalhar();
      }
    });
    video.addEventListener("seeked", () => {
      if (cancelado) return;
      const w = video.videoWidth || 1080;
      const h = video.videoHeight || 1920;
      const canvasBase = document.createElement("canvas");
      canvasBase.width = w;
      canvasBase.height = h;
      const ctxBase = canvasBase.getContext("2d");
      if (!ctxBase) return aoFalhar();
      try {
        ctxBase.drawImage(video, 0, 0, w, h);
      } catch {
        return aoFalhar();
      }
      const img = new Image();
      img.onload = () => {
        if (cancelado) return;
        frameImgRef.current = img;
        setAlturaCanvas(Math.round((LARGURA_CANVAS * h) / w));
        setCarregandoFrame(false);
      };
      img.onerror = aoFalhar;
      img.src = canvasBase.toDataURL("image/png");
    });

    return () => {
      cancelado = true;
    };
  }, [videoUrl]);

  useEffect(() => {
    desenhar(regiao);
  }, [regiao, carregandoFrame]);

  function posicaoRelativa(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function aoPressionar(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (carregandoFrame) return;
    arrastandoRef.current = posicaoRelativa(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function aoMover(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!arrastandoRef.current) return;
    const atual = posicaoRelativa(e);
    const inicio = arrastandoRef.current;
    const novaRegiao: RegiaoNormalizada = {
      x: Math.min(inicio.x, atual.x),
      y: Math.min(inicio.y, atual.y),
      w: Math.abs(atual.x - inicio.x),
      h: Math.abs(atual.y - inicio.y),
    };
    onRegiaoChange(novaRegiao);
  }
  function aoSoltar() {
    arrastandoRef.current = null;
  }

  return (
    <div>
      {carregandoFrame && <p className="text-xs text-zinc-500">Carregando frame do vídeo...</p>}
      {erroFrame && <p className="text-xs text-red-700">{erroFrame}</p>}
      <canvas
        ref={canvasRef}
        width={LARGURA_CANVAS}
        height={alturaCanvas}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerLeave={aoSoltar}
        className="mt-2 touch-none rounded-md border border-zinc-300"
        style={{ cursor: carregandoFrame ? "default" : "crosshair", maxWidth: "100%" }}
      />
    </div>
  );
}

type Formato = "imagem" | "video" | "video_original";
type AnimacaoCta = "estatico" | "pulsar" | "piscar";

interface CardVariacao {
  texto: string;
  formato: Formato;
  descricaoVisual: string;
  textoOverlay: string;
  animacaoCta: AnimacaoCta;
  gerando: boolean;
  erro: string | null;
  videoUrl: string | null;
  // Progresso da geração em andamento (botão "Gerar vídeo (vertical)") —
  // null quando não tem nada rodando.
  progressoPct: number | null;
  progressoMensagem: string | null;
  // Resultado do botão "Gerar nos 2 formatos": vertical (1080x1920) + quadrado (1080x1080).
  gerandoDuplo: boolean;
  erroDuplo: string | null;
  videoUrlVertical: string | null;
  videoUrlQuadrado: string | null;
  progressoDuploPct: number | null;
  progressoDuploMensagem: string | null;
}

function base64ParaUrlDeVideo(base64: string, mimeType = "video/mp4"): string {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  const blob = new Blob([array], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Lê uma resposta em stream NDJSON (uma linha JSON por evento — ver as rotas
 * /api/variacoes/gerar e /gerar-multiformato) chamando onProgresso a cada
 * evento de progresso, e devolve o evento final ("concluido"). Lança erro se
 * vier um evento "erro" ou se o stream terminar sem nenhum dos dois (conexão
 * cortada no meio, por exemplo).
 */
async function lerRespostaComProgresso(
  res: Response,
  onProgresso: (mensagem: string, pct: number) => void
): Promise<Record<string, unknown>> {
  if (!res.body) throw new Error("Resposta sem corpo.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let resultado: Record<string, unknown> | null = null;
  let erro: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let fimDaLinha: number;
    while ((fimDaLinha = buffer.indexOf("\n")) >= 0) {
      const linha = buffer.slice(0, fimDaLinha).trim();
      buffer = buffer.slice(fimDaLinha + 1);
      if (!linha) continue;
      let evento: Record<string, unknown>;
      try {
        evento = JSON.parse(linha);
      } catch {
        continue;
      }
      if (evento.tipo === "progresso") {
        onProgresso(String(evento.mensagem || ""), Number(evento.pct) || 0);
      } else if (evento.tipo === "concluido") {
        resultado = evento;
      } else if (evento.tipo === "erro") {
        erro = String(evento.error || "Erro ao gerar.");
      }
    }
  }

  if (erro) throw new Error(erro);
  if (!resultado) throw new Error("A geração terminou sem devolver um resultado. Tente de novo.");
  return resultado;
}

const TAMANHO_MAXIMO_VIDEO_MB = 80;

export default function VariacoesPage() {
  const [referencia, setReferencia] = useState("");
  const [nicho, setNicho] = useState("");
  const [quantidade, setQuantidade] = useState(3);
  const [carregandoRoteiros, setCarregandoRoteiros] = useState(false);
  const [erroRoteiros, setErroRoteiros] = useState<string | null>(null);
  const [cards, setCards] = useState<CardVariacao[]>([]);

  // Vídeo próprio enviado como referência (opcional): a IA analisa e preenche
  // a referência/nicho sozinha, e depois decide — variação por variação — se
  // reaproveita esse vídeo como visual ou gera uma cena nova.
  const [videoOriginalUrl, setVideoOriginalUrl] = useState<string | null>(null);
  const [videoOriginalNome, setVideoOriginalNome] = useState<string | null>(null);
  const [descricaoVisualOriginal, setDescricaoVisualOriginal] = useState<string | null>(null);
  const [analisandoVideo, setAnalisandoVideo] = useState(false);
  const [erroAnaliseVideo, setErroAnaliseVideo] = useState<string | null>(null);

  // Remoção de elemento com IA (WaveSpeedAI) — opcional: o usuário marca uma
  // área no frame do vídeo (ex: o botão/texto de CTA embutido) e a gente
  // manda apagar de verdade, UMA vez só por vídeo enviado (não a cada
  // variação gerada — o resultado fica salvo e é reaproveitado por todas as
  // variações que usarem esse vídeo). Sem isso, o vídeo original continua
  // passando só pelo retoque visual (cor/corte/vinheta) de antes.
  const [regiaoParaApagar, setRegiaoParaApagar] = useState<RegiaoNormalizada | null>(null);
  const [videoOriginalUrlEditado, setVideoOriginalUrlEditado] = useState<string | null>(null);
  const [aplicandoRemocao, setAplicandoRemocao] = useState(false);
  const [erroRemocao, setErroRemocao] = useState<string | null>(null);
  // Opcional: em vez de só apagar, redesenha um texto novo (fonte/cor
  // escolhidas aqui) na mesma área — a gente mesmo desenha (sem depender de
  // IA generativa pra "reescrever" texto, que erra letra/kerning).
  const [textoNovo, setTextoNovo] = useState("");
  const [corTextoNovo, setCorTextoNovo] = useState("#ffffff");
  const [fonteTextoNovo, setFonteTextoNovo] = useState("padrao");

  function limparRemocaoDeElemento() {
    setRegiaoParaApagar(null);
    setVideoOriginalUrlEditado(null);
    setErroRemocao(null);
    setTextoNovo("");
    setCorTextoNovo("#ffffff");
    setFonteTextoNovo("padrao");
  }

  async function aplicarRemocaoDeElemento() {
    if (!videoOriginalUrl || !regiaoParaApagar || regiaoParaApagar.w <= 0 || regiaoParaApagar.h <= 0) return;
    setAplicandoRemocao(true);
    setErroRemocao(null);
    try {
      const res = await fetch("/api/variacoes/apagar-elemento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: videoOriginalUrl,
          regiao: regiaoParaApagar,
          textoNovo: textoNovo.trim() || undefined,
          corTexto: corTextoNovo,
          fonte: fonteTextoNovo,
        }),
        // Bem folgado: a IA de remoção demora, em média, ~161s pra processar.
        signal: AbortSignal.timeout(270000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao remover o elemento com IA.");
      setVideoOriginalUrlEditado(json.videoUrl);
    } catch (err) {
      const timeout = err instanceof Error && err.name === "TimeoutError";
      setErroRemocao(
        timeout
          ? "A remoção demorou demais e foi cancelada. Tente de novo."
          : err instanceof Error
            ? err.message
            : String(err)
      );
    } finally {
      setAplicandoRemocao(false);
    }
  }

  // Caminho alternativo — edição de IMAGEM com IA (Gemini): melhor quando o
  // "vídeo original" é, na prática, uma imagem/card parado (sem movimento de
  // cena) — dá pra trocar/inserir elementos com muito mais precisão do que
  // edição de vídeo (categoria de IA ainda imatura pra isso). O usuário
  // descreve em texto o que quer mudar, com uma imagem de referência opcional
  // do elemento novo. Escreve no MESMO videoOriginalUrlEditado usado pelo
  // caminho de apagar-elemento acima — o resto do app não precisa saber qual
  // dos dois foi usado.
  const [instrucaoEdicaoImagem, setInstrucaoEdicaoImagem] = useState("");
  const [imagemReferenciaUrl, setImagemReferenciaUrl] = useState<string | null>(null);
  const [imagemReferenciaNome, setImagemReferenciaNome] = useState<string | null>(null);
  const [enviandoImagemReferencia, setEnviandoImagemReferencia] = useState(false);
  const [aplicandoEdicaoImagem, setAplicandoEdicaoImagem] = useState(false);
  const [erroEdicaoImagem, setErroEdicaoImagem] = useState<string | null>(null);
  // Correção de texto por cima do resultado da IA (opcional): texto é o
  // ponto fraco conhecido de IA generativa de imagem (erra ortografia), então
  // em vez de confiar na IA pro texto, o usuário marca a área e escreve o
  // texto exato — a gente desenha ele mesmo (mesmo motor da correção de
  // texto no fluxo de apagar elemento), por cima do resultado da IA.
  const [regiaoTextoImagem, setRegiaoTextoImagem] = useState<RegiaoNormalizada | null>(null);
  const [textoCorrigido, setTextoCorrigido] = useState("");
  const [corTextoCorrigido, setCorTextoCorrigido] = useState("#ffffff");
  const [fonteTextoCorrigido, setFonteTextoCorrigido] = useState("padrao");

  function limparEdicaoDeImagem() {
    setInstrucaoEdicaoImagem("");
    setImagemReferenciaUrl(null);
    setImagemReferenciaNome(null);
    setErroEdicaoImagem(null);
    setRegiaoTextoImagem(null);
    setTextoCorrigido("");
  }

  async function selecionarImagemReferencia(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setEnviandoImagemReferencia(true);
    setErroEdicaoImagem(null);
    try {
      const resultado = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/variacoes/imagem-upload",
        abortSignal: AbortSignal.timeout(30000),
      });
      setImagemReferenciaUrl(resultado.url);
      setImagemReferenciaNome(file.name);
    } catch (err) {
      setErroEdicaoImagem(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviandoImagemReferencia(false);
    }
  }

  async function aplicarEdicaoComImagemIA() {
    if (!videoOriginalUrl || !instrucaoEdicaoImagem.trim()) return;
    setAplicandoEdicaoImagem(true);
    setErroEdicaoImagem(null);
    try {
      const res = await fetch("/api/variacoes/editar-frame-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: videoOriginalUrl,
          instrucao: instrucaoEdicaoImagem.trim(),
          imagemReferenciaUrl: imagemReferenciaUrl || undefined,
          regiaoTexto:
            textoCorrigido.trim() && regiaoTextoImagem && regiaoTextoImagem.w > 0 && regiaoTextoImagem.h > 0
              ? regiaoTextoImagem
              : undefined,
          textoNovo: textoCorrigido.trim() ? textoCorrigido.trim() : undefined,
          corTexto: corTextoCorrigido,
          fonte: fonteTextoCorrigido,
        }),
        signal: AbortSignal.timeout(110000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao editar a imagem com IA.");
      setVideoOriginalUrlEditado(json.videoUrl);
    } catch (err) {
      const timeout = err instanceof Error && err.name === "TimeoutError";
      setErroEdicaoImagem(
        timeout
          ? "A edição demorou demais e foi cancelada. Tente de novo."
          : err instanceof Error
            ? err.message
            : String(err)
      );
    } finally {
      setAplicandoEdicaoImagem(false);
    }
  }

  async function selecionarVideoOriginal(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite selecionar o mesmo arquivo de novo depois
    if (!file) return;

    if (file.size > TAMANHO_MAXIMO_VIDEO_MB * 1024 * 1024) {
      setErroAnaliseVideo(
        `Vídeo muito grande (${(file.size / (1024 * 1024)).toFixed(1)}MB). Envie um arquivo de até ${TAMANHO_MAXIMO_VIDEO_MB}MB (tente comprimir ou cortar o vídeo).`
      );
      return;
    }

    setAnalisandoVideo(true);
    setErroAnaliseVideo(null);
    setDescricaoVisualOriginal(null);
    limparRemocaoDeElemento();
    limparEdicaoDeImagem();
    try {
      // Sobe o arquivo direto do navegador pro Vercel Blob — não passa pelo
      // corpo de nenhuma função nossa, então não esbarra no limite de ~4.5MB
      // de requisição das Vercel Functions. abortSignal garante que, se esse
      // upload travar (rede, etc.), a gente não fica preso aqui pra sempre —
      // sai com um erro claro em vez de "Analisando vídeo..." infinito.
      const resultado = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/variacoes/video-upload",
        abortSignal: AbortSignal.timeout(60000),
      });

      // Timeout no próprio navegador — sem isso, se a resposta nunca chegar
      // (conexão travada, aba que ficou inativa, etc.) a tela fica presa em
      // "Analisando vídeo..." pra sempre, sem erro nenhum aparecer.
      const res = await fetch("/api/variacoes/analisar-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: resultado.url, mimeType: file.type || "video/mp4" }),
        signal: AbortSignal.timeout(170000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao analisar o vídeo.");

      setVideoOriginalUrl(resultado.url);
      setVideoOriginalNome(file.name);
      setDescricaoVisualOriginal(json.descricaoVisual || "");
      setReferencia(json.referencia || "");
      if (json.nicho) setNicho(json.nicho);
    } catch (err) {
      const timeout = err instanceof Error && err.name === "TimeoutError";
      setErroAnaliseVideo(
        timeout
          ? "A análise demorou demais e foi cancelada. Tente de novo — se persistir, tente com um vídeo mais curto."
          : err instanceof Error
            ? err.message
            : String(err)
      );
    } finally {
      setAnalisandoVideo(false);
    }
  }

  function removerVideoOriginal() {
    setVideoOriginalUrl(null);
    setVideoOriginalNome(null);
    setDescricaoVisualOriginal(null);
    setErroAnaliseVideo(null);
    limparRemocaoDeElemento();
    limparEdicaoDeImagem();
  }

  // Link de um anúncio específico da Ad Library que o usuário encontrou
  // (concorrente/inspiração) — busca o texto real do anúncio (e tenta
  // também achar o vídeo/imagem dele) pra usar de referência, igual ao
  // fluxo de vídeo próprio acima.
  const [urlBiblioteca, setUrlBiblioteca] = useState("");
  const [analisandoBiblioteca, setAnalisandoBiblioteca] = useState(false);
  const [erroBiblioteca, setErroBiblioteca] = useState<string | null>(null);
  const [avisoBiblioteca, setAvisoBiblioteca] = useState<string | null>(null);
  const [imagemPreviewBiblioteca, setImagemPreviewBiblioteca] = useState<string | null>(null);
  const [nomeAnuncioBiblioteca, setNomeAnuncioBiblioteca] = useState<string | null>(null);

  async function analisarLinkBiblioteca() {
    if (!urlBiblioteca.trim()) return;
    setAnalisandoBiblioteca(true);
    setErroBiblioteca(null);
    setAvisoBiblioteca(null);
    setImagemPreviewBiblioteca(null);
    try {
      const res = await fetch("/api/variacoes/analisar-biblioteca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlBiblioteca.trim() }),
        signal: AbortSignal.timeout(150000),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao analisar o anúncio.");

      setReferencia(json.referencia || "");
      if (json.nicho) setNicho(json.nicho);
      setNomeAnuncioBiblioteca(json.pageName || null);

      if (json.videoOriginalUrl) {
        // Mesmo estado do vídeo próprio — o resto do fluxo (reaproveitar
        // visual variação por variação, "conter" sem cortar, etc.) já
        // funciona igual, sem precisar de nenhum código a mais.
        setVideoOriginalUrl(json.videoOriginalUrl);
        setVideoOriginalNome(`Anúncio da Ad Library${json.pageName ? " — " + json.pageName : ""}`);
        setDescricaoVisualOriginal(json.descricaoVisualOriginal || "");
        limparRemocaoDeElemento();
        limparEdicaoDeImagem();
      }
      if (json.imagemPreviewUrl) setImagemPreviewBiblioteca(json.imagemPreviewUrl);
      if (json.aviso) setAvisoBiblioteca(json.aviso);
    } catch (err) {
      const timeout = err instanceof Error && err.name === "TimeoutError";
      setErroBiblioteca(
        timeout
          ? "Demorou demais pra analisar esse anúncio. Tente de novo."
          : err instanceof Error
            ? err.message
            : String(err)
      );
    } finally {
      setAnalisandoBiblioteca(false);
    }
  }

  async function gerarRoteiros() {
    setCarregandoRoteiros(true);
    setErroRoteiros(null);
    setCards([]);
    try {
      const res = await fetch("/api/variacoes/roteiro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referencia,
          nicho,
          quantidade,
          descricaoVisualOriginal: descricaoVisualOriginal || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao gerar roteiros.");

      const variacoes: { texto: string; usarVisualOriginal: boolean; descricaoVisual: string }[] = json.variacoes;
      const novosCards: CardVariacao[] = variacoes.map((v, i) => ({
        texto: v.texto,
        formato: v.usarVisualOriginal && videoOriginalUrl ? "video_original" : "imagem",
        descricaoVisual: v.descricaoVisual || nicho || referencia,
        textoOverlay: "",
        // Alterna pulsar/piscar entre as variações por padrão — assim o lote
        // já sai variado (dá pra ver qual anima melhor pra esse criativo),
        // com o seletor abaixo pra trocar manualmente se quiser.
        animacaoCta: i % 2 === 0 ? "pulsar" : "piscar",
        gerando: false,
        erro: null,
        videoUrl: null,
        progressoPct: null,
        progressoMensagem: null,
        gerandoDuplo: false,
        erroDuplo: null,
        videoUrlVertical: null,
        videoUrlQuadrado: null,
        progressoDuploPct: null,
        progressoDuploMensagem: null,
      }));
      setCards(novosCards);
    } catch (err) {
      setErroRoteiros(err instanceof Error ? err.message : String(err));
    } finally {
      setCarregandoRoteiros(false);
    }
  }

  function atualizarCard(idx: number, patch: Partial<CardVariacao>) {
    setCards((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function corpoDaGeracao(card: CardVariacao) {
    return {
      texto: card.texto,
      formato: card.formato,
      descricaoVisual: card.descricaoVisual,
      // No vídeo original o CTA já vem embutido na imagem — não manda texto
      // de overlay nesse caso (mesmo que o card tenha um valor de uma troca
      // de formato anterior), pra nunca desenhar um botão duplicado em cima
      // do botão que já existe no vídeo.
      textoOverlay: card.formato === "video_original" ? undefined : card.textoOverlay || undefined,
      animacaoCta: card.formato === "video_original" ? undefined : card.animacaoCta,
      // Prioriza a versão já com o elemento removido pela IA (quando o
      // usuário aplicou essa remoção) — senão cai no vídeo original de
      // sempre, que ainda passa pelo retoque visual (cor/corte/vinheta).
      videoOriginalUrl:
        card.formato === "video_original" ? videoOriginalUrlEditado || videoOriginalUrl || undefined : undefined,
      // Só pra ficar salvo junto no histórico (não muda a geração em si).
      nicho: nicho || undefined,
      referencia: referencia || undefined,
    };
  }

  async function gerarVideo(idx: number) {
    const card = cards[idx];
    // Limpa o erro dos DOIS botões (vertical e "2 formatos") — são o mesmo
    // card, e um erro antigo de uma tentativa no outro botão não pode ficar
    // preso na tela depois que essa tentativa aqui deu certo.
    atualizarCard(idx, {
      gerando: true,
      erro: null,
      erroDuplo: null,
      progressoPct: 0,
      progressoMensagem: "Iniciando...",
    });
    try {
      const res = await fetch("/api/variacoes/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpoDaGeracao(card)),
      });
      const resultado = await lerRespostaComProgresso(res, (mensagem, pct) => {
        atualizarCard(idx, { progressoMensagem: mensagem, progressoPct: pct });
      });
      const url = base64ParaUrlDeVideo(String(resultado.videoBase64 || ""));
      atualizarCard(idx, { videoUrl: url, gerando: false, progressoPct: null, progressoMensagem: null });
    } catch (err) {
      atualizarCard(idx, {
        erro: err instanceof Error ? err.message : String(err),
        gerando: false,
        progressoPct: null,
        progressoMensagem: null,
      });
    }
  }

  async function gerarVideoDuploFormato(idx: number) {
    const card = cards[idx];
    atualizarCard(idx, {
      gerandoDuplo: true,
      erroDuplo: null,
      erro: null,
      progressoDuploPct: 0,
      progressoDuploMensagem: "Iniciando...",
    });
    try {
      const res = await fetch("/api/variacoes/gerar-multiformato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpoDaGeracao(card)),
      });
      const resultado = await lerRespostaComProgresso(res, (mensagem, pct) => {
        atualizarCard(idx, { progressoDuploMensagem: mensagem, progressoDuploPct: pct });
      });

      atualizarCard(idx, {
        videoUrlVertical: base64ParaUrlDeVideo(String(resultado.vertical || "")),
        videoUrlQuadrado: base64ParaUrlDeVideo(String(resultado.quadrado || "")),
        gerandoDuplo: false,
        progressoDuploPct: null,
        progressoDuploMensagem: null,
      });
    } catch (err) {
      atualizarCard(idx, {
        erroDuplo: err instanceof Error ? err.message : String(err),
        gerandoDuplo: false,
        progressoDuploPct: null,
        progressoDuploMensagem: null,
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Variações de criativo</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Descreva o criativo vencedor (nosso) — ou envie o vídeo dele — e gere novas versões:
        roteiro, narração e vídeo montado, tudo aqui dentro.
      </p>

      <div className="mt-6 flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6">
        <div>
          <label className="block text-sm font-medium text-zinc-700">
            Descrição do criativo vencedor (referência)
          </label>
          <textarea
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder='ex: "Free course to learn forklift operation" — vídeo 19s, imagem estática de empilhadeira + narração ElevenLabs, CTA "Get started"'
            rows={3}
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="rounded-md border border-dashed border-zinc-300 p-3">
          <label className="block text-sm font-medium text-zinc-700">
            Ou envie o vídeo do criativo vencedor (opcional)
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            A IA assiste ao vídeo, preenche a referência e o nicho sozinha, e decide em cada
            variação se reaproveita esse mesmo vídeo como visual ou gera uma cena nova — o que
            fizer mais sentido pro roteiro. Até {TAMANHO_MAXIMO_VIDEO_MB}MB.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="file"
              accept="video/*"
              onChange={selecionarVideoOriginal}
              disabled={analisandoVideo}
              className="text-sm"
            />
            {videoOriginalNome && (
              <button
                onClick={removerVideoOriginal}
                type="button"
                className="text-xs text-zinc-500 underline underline-offset-2"
              >
                remover vídeo
              </button>
            )}
          </div>
          {analisandoVideo && <p className="mt-2 text-sm text-zinc-600">Analisando vídeo...</p>}
          {erroAnaliseVideo && <p className="mt-2 text-sm text-red-700">{erroAnaliseVideo}</p>}
          {videoOriginalNome && !analisandoVideo && !erroAnaliseVideo && (
            <p className="mt-2 text-sm text-green-700">
              Vídeo analisado: {videoOriginalNome} — referência e nicho preenchidos abaixo (pode editar).
            </p>
          )}
        </div>

        {videoOriginalUrl && !analisandoVideo && (
          <div className="rounded-md border border-dashed border-zinc-300 p-3">
            <label className="block text-sm font-medium text-zinc-700">
              Apagar (ou reescrever) um elemento do vídeo original com IA (opcional)
            </label>
            <p className="mt-1 text-xs text-zinc-500">
              O retoque visual (cor/corte/vinheta) já é aplicado automaticamente em toda variação
              que usa esse vídeo. Se quiser ir além, marque a área com o elemento (ex: o
              botão/texto de CTA já embutido no vídeo) abaixo — dá pra só apagar, ou apagar e
              escrever um texto novo no lugar (com fonte e cor à sua escolha). É pago (~$0,02 por
              segundo de vídeo) e demora cerca de 3 minutos, mas só precisa ser feito UMA vez: o
              resultado vale pra todas as variações que reaproveitarem esse vídeo.
            </p>
            <p className="mt-1 text-xs font-medium text-amber-700">
              Atenção: essa opção e a de &quot;editar com IA de imagem&quot; abaixo são
              alternativas, não somam — as duas partem sempre do vídeo original e a que você
              aplicar por último substitui o resultado da outra. Pra combinar remoção/texto E
              edição de elementos, use só o painel de baixo (ele já tem um campo pra corrigir
              texto também).
            </p>

            <SeletorDeMascara
              key={videoOriginalUrl}
              videoUrl={videoOriginalUrl}
              regiao={regiaoParaApagar}
              onRegiaoChange={(r) => {
                setRegiaoParaApagar(r);
                setVideoOriginalUrlEditado(null); // uma nova marcação invalida o resultado anterior
                setErroRemocao(null);
              }}
            />

            {regiaoParaApagar && regiaoParaApagar.w > 0 && regiaoParaApagar.h > 0 && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-zinc-500">
                  Escrever um texto novo no lugar (opcional — deixe em branco pra só apagar)
                </label>
                <input
                  value={textoNovo}
                  onChange={(e) => setTextoNovo(e.target.value)}
                  placeholder="ex: Comece agora"
                  className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                />
                {textoNovo && (
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-xs text-zinc-500">Cor</label>
                      <input
                        type="color"
                        value={corTextoNovo}
                        onChange={(e) => setCorTextoNovo(e.target.value)}
                        className="mt-1 h-9 w-14 rounded-md border border-zinc-300"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-zinc-500">Fonte</label>
                      <select
                        value={fonteTextoNovo}
                        onChange={(e) => setFonteTextoNovo(e.target.value)}
                        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="padrao">Padrão (sem serifa)</option>
                        <option value="impacto">Impacto (condensada, tipo cartaz)</option>
                        <option value="condensada">Condensada (caixa alta)</option>
                        <option value="elegante">Elegante (serifada)</option>
                        <option value="moderna">Moderna (arredondada)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={aplicarRemocaoDeElemento}
                type="button"
                disabled={
                  aplicandoRemocao || !regiaoParaApagar || regiaoParaApagar.w <= 0 || regiaoParaApagar.h <= 0
                }
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {aplicandoRemocao
                  ? "Aplicando IA... (pode levar uns 3 min)"
                  : textoNovo
                    ? "Aplicar remoção + texto novo"
                    : "Aplicar remoção com IA"}
              </button>
              {(regiaoParaApagar || videoOriginalUrlEditado) && (
                <button
                  onClick={limparRemocaoDeElemento}
                  type="button"
                  disabled={aplicandoRemocao}
                  className="text-xs text-zinc-500 underline underline-offset-2 disabled:opacity-40"
                >
                  limpar seleção
                </button>
              )}
            </div>
            {erroRemocao && <p className="mt-2 text-sm text-red-700">{erroRemocao}</p>}
            {videoOriginalUrlEditado && !aplicandoRemocao && (
              <div className="mt-3">
                <p className="text-sm text-green-700">
                  Elemento removido — esse vídeo (já editado) vai ser usado em toda variação com
                  &quot;Vídeo original enviado&quot;.
                </p>
                <video src={videoOriginalUrlEditado} controls className="mt-2 max-h-64 rounded-md border border-zinc-200" />
              </div>
            )}
          </div>
        )}

        {videoOriginalUrl && !analisandoVideo && (
          <div className="rounded-md border border-dashed border-zinc-300 p-3">
            <label className="block text-sm font-medium text-zinc-700">
              Ou edite o vídeo com IA de imagem — troque/altere elementos (opcional)
            </label>
            <p className="mt-1 text-xs text-zinc-500">
              Pra criativos que são, na prática, uma imagem parada (sem movimento de cena):
              descreva em texto o que quer mudar (ex: &quot;troque o logo do certificado por um
              ícone de medalha dourada&quot;, &quot;mude o texto do topo pra fonte itálica em
              vermelho&quot;) e a IA (Gemini) edita a imagem mantendo o resto igual. Opcionalmente
              anexe uma imagem de referência do elemento novo. É rápido (menos de 1 min) e o
              resultado vira o vídeo usado em toda variação com &quot;Vídeo original enviado&quot;
              — se o vídeo tiver movimento real de cena, essa opção não é indicada (use a de
              apagar elemento acima).
            </p>
            <p className="mt-1 text-xs font-medium text-amber-700">
              Atenção: essa opção substitui qualquer resultado do painel &quot;Apagar elemento&quot;
              acima (as duas partem do vídeo original, não uma da outra). Pra combinar edição de
              elementos com uma correção de texto, use o campo &quot;Corrigir/escrever um
              texto&quot; abaixo, na mesma aplicação — não o painel de cima.
            </p>

            <textarea
              value={instrucaoEdicaoImagem}
              onChange={(e) => setInstrucaoEdicaoImagem(e.target.value)}
              placeholder="ex: troque o logo do certificado por um ícone de medalha dourada"
              rows={2}
              className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />

            <div className="mt-2 flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                onChange={selecionarImagemReferencia}
                disabled={enviandoImagemReferencia}
                className="text-sm"
              />
              {enviandoImagemReferencia && <span className="text-xs text-zinc-500">Enviando imagem...</span>}
              {imagemReferenciaNome && !enviandoImagemReferencia && (
                <span className="text-xs text-green-700">Referência: {imagemReferenciaNome}</span>
              )}
              {imagemReferenciaUrl && (
                <button
                  onClick={() => {
                    setImagemReferenciaUrl(null);
                    setImagemReferenciaNome(null);
                  }}
                  type="button"
                  className="text-xs text-zinc-500 underline underline-offset-2"
                >
                  remover referência
                </button>
              )}
            </div>

            <div className="mt-4 border-t border-zinc-200 pt-3">
              <label className="block text-xs font-medium text-zinc-500">
                Corrigir/escrever um texto por cima do resultado (opcional — recomendado se a
                instrução acima envolve mudar algum texto)
              </label>
              <p className="mt-1 text-xs text-zinc-500">
                IA generativa erra ortografia com frequência. Pra texto sair certo, não peça pra
                IA escrever o texto na instrução acima — em vez disso, marque abaixo a área onde
                ele vai ficar (no resultado da IA) e escreva o texto exato aqui: a gente desenha
                ele por cima, com fonte e cor à sua escolha.
              </p>
              <div className="mt-2">
                <SeletorDeMascara
                  key={videoOriginalUrl}
                  videoUrl={videoOriginalUrl}
                  regiao={regiaoTextoImagem}
                  onRegiaoChange={setRegiaoTextoImagem}
                />
              </div>
              {regiaoTextoImagem && regiaoTextoImagem.w > 0 && regiaoTextoImagem.h > 0 && (
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-zinc-500">Texto</label>
                    <input
                      value={textoCorrigido}
                      onChange={(e) => setTextoCorrigido(e.target.value)}
                      placeholder="ex: FREE NFL LIVE"
                      className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500">Cor</label>
                    <input
                      type="color"
                      value={corTextoCorrigido}
                      onChange={(e) => setCorTextoCorrigido(e.target.value)}
                      className="mt-1 h-9 w-14 rounded-md border border-zinc-300"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-zinc-500">Fonte</label>
                    <select
                      value={fonteTextoCorrigido}
                      onChange={(e) => setFonteTextoCorrigido(e.target.value)}
                      className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="padrao">Padrão (sem serifa)</option>
                      <option value="impacto">Impacto (condensada, tipo cartaz)</option>
                      <option value="condensada">Condensada (caixa alta)</option>
                      <option value="elegante">Elegante (serifada)</option>
                      <option value="moderna">Moderna (arredondada)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={aplicarEdicaoComImagemIA}
                type="button"
                disabled={aplicandoEdicaoImagem || !instrucaoEdicaoImagem.trim()}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {aplicandoEdicaoImagem ? "Aplicando IA..." : "Aplicar edição com IA"}
              </button>
              {(instrucaoEdicaoImagem || imagemReferenciaUrl) && (
                <button
                  onClick={limparEdicaoDeImagem}
                  type="button"
                  disabled={aplicandoEdicaoImagem}
                  className="text-xs text-zinc-500 underline underline-offset-2 disabled:opacity-40"
                >
                  limpar seleção
                </button>
              )}
            </div>
            {erroEdicaoImagem && <p className="mt-2 text-sm text-red-700">{erroEdicaoImagem}</p>}
            {videoOriginalUrlEditado && !aplicandoEdicaoImagem && !aplicandoRemocao && (
              <div className="mt-3">
                <p className="text-sm text-green-700">
                  Vídeo editado — esse vídeo vai ser usado em toda variação com &quot;Vídeo
                  original enviado&quot;.
                </p>
                <video src={videoOriginalUrlEditado} controls className="mt-2 max-h-64 rounded-md border border-zinc-200" />
              </div>
            )}
          </div>
        )}

        <div className="rounded-md border border-dashed border-zinc-300 p-3">
          <label className="block text-sm font-medium text-zinc-700">
            Ou cole o link de um anúncio que você encontrou na Ad Library (opcional)
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            De um concorrente ou inspiração — cole o link do anúncio específico (o que tem
            &quot;id=&quot; na URL, ex: facebook.com/ads/library/?id=123...). A gente tenta buscar
            o texto real do anúncio (título, descrição) e também o vídeo/imagem dele — quando acha
            o vídeo, ele fica disponível pra reaproveitar igual ao vídeo próprio acima. Isso é uma
            tentativa por fora da API oficial da Meta, então pode não achar tudo sempre.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={urlBiblioteca}
              onChange={(e) => setUrlBiblioteca(e.target.value)}
              placeholder="https://www.facebook.com/ads/library/?id=..."
              disabled={analisandoBiblioteca}
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
            <button
              onClick={analisarLinkBiblioteca}
              type="button"
              disabled={analisandoBiblioteca || !urlBiblioteca.trim()}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {analisandoBiblioteca ? "Analisando..." : "Analisar anúncio"}
            </button>
          </div>
          {erroBiblioteca && <p className="mt-2 text-sm text-red-700">{erroBiblioteca}</p>}
          {avisoBiblioteca && <p className="mt-2 text-sm text-amber-700">{avisoBiblioteca}</p>}
          {nomeAnuncioBiblioteca && !analisandoBiblioteca && !erroBiblioteca && (
            <p className="mt-2 text-sm text-green-700">
              Anúncio de &quot;{nomeAnuncioBiblioteca}&quot; analisado — referência e nicho
              preenchidos abaixo (pode editar).
            </p>
          )}
          {imagemPreviewBiblioteca && (
            <div className="mt-2">
              <p className="text-xs text-zinc-500">Imagem do anúncio encontrada (só como preview, não é reaproveitada pixel a pixel):</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagemPreviewBiblioteca} alt="Preview do anúncio encontrado" className="mt-1 max-h-40 rounded-md border border-zinc-200" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label className="block text-sm font-medium text-zinc-700">Nicho</label>
            <input
              value={nicho}
              onChange={(e) => setNicho(e.target.value)}
              placeholder="ex: curso de empilhadeira"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
            {nicho && (
              <a
                href={`/garimpo?termo=${encodeURIComponent(nicho)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs text-zinc-500 underline underline-offset-2"
              >
                Buscar esse nicho no Garimpo →
              </a>
            )}
          </div>
          <div className="sm:w-40">
            <label className="block text-sm font-medium text-zinc-700">Quantidade</label>
            <input
              type="number"
              min={1}
              max={6}
              value={quantidade}
              onChange={(e) => setQuantidade(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <button
          onClick={gerarRoteiros}
          disabled={carregandoRoteiros || !referencia}
          className="self-start rounded-md bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {carregandoRoteiros ? "Gerando roteiros..." : "Gerar roteiros"}
        </button>
        {erroRoteiros && <p className="text-sm text-red-700">{erroRoteiros}</p>}
      </div>

      {cards.length > 0 && (
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {cards.map((card, idx) => (
            <div key={idx} className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-sm font-medium text-zinc-500">Variação {idx + 1}</p>
              <textarea
                value={card.texto}
                onChange={(e) => atualizarCard(idx, { texto: e.target.value })}
                rows={3}
                className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />

              <div className="mt-3 flex flex-wrap gap-3">
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    checked={card.formato === "imagem"}
                    onChange={() => atualizarCard(idx, { formato: "imagem" })}
                  />
                  Imagem estática
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    checked={card.formato === "video"}
                    onChange={() => atualizarCard(idx, { formato: "video" })}
                  />
                  Vídeo stock
                </label>
                {videoOriginalUrl && (
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="radio"
                      checked={card.formato === "video_original"}
                      onChange={() => atualizarCard(idx, { formato: "video_original" })}
                    />
                    Vídeo original enviado
                  </label>
                )}
              </div>
              {card.formato === "video_original" && (
                <p className="mt-1 text-xs text-zinc-500">
                  A IA achou que a cena do seu vídeo ainda combina com esse roteiro — vai usar o
                  vídeo enviado como visual, só trocando a narração. O vídeo original já tem o
                  próprio CTA embutido na imagem, então não adicionamos outro botão em cima (pra
                  não sobrepor).
                </p>
              )}

              {card.formato !== "video_original" && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-zinc-500">
                    {card.formato === "imagem" ? "Descrição da imagem (cena)" : "Termo de busca do vídeo (stock)"}
                  </label>
                  <input
                    value={card.descricaoVisual}
                    onChange={(e) => atualizarCard(idx, { descricaoVisual: e.target.value })}
                    className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                  />
                </div>
              )}

              {card.formato !== "video_original" && (
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-zinc-500">Texto sobreposto (opcional, ex. CTA)</label>
                    <input
                      value={card.textoOverlay}
                      onChange={(e) => atualizarCard(idx, { textoOverlay: e.target.value })}
                      placeholder="Get started >"
                      className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                    />
                  </div>
                  {card.textoOverlay && (
                    <div className="sm:w-44">
                      <label className="block text-xs font-medium text-zinc-500">Animação do botão</label>
                      <select
                        value={card.animacaoCta}
                        onChange={(e) => atualizarCard(idx, { animacaoCta: e.target.value as AnimacaoCta })}
                        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="pulsar">Pulsar</option>
                        <option value="piscar">Piscar</option>
                        <option value="estatico">Sem animação</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={() => gerarVideo(idx)}
                  disabled={card.gerando}
                  className="flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {card.gerando ? "Gerando..." : "Gerar vídeo (vertical)"}
                </button>
                <button
                  onClick={() => gerarVideoDuploFormato(idx)}
                  disabled={card.gerandoDuplo}
                  className="flex-1 rounded-md border border-brand px-4 py-2 text-sm font-medium text-brand disabled:opacity-40"
                >
                  {card.gerandoDuplo ? "Gerando..." : "Gerar nos 2 formatos"}
                </button>
              </div>

              {card.progressoPct !== null && (
                <div className="mt-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-teal to-brand-green transition-all duration-300"
                      style={{ width: `${Math.max(4, card.progressoPct)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {card.progressoMensagem} ({card.progressoPct}%)
                  </p>
                </div>
              )}
              {card.progressoDuploPct !== null && (
                <div className="mt-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-teal to-brand-green transition-all duration-300"
                      style={{ width: `${Math.max(4, card.progressoDuploPct)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    2 formatos: {card.progressoDuploMensagem} ({card.progressoDuploPct}%)
                  </p>
                </div>
              )}

              {card.erro && <p className="mt-2 text-sm text-red-700">{card.erro}</p>}
              {card.erroDuplo && <p className="mt-2 text-sm text-red-700">{card.erroDuplo}</p>}

              {card.videoUrl && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-zinc-500">Vertical (1080x1920)</p>
                  <video src={card.videoUrl} controls className="mt-1 w-full rounded-md" />
                  <a
                    href={card.videoUrl}
                    download={`variacao-${idx + 1}.mp4`}
                    className="mt-2 inline-block text-sm text-brand underline underline-offset-2"
                  >
                    Baixar vídeo
                  </a>
                </div>
              )}

              {(card.videoUrlVertical || card.videoUrlQuadrado) && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {card.videoUrlVertical && (
                    <div>
                      <p className="text-xs font-medium text-zinc-500">Vertical (1080x1920)</p>
                      <video src={card.videoUrlVertical} controls className="mt-1 w-full rounded-md" />
                      <a
                        href={card.videoUrlVertical}
                        download={`variacao-${idx + 1}-vertical.mp4`}
                        className="mt-2 inline-block text-sm text-brand underline underline-offset-2"
                      >
                        Baixar vertical
                      </a>
                    </div>
                  )}
                  {card.videoUrlQuadrado && (
                    <div>
                      <p className="text-xs font-medium text-zinc-500">Quadrado (1080x1080)</p>
                      <video src={card.videoUrlQuadrado} controls className="mt-1 w-full rounded-md" />
                      <a
                        href={card.videoUrlQuadrado}
                        download={`variacao-${idx + 1}-quadrado.mp4`}
                        className="mt-2 inline-block text-sm text-brand underline underline-offset-2"
                      >
                        Baixar quadrado
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
