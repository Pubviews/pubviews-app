"use client";

import { useEffect, useState } from "react";

interface EntradaHistorico {
  id: number;
  criadoEm: string;
  nicho: string | null;
  referencia: string | null;
  roteiro: string;
  formato: string;
  formatoVideo: string;
  videoUrl: string;
}

const ROTULO_FORMATO: Record<string, string> = {
  imagem: "Imagem gerada por IA",
  video: "Vídeo de banco (Pexels)",
  video_original: "Vídeo original reaproveitado",
};

function formatarData(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function HistoricoPage() {
  const [itens, setItens] = useState<EntradaHistorico[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroNicho, setFiltroNicho] = useState("");
  const [temMais, setTemMais] = useState(true);

  async function carregar(reiniciar: boolean) {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "24");
      if (filtroNicho) params.set("nicho", filtroNicho);
      if (!reiniciar && itens.length > 0) {
        params.set("antesDoId", String(itens[itens.length - 1].id));
      }
      const res = await fetch(`/api/variacoes/historico?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao carregar histórico.");
      const novos: EntradaHistorico[] = json.itens;
      setItens((prev) => (reiniciar ? novos : [...prev, ...novos]));
      setTemMais(novos.length >= 24);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    // setTimeout empurra a chamada (e o setState lá dentro) pra fora da
    // execução síncrona do efeito — mesmo padrão usado no Garimpo.
    const id = setTimeout(() => carregar(true), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function excluir(id: number) {
    const anterior = itens;
    setItens((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/variacoes/historico/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Falha ao excluir.");
    } catch {
      // se falhar, devolve o item pra lista
      setItens(anterior);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Histórico de variações</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Todos os vídeos já gerados na tela de Variações, pra voltar depois ou compartilhar com alguém do
        escritório — cada vídeo aqui fica hospedado (Vercel Blob), então o link funciona mesmo depois de
        fechar a aba.
      </p>

      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-zinc-700">Filtrar por nicho</label>
          <input
            value={filtroNicho}
            onChange={(e) => setFiltroNicho(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && carregar(true)}
            placeholder="ex: curso de empilhadeira"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => carregar(true)}
          disabled={carregando}
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {carregando && itens.length === 0 ? "Buscando..." : "Filtrar"}
        </button>
      </div>

      {erro && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{erro}</div>
      )}

      {itens.length === 0 && !carregando && !erro && (
        <p className="mt-8 text-sm text-zinc-500">
          Nenhuma variação salva ainda. Gere um vídeo na tela de{" "}
          <a href="/variacoes" className="underline underline-offset-2">
            Variações
          </a>{" "}
          que ele aparece aqui automaticamente.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {itens.map((item) => (
          <div key={item.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <video
              src={item.videoUrl}
              controls
              className="w-full bg-zinc-100"
              style={{ aspectRatio: item.formatoVideo === "quadrado" ? "1 / 1" : "9 / 16" }}
            />
            <div className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                  {item.formatoVideo === "quadrado" ? "Quadrado" : "Vertical"}
                </span>
                <span className="text-xs text-zinc-400">{formatarData(item.criadoEm)}</span>
              </div>
              {item.nicho && <p className="mt-2 text-sm font-medium text-zinc-800">{item.nicho}</p>}
              <p className="mt-1 line-clamp-3 text-xs text-zinc-500">{item.roteiro}</p>
              <p className="mt-1 text-xs text-zinc-400">{ROTULO_FORMATO[item.formato] || item.formato}</p>
              <div className="mt-3 flex items-center justify-between">
                <a
                  href={item.videoUrl}
                  download
                  className="text-xs font-medium text-zinc-900 underline underline-offset-2"
                >
                  Baixar
                </a>
                <button onClick={() => excluir(item.id)} className="text-xs text-red-600 hover:underline">
                  Excluir
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {itens.length > 0 && temMais && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => carregar(false)}
            disabled={carregando}
            className="rounded-md border border-zinc-300 bg-white px-5 py-2 text-sm font-medium text-zinc-700 disabled:opacity-40"
          >
            {carregando ? "Carregando..." : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}
