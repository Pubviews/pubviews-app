import { env } from "./env";

export interface AdLibraryAd {
  id: string;
  page_id: string;
  page_name: string;
  ad_delivery_start_time: string;
  ad_snapshot_url: string;
}

export interface GarimpoResult {
  page_id: string;
  page_name: string;
  total_active_ads: number;
  max_days_active: number;
  atende_duplicacao_3x: boolean;
  atende_30_dias: boolean;
  status: "CANDIDATO FORTE" | "CANDIDATO" | "DESCARTAR";
  link_biblioteca: string;
  ads: { id: string; days_active: number; snapshot_url: string }[];
}

const GRAPH_VERSION = "v21.0";

function daysBetween(iso: string): number {
  const start = new Date(iso).getTime();
  const now = Date.now();
  return Math.floor((now - start) / (1000 * 60 * 60 * 24));
}

/**
 * Busca anúncios na Meta Ad Library por palavra-chave, em uma ou mais
 * combinações de países, e agrupa por página para aplicar os critérios:
 * ativo há 30+ dias e 3+ anúncios simultâneos da mesma página.
 */
export async function searchAdLibrary(params: {
  searchTerms: string;
  countries: string[];
  limit?: number;
}): Promise<GarimpoResult[]> {
  const token = env.metaAccessToken();
  const limit = params.limit ?? 200;

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/ads_archive`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("search_terms", params.searchTerms);
  url.searchParams.set("ad_type", "ALL");
  url.searchParams.set("ad_active_status", "ACTIVE");
  url.searchParams.set("ad_reached_countries", JSON.stringify(params.countries));
  url.searchParams.set(
    "fields",
    "id,page_id,page_name,ad_delivery_start_time,ad_snapshot_url"
  );
  url.searchParams.set("limit", String(Math.min(limit, 200)));

  const allAds: AdLibraryAd[] = [];
  let nextUrl: string | null = url.toString();
  let pages = 0;

  while (nextUrl && pages < 5 && allAds.length < limit) {
    const res: Response = await fetch(nextUrl);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta Ad Library API erro ${res.status}: ${body}`);
    }
    const json: { data?: AdLibraryAd[]; paging?: { next?: string } } = await res.json();
    const data: AdLibraryAd[] = json.data ?? [];
    allAds.push(...data);
    nextUrl = json.paging?.next ?? null;
    pages += 1;
  }

  const byPage = new Map<string, AdLibraryAd[]>();
  for (const ad of allAds) {
    const list = byPage.get(ad.page_id) ?? [];
    list.push(ad);
    byPage.set(ad.page_id, list);
  }

  const results: GarimpoResult[] = [];
  for (const [pageId, ads] of byPage.entries()) {
    const withDays = ads.map((a) => ({
      id: a.id,
      days_active: daysBetween(a.ad_delivery_start_time),
      snapshot_url: a.ad_snapshot_url,
    }));
    const maxDays = Math.max(...withDays.map((a) => a.days_active), 0);
    const atende30 = maxDays >= 30;
    const atendeDup3x = ads.length >= 3;

    let status: GarimpoResult["status"] = "DESCARTAR";
    if (atende30 && atendeDup3x) status = "CANDIDATO FORTE";
    else if (atende30 || atendeDup3x) status = "CANDIDATO";

    results.push({
      page_id: pageId,
      page_name: ads[0].page_name,
      total_active_ads: ads.length,
      max_days_active: maxDays,
      atende_duplicacao_3x: atendeDup3x,
      atende_30_dias: atende30,
      status,
      link_biblioteca: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&search_type=page&view_all_page_id=${pageId}`,
      ads: withDays,
    });
  }

  results.sort((a, b) => {
    const order = { "CANDIDATO FORTE": 0, CANDIDATO: 1, DESCARTAR: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return b.total_active_ads - a.total_active_ads;
  });

  return results;
}

export interface AnuncioDaBiblioteca {
  id: string;
  pageName: string;
  textoPrincipal: string;
  titulo: string;
  descricao: string;
  snapshotUrl: string;
}

/**
 * Extrai o ID do anúncio (ad_archive_id) e, se presente, o ID da página
 * (view_all_page_id/page_id) de um link da Ad Library colado pelo usuário.
 *
 * A maioria dos links que o usuário cola (ex: .../ads/library/?id=123...)
 * só tem o ID do anúncio — o ID da página só aparece se ele copiar o link
 * DEPOIS de abrir os detalhes do anúncio (a Meta reescreve a URL nessa
 * hora). Por isso o fluxo principal (buscarAnuncioRenderizado, abaixo) não
 * depende do page_id — ele só é usado como reforço opcional quando já vem
 * no link.
 */
export function extrairIdsDoLink(url: string): { adId: string | null; pageId: string | null } {
  let adId: string | null = null;
  let pageId: string | null = null;
  try {
    const u = new URL(url);
    const id = u.searchParams.get("id");
    if (id && /^\d+$/.test(id)) adId = id;
    const viewAllPageId = u.searchParams.get("view_all_page_id") || u.searchParams.get("page_id");
    if (viewAllPageId && /^\d+$/.test(viewAllPageId)) pageId = viewAllPageId;
  } catch {
    // não é uma URL válida — tenta achar pelo menos o ID do anúncio no texto mesmo assim
  }
  if (!adId) {
    const match = url.match(/(\d{10,})/);
    if (match) adId = match[1];
  }
  return { adId, pageId };
}

function limparTextoRaspado(s: string): string {
  return s
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function conteudoDaMetaTag(html: string, propriedade: string): string | null {
  const padrao1 = new RegExp(`<meta[^>]+(?:property|name)=["']${propriedade}["'][^>]*content=["']([^"']*)["']`, "i");
  const m1 = html.match(padrao1);
  if (m1) return limparTextoRaspado(m1[1]);
  const padrao2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${propriedade}["']`, "i");
  const m2 = html.match(padrao2);
  return m2 ? limparTextoRaspado(m2[1]) : null;
}

export interface RaspagemDoAnuncio {
  titulo?: string;
  descricao?: string;
  nomeDaPagina?: string;
  midia?: { tipo: "video" | "imagem"; url: string };
}

function rasparHtmlDoAnuncio(html: string): RaspagemDoAnuncio {
  const titulo = conteudoDaMetaTag(html, "og:title") || undefined;
  const descricao = conteudoDaMetaTag(html, "og:description") || undefined;
  const nomeDaPagina = conteudoDaMetaTag(html, "og:site_name") || undefined;

  let midia: RaspagemDoAnuncio["midia"];
  const video = html.match(/https:[^"'\s\\]+?\.mp4[^"'\s\\]*/i);
  if (video) {
    midia = { tipo: "video", url: limparTextoRaspado(video[0]) };
  } else {
    const imagem = html.match(/https:\/\/scontent[^"'\s\\]+?\.(?:jpg|jpeg|png)[^"'\s\\]*/i);
    if (imagem) midia = { tipo: "imagem", url: limparTextoRaspado(imagem[0]) };
  }

  return { titulo, descricao, nomeDaPagina, midia };
}

/**
 * Busca (best-effort) os dados de UM anúncio específico direto pelo ID —
 * sem precisar saber a página dele — usando o endpoint público de
 * renderização de anúncio da própria Meta (o mesmo formato do campo
 * ad_snapshot_url que a Ad Library API devolve:
 * "https://www.facebook.com/ads/archive/render_ad/?id=...&access_token=...").
 * Diferente da busca por palavra-chave/página (ads_archive), esse endpoint
 * aceita o ID isolado — mas não é um campo estruturado da API, então a
 * gente lê o HTML dele (tags Open Graph pro texto, regex pra mídia) em vez
 * de JSON. Por ser fora do contrato oficial da API, é sempre best-effort:
 * pode não trazer nada, ou parar de funcionar se a Meta mudar essa página.
 */
export async function buscarAnuncioRenderizado(adId: string): Promise<RaspagemDoAnuncio | null> {
  const token = env.metaAccessToken();
  const url = `https://www.facebook.com/ads/archive/render_ad/?id=${encodeURIComponent(adId)}&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PubViewsTool/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return rasparHtmlDoAnuncio(html);
  } catch {
    return null;
  }
}

// Países usados pra tentar achar o anúncio específico dentro da página (a
// Ad Library exige um filtro de país na busca) — uma lista de mercados
// comuns, já que a gente não sabe de antemão em quais países esse anúncio
// específico foi veiculado.
const PAISES_BUSCA_PADRAO = ["US", "CA", "GB", "AU", "BR", "PT"];

/**
 * Reforço opcional: procura o anúncio dentro dos anúncios (ativos ou não) de
 * uma página, usando search_page_ids — só funciona quando o link colado já
 * veio com o ID da página (o que só acontece se o usuário copiou o link
 * depois de abrir os detalhes do anúncio). Quando funciona, é melhor que a
 * raspagem por render_ad porque usa os campos estruturados oficiais da API
 * (ad_creative_bodies/titles/descriptions) em vez de tags Open Graph.
 * Devolve null se não achar (pode estar fora dos países tentados, ou a
 * página não bateu).
 */
export async function buscarAnuncioNaPagina(adId: string, pageId: string): Promise<AnuncioDaBiblioteca | null> {
  const token = env.metaAccessToken();
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/ads_archive`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("search_page_ids", JSON.stringify([pageId]));
  url.searchParams.set("ad_type", "ALL");
  url.searchParams.set("ad_active_status", "ALL");
  url.searchParams.set("ad_reached_countries", JSON.stringify(PAISES_BUSCA_PADRAO));
  url.searchParams.set(
    "fields",
    "id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,ad_snapshot_url"
  );
  url.searchParams.set("limit", "250");

  interface AdArchiveDetalhado {
    id: string;
    page_name?: string;
    ad_creative_bodies?: string[];
    ad_creative_link_titles?: string[];
    ad_creative_link_descriptions?: string[];
    ad_snapshot_url?: string;
  }

  let nextUrl: string | null = url.toString();
  let pages = 0;
  while (nextUrl && pages < 6) {
    const res: Response = await fetch(nextUrl);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta Ad Library API erro ${res.status}: ${body.slice(0, 300)}`);
    }
    const json: { data?: AdArchiveDetalhado[]; paging?: { next?: string } } = await res.json();
    const achado = (json.data ?? []).find((a) => a.id === adId);
    if (achado) {
      return {
        id: achado.id,
        pageName: achado.page_name || "",
        textoPrincipal: (achado.ad_creative_bodies || [])[0] || "",
        titulo: (achado.ad_creative_link_titles || [])[0] || "",
        descricao: (achado.ad_creative_link_descriptions || [])[0] || "",
        snapshotUrl: achado.ad_snapshot_url || `https://www.facebook.com/ads/library/?id=${adId}`,
      };
    }
    nextUrl = json.paging?.next ?? null;
    pages += 1;
  }
  return null;
}

/**
 * Tenta extrair a URL do vídeo (ou, na falta dele, de uma imagem) do
 * anúncio a partir da página pública de snapshot da Ad Library
 * (ad_snapshot_url — a própria Meta descreve esse campo como "exibe imagens
 * e vídeos não comprimidos do anúncio"). Isso é uma tentativa por fora da
 * API oficial de dados estruturados: a Meta não expõe o arquivo de mídia
 * como campo — então é best-effort, pode falhar ou parar de funcionar se a
 * Meta mudar o HTML dessa página, e por isso nunca deve derrubar o fluxo
 * principal (quem chama trata null/erro como "só achei o texto mesmo").
 */
export async function extrairMidiaDoSnapshot(
  snapshotUrl: string
): Promise<{ tipo: "video" | "imagem"; url: string } | null> {
  try {
    const res = await fetch(snapshotUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PubViewsTool/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return rasparHtmlDoAnuncio(html).midia ?? null;
  } catch {
    return null;
  }
}
