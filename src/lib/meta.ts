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
