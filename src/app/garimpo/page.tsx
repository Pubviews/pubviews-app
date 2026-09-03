"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface GarimpoResult {
  page_id: string;
  page_name: string;
  site_name: string | null;
  total_active_ads: number;
  max_days_active: number;
  atende_duplicacao_3x: boolean;
  atende_30_dias: boolean;
  status: "CANDIDATO FORTE" | "CANDIDATO" | "DESCARTAR";
  link_biblioteca: string;
}

const STATUS_STYLE: Record<string, string> = {
  "CANDIDATO FORTE": "bg-emerald-100 text-emerald-800",
  CANDIDATO: "bg-amber-100 text-amber-800",
  DESCARTAR: "bg-zinc-100 text-zinc-500",
};

function GarimpoConteudo() {
  // Pré-preenche e já busca sozinho quando vem de "Buscar esse nicho no
  // Garimpo" na tela de Variações (link com ?termo=...).
  const searchParams = useSearchParams();
  const termoInicial = searchParams.get("termo") || "";

  const [searchTerms, setSearchTerms] = useState(termoInicial);
  const [countries, setCountries] = useState("US");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<GarimpoResult[] | null>(null);

  async function buscar(termoParaBuscar?: string) {
    const termo = termoParaBuscar ?? searchTerms;
    if (!termo) return;
    setLoading(true);
    setError(null);
    setResultados(null);
    try {
      const res = await fetch("/api/garimpo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchTerms: termo,
          countries: countries
            .split(",")
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao buscar.");
      setResultados(json.resultados);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!termoInicial) return;
    // setTimeout empurra a chamada (e o setState lá dentro) pra fora da
    // execução síncrona do efeito — só pra agradar a regra do eslint contra
    // setState síncrono direto no corpo do efeito.
    const id = setTimeout(() => buscar(termoInicial), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Garimpo — Ad Library</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Busca inteligência de mercado. Resultado aqui é inspiração, não garantia de que é um
        campeão de fato.
      </p>

      <div className="mt-6 flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-zinc-700">Termo de busca</label>
          <input
            value={searchTerms}
            onChange={(e) => setSearchTerms(e.target.value)}
            placeholder="ex: forklift certification"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="sm:w-56">
          <label className="block text-sm font-medium text-zinc-700">Países (separados por vírgula)</label>
          <input
            value={countries}
            onChange={(e) => setCountries(e.target.value)}
            placeholder="US,CA,GB"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => buscar()}
          disabled={loading || !searchTerms}
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {loading ? "Buscando..." : "Buscar"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {resultados && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-500">
                <th className="px-4 py-3">Página</th>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">Anúncios ativos</th>
                <th className="px-4 py-3">Dias ativo (máx.)</th>
                <th className="px-4 py-3">3+ duplicações</th>
                <th className="px-4 py-3">30+ dias</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Biblioteca</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((r) => (
                <tr key={r.page_id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-4 py-3 font-medium">{r.page_name}</td>
                  <td className="px-4 py-3 text-zinc-600">{r.site_name || "—"}</td>
                  <td className="px-4 py-3">{r.total_active_ads}</td>
                  <td className="px-4 py-3">{r.max_days_active}</td>
                  <td className="px-4 py-3">{r.atende_duplicacao_3x ? "Sim" : "Não"}</td>
                  <td className="px-4 py-3">{r.atende_30_dias ? "Sim" : "Não"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={r.link_biblioteca}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-900 underline underline-offset-2"
                    >
                      abrir
                    </a>
                  </td>
                </tr>
              ))}
              {resultados.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-zinc-500">
                    Nenhum resultado para esse termo/países.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function GarimpoPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl px-6 py-10 text-sm text-zinc-500">Carregando...</div>}>
      <GarimpoConteudo />
    </Suspense>
  );
}
