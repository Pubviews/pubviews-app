"use client";

import { useState } from "react";

type Formato = "imagem" | "video";

interface CardVariacao {
  texto: string;
  formato: Formato;
  descricaoVisual: string;
  textoOverlay: string;
  gerando: boolean;
  erro: string | null;
  videoUrl: string | null;
}

export default function VariacoesPage() {
  const [referencia, setReferencia] = useState("");
  const [nicho, setNicho] = useState("");
  const [quantidade, setQuantidade] = useState(3);
  const [carregandoRoteiros, setCarregandoRoteiros] = useState(false);
  const [erroRoteiros, setErroRoteiros] = useState<string | null>(null);
  const [cards, setCards] = useState<CardVariacao[]>([]);

  async function gerarRoteiros() {
    setCarregandoRoteiros(true);
    setErroRoteiros(null);
    setCards([]);
    try {
      const res = await fetch("/api/variacoes/roteiro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencia, nicho, quantidade }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao gerar roteiros.");
      const novosCards: CardVariacao[] = (json.variacoes as string[]).map((texto) => ({
        texto,
        formato: "imagem",
        descricaoVisual: nicho || referencia,
        textoOverlay: "",
        gerando: false,
        erro: null,
        videoUrl: null,
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

  async function gerarVideo(idx: number) {
    const card = cards[idx];
    atualizarCard(idx, { gerando: true, erro: null });
    try {
      const res = await fetch("/api/variacoes/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: card.texto,
          formato: card.formato,
          descricaoVisual: card.descricaoVisual,
          textoOverlay: card.textoOverlay || undefined,
        }),
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

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Variações de criativo</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Descreva o criativo vencedor (nosso) e gere novas versões: roteiro, narração e vídeo
        montado, tudo aqui dentro.
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

              <div className="mt-3 flex gap-3">
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
              </div>

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

              <div className="mt-3">
                <label className="block text-xs font-medium text-zinc-500">Texto sobreposto (opcional, ex. CTA)</label>
                <input
                  value={card.textoOverlay}
                  onChange={(e) => atualizarCard(idx, { textoOverlay: e.target.value })}
                  placeholder="Get started >"
                  className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>

              <button
                onClick={() => gerarVideo(idx)}
                disabled={card.gerando}
                className="mt-4 w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {card.gerando ? "Gerando vídeo (pode levar ~1 min)..." : "Gerar vídeo"}
              </button>

              {card.erro && <p className="mt-2 text-sm text-red-700">{card.erro}</p>}

              {card.videoUrl && (
                <div className="mt-4">
                  <video src={card.videoUrl} controls className="w-full rounded-md" />
                  <a
                    href={card.videoUrl}
                    download={`variacao-${idx + 1}.mp4`}
                    className="mt-2 inline-block text-sm text-zinc-900 underline underline-offset-2"
                  >
                    Baixar vídeo
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
