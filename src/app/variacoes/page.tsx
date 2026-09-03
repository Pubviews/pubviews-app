"use client";

import { useState, type ChangeEvent } from "react";
import { upload } from "@vercel/blob/client";

type Formato = "imagem" | "video" | "video_original";

interface CardVariacao {
  texto: string;
  formato: Formato;
  descricaoVisual: string;
  textoOverlay: string;
  gerando: boolean;
  erro: string | null;
  videoUrl: string | null;
  // Resultado do botão "Gerar nos 2 formatos": vertical (1080x1920) + quadrado (1080x1080).
  gerandoDuplo: boolean;
  erroDuplo: string | null;
  videoUrlVertical: string | null;
  videoUrlQuadrado: string | null;
}

function base64ParaUrlDeVideo(base64: string, mimeType = "video/mp4"): string {
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  const blob = new Blob([array], { type: mimeType });
  return URL.createObjectURL(blob);
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
      const novosCards: CardVariacao[] = variacoes.map((v) => ({
        texto: v.texto,
        formato: v.usarVisualOriginal && videoOriginalUrl ? "video_original" : "imagem",
        descricaoVisual: v.descricaoVisual || nicho || referencia,
        textoOverlay: "",
        gerando: false,
        erro: null,
        videoUrl: null,
        gerandoDuplo: false,
        erroDuplo: null,
        videoUrlVertical: null,
        videoUrlQuadrado: null,
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
      textoOverlay: card.textoOverlay || undefined,
      videoOriginalUrl: card.formato === "video_original" ? videoOriginalUrl || undefined : undefined,
    };
  }

  async function gerarVideo(idx: number) {
    const card = cards[idx];
    // Limpa o erro dos DOIS botões (vertical e "2 formatos") — são o mesmo
    // card, e um erro antigo de uma tentativa no outro botão não pode ficar
    // preso na tela depois que essa tentativa aqui deu certo.
    atualizarCard(idx, { gerando: true, erro: null, erroDuplo: null });
    try {
      const res = await fetch("/api/variacoes/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpoDaGeracao(card)),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "Erro ao gerar vídeo." }));
        throw new Error(json.error || "Erro ao gerar vídeo.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      atualizarCard(idx, { videoUrl: url, gerando: false });
    } catch (err) {
      atualizarCard(idx, { erro: err instanceof Error ? err.message : String(err), gerando: false });
    }
  }

  async function gerarVideoDuploFormato(idx: number) {
    const card = cards[idx];
    atualizarCard(idx, { gerandoDuplo: true, erroDuplo: null, erro: null });
    try {
      const res = await fetch("/api/variacoes/gerar-multiformato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpoDaGeracao(card)),
      });
      const json = await res.json().catch(() => ({ error: "Erro ao gerar os vídeos." }));
      if (!res.ok) throw new Error(json.error || "Erro ao gerar os vídeos.");

      atualizarCard(idx, {
        videoUrlVertical: base64ParaUrlDeVideo(json.vertical),
        videoUrlQuadrado: base64ParaUrlDeVideo(json.quadrado),
        gerandoDuplo: false,
      });
    } catch (err) {
      atualizarCard(idx, { erroDuplo: err instanceof Error ? err.message : String(err), gerandoDuplo: false });
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

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label className="block text-sm font-medium text-zinc-700">Nicho</label>
            <input
              value={nicho}
              onChange={(e) => setNicho(e.target.value)}
              placeholder="ex: curso de empilhadeira"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
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
          className="self-start rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
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
                  vídeo enviado como visual, só trocando narração e CTA.
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

              <div className="mt-3">
                <label className="block text-xs font-medium text-zinc-500">Texto sobreposto (opcional, ex. CTA)</label>
                <input
                  value={card.textoOverlay}
                  onChange={(e) => atualizarCard(idx, { textoOverlay: e.target.value })}
                  placeholder="Get started >"
                  className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={() => gerarVideo(idx)}
                  disabled={card.gerando}
                  className="flex-1 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {card.gerando ? "Gerando vídeo (pode levar ~1 min)..." : "Gerar vídeo (vertical)"}
                </button>
                <button
                  onClick={() => gerarVideoDuploFormato(idx)}
                  disabled={card.gerandoDuplo}
                  className="flex-1 rounded-md border border-zinc-900 px-4 py-2 text-sm font-medium text-zinc-900 disabled:opacity-40"
                >
                  {card.gerandoDuplo ? "Gerando os 2 formatos (pode levar ~1-2 min)..." : "Gerar nos 2 formatos"}
                </button>
              </div>

              {card.erro && <p className="mt-2 text-sm text-red-700">{card.erro}</p>}
              {card.erroDuplo && <p className="mt-2 text-sm text-red-700">{card.erroDuplo}</p>}

              {card.videoUrl && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-zinc-500">Vertical (1080x1920)</p>
                  <video src={card.videoUrl} controls className="mt-1 w-full rounded-md" />
                  <a
                    href={card.videoUrl}
                    download={`variacao-${idx + 1}.mp4`}
                    className="mt-2 inline-block text-sm text-zinc-900 underline underline-offset-2"
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
                        className="mt-2 inline-block text-sm text-zinc-900 underline underline-offset-2"
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
                        className="mt-2 inline-block text-sm text-zinc-900 underline underline-offset-2"
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
