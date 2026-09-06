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

interface MelhorTexto {
  texto: string;
  vezes: number;
  paginas: string[];
}

interface NichoResumo {
  nicho: string;
  paginas: number;
  total_active_ads: number;
  max_days_active: number;
  melhor_status: "CANDIDATO FORTE" | "CANDIDATO" | "DESCARTAR";
  paginas_detalhe: {
    page_id: string;
    page_name: string;
    status: "CANDIDATO FORTE" | "CANDIDATO" | "DESCARTAR";
    total_active_ads: number;
    max_days_active: number;
  }[];
}

const STATUS_STYLE: Record<string, string> = {
  "CANDIDATO FORTE": "bg-emerald-100 text-emerald-800",
  CANDIDATO: "bg-amber-100 text-amber-800",
  DESCARTAR: "bg-zinc-100 text-zinc-500",
};

const TIPO_TEXTO_ROTULO: Record<string, string> = {
  texto_principal: "Textos Principais mais usados no nicho",
  titulo: "Títulos mais usados no nicho",
  descricao: "Descrições mais usadas no nicho",
};

/**
 * Um texto (Texto Principal / Título / Descrição) que se repete entre
 * anúncios ativos de páginas CANDIDATO/CANDIDATO FORTE — com botão pra gerar
 * variações dele via IA sob demanda (guarda o resultado só nesse cartão).
 */
function CartaoDeTexto({
  item,
  tipo,
  nicho,
}: {
  item: MelhorTexto;
  tipo: "texto_principal" | "titulo" | "descricao";
  nicho: string;
}) {
  const [variacoes, setVariacoes] = useState<string[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  async function gerarVariacoes() {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch("/api/garimpo/variar-texto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: item.texto, tipo, nicho, quantidade: 5 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao gerar variações.");
      setVariacoes(json.variacoes);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setCarregando(false);
    }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(texto);
      setTimeout(() => setCopiado((atual) => (atual === texto ? null : atual)), 1500);
    } catch {
      // navegador sem permissão de clipboard — sem problema, o texto já está visível pra selecionar
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-zinc-800">{item.texto}</p>
        <button
          onClick={() => copiar(item.texto)}
          className="shrink-0 text-xs text-zinc-500 hover:text-brand"
          title="Copiar texto original"
        >
          {copiado === item.texto ? "Copiado!" : "Copiar"}
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Usado em {item.vezes} anúncio{item.vezes === 1 ? "" : "s"} ativo{item.vezes === 1 ? "" : "s"}
        {item.paginas.length > 0 && <> — {item.paginas.slice(0, 3).join(", ")}</>}
      </p>

      {!variacoes && (
        <button
          onClick={gerarVariacoes}
          disabled={carregando}
          className="mt-2 rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 disabled:opacity-40"
        >
          {carregando ? "Gerando..." : "Gerar variações com IA"}
        </button>
      )}

      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}

      {variacoes && (
        <div className="mt-3 space-y-2 border-t border-zinc-200 pt-2">
          {variacoes.map((v, i) => (
            <div key={i} className="flex items-start justify-between gap-3">
              <p className="text-sm text-zinc-700">{v}</p>
              <button
                onClick={() => copiar(v)}
                className="shrink-0 text-xs text-zinc-500 hover:text-brand"
              >
                {copiado === v ? "Copiado!" : "Copiar"}
              </button>
            </div>
          ))}
          <button
            onClick={gerarVariacoes}
            disabled={carregando}
            className="text-xs font-medium text-zinc-600 underline underline-offset-2 disabled:opacity-40"
          >
            {carregando ? "Gerando..." : "Gerar outras 5"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Uma linha do ranking de nichos (só aparece quando a busca inclui um site
 * — ver GarimpoConteudo) — mostra o resumo do nicho e, ao expandir, todas as
 * páginas desse site que rodam esse nicho (com o status individual de cada
 * uma, o mesmo critério de "muito duplicado + rodando há muitos dias" da
 * tabela principal).
 */
function LinhaDeNicho({ item }: { item: NichoResumo }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <button
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[item.melhor_status]}`}>
            {item.melhor_status}
          </span>
          <span className="text-sm font-medium text-zinc-800">{item.nicho}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span>{item.paginas} página{item.paginas === 1 ? "" : "s"}</span>
          <span>{item.total_active_ads} anúncio{item.total_active_ads === 1 ? "" : "s"} ativo{item.total_active_ads === 1 ? "" : "s"}</span>
          <span>até {item.max_days_active} dias no ar</span>
          <span className="text-zinc-400">{aberto ? "▲" : "▼"}</span>
        </div>
      </button>
      {aberto && (
        <div className="border-t border-zinc-100 px-4 py-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-zinc-400">
                <th className="pb-2 pr-3">Página</th>
                <th className="pb-2 pr-3">Anúncios ativos</th>
                <th className="pb-2 pr-3">Dias ativo (máx.)</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {item.paginas_detalhe.map((p) => (
                <tr key={p.page_id} className="border-t border-zinc-50">
                  <td className="py-2 pr-3 font-medium text-zinc-700">{p.page_name}</td>
                  <td className="py-2 pr-3 text-zinc-600">{p.total_active_ads}</td>
                  <td className="py-2 pr-3 text-zinc-600">{p.max_days_active}</td>
                  <td className="py-2">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${STATUS_STYLE[p.status]}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ListaDeTextos({
  titulo,
  itens,
  tipo,
  nicho,
}: {
  titulo: string;
  itens: MelhorTexto[];
  tipo: "texto_principal" | "titulo" | "descricao";
  nicho: string;
}) {
  if (itens.length === 0) return null;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-brand">{titulo}</h3>
      <div className="mt-3 space-y-3">
        {itens.map((item, i) => (
          <CartaoDeTexto key={i} item={item} tipo={tipo} nicho={nicho} />
        ))}
      </div>
    </div>
  );
}

function GarimpoConteudo() {
  // Pré-preenche e já busca sozinho quando vem de "Buscar esse nicho no
  // Garimpo" na tela de Variações (link com ?termo=...).
  const searchParams = useSearchParams();
  const termoInicial = searchParams.get("termo") || "";

  const [searchTerms, setSearchTerms] = useState(termoInicial);
  // Site/domínio opcional (ex: "flowquest.com") — usado sozinho, filtra o
  // resultado só pros anúncios que mostram esse domínio (ver pageIds abaixo
  // pra busca garantida) ou junto com o termo de busca acima (filtra o nicho
  // buscado só pras páginas desse site).
  const [site, setSite] = useState("");
  // ID(s) de página da Meta (colados manualmente pelo usuário a partir da Ad
  // Library — abra facebook.com/ads/library, busque o nome da marca e copie
  // o ID da URL) — é o único jeito garantido de achar TUDO que uma página
  // roda, já que a Ad Library API não tem parâmetro nenhum de busca por
  // domínio. Aceita vários, separados por vírgula.
  const [pageIds, setPageIds] = useState("");
  const [countries, setCountries] = useState("");
  const [ampliar, setAmpliar] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<GarimpoResult[] | null>(null);
  const [melhoresTextosPrincipais, setMelhoresTextosPrincipais] = useState<MelhorTexto[]>([]);
  const [melhoresTitulos, setMelhoresTitulos] = useState<MelhorTexto[]>([]);
  const [melhoresDescricoes, setMelhoresDescricoes] = useState<MelhorTexto[]>([]);
  const [termosComResultado, setTermosComResultado] = useState<string[]>([]);
  const [termosTentados, setTermosTentados] = useState<string[]>([]);
  const [nichos, setNichos] = useState<NichoResumo[]>([]);
  const [termoAdivinhadoDoSite, setTermoAdivinhadoDoSite] = useState<string | null>(null);

  async function buscar(termoParaBuscar?: string) {
    const termo = termoParaBuscar ?? searchTerms;
    if (!termo && !site && !pageIds.trim()) return;
    setLoading(true);
    setError(null);
    setResultados(null);
    setMelhoresTextosPrincipais([]);
    setMelhoresTitulos([]);
    setMelhoresDescricoes([]);
    setTermosComResultado([]);
    setTermosTentados([]);
    setNichos([]);
    setTermoAdivinhadoDoSite(null);
    try {
      const res = await fetch("/api/garimpo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchTerms: termo || undefined,
          site: site.trim() || undefined,
          pageIds: pageIds
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
          countries: countries
            .split(",")
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean),
          ampliar,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erro ao buscar.");
      setResultados(json.resultados);
      setMelhoresTextosPrincipais(json.melhoresTextosPrincipais || []);
      setMelhoresTitulos(json.melhoresTitulos || []);
      setMelhoresDescricoes(json.melhoresDescricoes || []);
      setTermosComResultado(json.termosComResultado || []);
      setTermosTentados(json.termosTentados || []);
      setNichos(json.nichos || []);
      setTermoAdivinhadoDoSite(json.termoAdivinhadoDoSite || null);
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

  const temTextos =
    melhoresTextosPrincipais.length > 0 || melhoresTitulos.length > 0 || melhoresDescricoes.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Garimpo — Ad Library</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Busca inteligência de mercado. Resultado aqui é inspiração, não garantia de que é um
        campeão de fato.
      </p>

      <div className="mt-6 flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-zinc-700">Termo de busca (opcional)</label>
          <input
            value={searchTerms}
            onChange={(e) => setSearchTerms(e.target.value)}
            placeholder="ex: forklift certification"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-zinc-700">Site (opcional, filtro)</label>
          <input
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="ex: flowquest.com"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-zinc-700">ID(s) da página (opcional, vírgula)</label>
          <input
            value={pageIds}
            onChange={(e) => setPageIds(e.target.value)}
            placeholder="ex: 123456789012345"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="sm:w-44">
          <label className="block text-sm font-medium text-zinc-700">Países (vírgula)</label>
          <input
            value={countries}
            onChange={(e) => setCountries(e.target.value)}
            placeholder="em branco = vários"
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => buscar()}
          disabled={loading || (!searchTerms && !site && !pageIds.trim())}
          className="rounded-md bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {loading ? "Buscando..." : "Buscar"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        A Ad Library da Meta não tem busca direta por domínio — sem nenhum termo nem ID de página, a gente tenta
        adivinhar um termo a partir do próprio conteúdo do site (pode não achar tudo). Pra garantir 100% do que uma
        página roda, cole o ID dela (abra{" "}
        <a
          href="https://www.facebook.com/ads/library/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand underline underline-offset-2"
        >
          facebook.com/ads/library
        </a>
        , busque o nome da marca e copie o ID da URL do anúncio/página). Deixe &quot;Países&quot; em branco pra
        buscar numa lista ampla de mercados de uma vez (a API exige pelo menos um país — não existe busca mundial).
      </p>
      {site && (
        <p className="mt-1 text-xs text-zinc-500">
          Com um site preenchido, a busca também agrupa os resultados por nicho (o site pode estar rodando mais de
          um ao mesmo tempo) — veja a seção &quot;Nichos encontrados nesse site&quot; abaixo da tabela.
        </p>
      )}
      {termoAdivinhadoDoSite && (
        <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Sem termo de busca informado — tentamos adivinhar a partir do próprio site e buscamos por{" "}
          <strong>&quot;{termoAdivinhadoDoSite}&quot;</strong>. Esse resultado pode ser parcial; pra ver
          garantidamente tudo que a página roda, cole o ID dela no campo acima.
        </div>
      )}

      <label className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
        <input
          type="checkbox"
          checked={ampliar}
          onChange={(e) => setAmpliar(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300"
        />
        Ampliar automaticamente com termos parecidos (IA) quando achar pouco, sem sair do nicho
      </label>

      {resultados && termosComResultado.length > 0 && (
        <div className="mt-4 rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          Poucos resultados pra &quot;{searchTerms}&quot; — ampliamos automaticamente a busca com termos
          parecidos (mesmo nicho) e também encontramos anúncios pra:{" "}
          <strong>{termosComResultado.join(", ")}</strong>.
        </div>
      )}
      {resultados && termosTentados.length > 0 && termosComResultado.length === 0 && (
        <div className="mt-4 rounded-md bg-zinc-50 border border-zinc-200 px-4 py-3 text-sm text-zinc-500">
          Poucos resultados pra &quot;{searchTerms}&quot; — tentamos ampliar com termos parecidos (
          {termosTentados.join(", ")}), mas nenhum trouxe anúncios a mais.
        </div>
      )}

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
                      className="text-brand underline underline-offset-2"
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

      {resultados && (site || pageIds.trim()) && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight">
            {site ? "Nichos encontrados nesse site" : "Nichos encontrados nessa(s) página(s)"}
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Todos os nichos que {site ? <strong>{site}</strong> : "essa(s) página(s)"} est{site ? "á" : "ão"} rodando
            nessa busca — o(s) marcado(s) como CANDIDATO FORTE tem alguma página muito duplicada (3+ anúncios
            simultâneos) e rodando há 30+ dias, o sinal mais forte de que já é um vencedor. Clique num nicho pra ver
            as páginas por trás dele.
          </p>
          {nichos.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">Nenhum anúncio ativo encontrado.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {nichos.map((n) => (
                <LinhaDeNicho key={n.nicho} item={n} />
              ))}
            </div>
          )}
        </div>
      )}

      {resultados && resultados.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight">Melhores textos do nicho</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Texto Principal, Título e Descrição que mais se repetem entre os anúncios ativos das páginas
            CANDIDATO/CANDIDATO FORTE acima — repetição é o mesmo sinal de &quot;já funciona&quot; usado na
            tabela, só que aplicado ao texto do anúncio. Gere variações com IA a partir de qualquer um deles.
          </p>

          {!temTextos && (
            <p className="mt-4 text-sm text-zinc-500">
              A Meta não devolveu texto estruturado pra nenhum anúncio candidato dessa busca.
            </p>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ListaDeTextos
              titulo={TIPO_TEXTO_ROTULO.texto_principal}
              itens={melhoresTextosPrincipais}
              tipo="texto_principal"
              nicho={searchTerms || site}
            />
            <ListaDeTextos
              titulo={TIPO_TEXTO_ROTULO.titulo}
              itens={melhoresTitulos}
              tipo="titulo"
              nicho={searchTerms || site}
            />
            <ListaDeTextos
              titulo={TIPO_TEXTO_ROTULO.descricao}
              itens={melhoresDescricoes}
              tipo="descricao"
              nicho={searchTerms || site}
            />
          </div>
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
