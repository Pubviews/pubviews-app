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
 * Extrai o ID do anúncio (ad_archive_id) de um link da Ad Library colado
 * pelo usuário — normalmente algo como
 * "https://www.facebook.com/ads/library/?id=1234567890123456", mas aceita
 * qualquer URL com "id=" na query, ou até só o número copiado direto.
 */
export function extrairIdDoAnuncio(url: string): string | null {
  try {
    const u = new URL(url);
    const id = u.searchParams.get("id");
    if (id && /^\d+$/.test(id)) return id;
  } catch {
    // não é uma URL válida — tenta achar um número grande no texto mesmo assim
  }
  const match = url.match(/(\d{10,})/);
  return match ? match[1] : null;
}

/**
 * Busca os dados públicos de UM anúncio específico da Ad Library pelo ID
 * (o node "ArchivedAd" do Graph API aceita GET direto por ID, além da busca
 * por palavra-chave usada em searchAdLibrary).
 */
export async function buscarAnuncioPorId(adId: string): Promise<AnuncioDaBiblioteca> {
  const token = env.metaAccessToken();
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${adId}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set(
    "fields",
    "id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,ad_snapshot_url"
  );

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Não consegui buscar esse anúncio na Ad Library (erro ${res.status}). Confira se o link é de um anúncio ativo/público. Detalhe: ${body.slice(0, 300)}`
    );
  }
  const json = await res.json();

  return {
    id: json.id || adId,
    pageName: json.page_name || "",
    textoPrincipal: (json.ad_creative_bodies || [])[0] || "",
    titulo: (json.ad_creative_link_titles || [])[0] || "",
    descricao: (json.ad_creative_link_descriptions || [])[0] || "",
    snapshotUrl: json.ad_snapshot_url || `https://www.facebook.com/ads/library/?id=${adId}`,
  };
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
    const limpar = (s: string) => s.replace(/\\u0026/g, "&").replace(/\\\//g, "/");

    const video = html.match(/https:[^"'\s\\]+?\.mp4[^"'\s\\]*/i);
    if (video) return { tipo: "video", url: limpar(video[0]) };

    const imagem = html.match(/https:\/\/scontent[^"'\s\\]+?\.(?:jpg|jpeg|png)[^"'\s\\]*/i);
    if (imagem) return { tipo: "imagem", url: limpar(imagem[0]) };

    return null;
  } catch {
    return null;
  }
}
