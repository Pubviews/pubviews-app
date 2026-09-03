import { env } from "./env";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

export interface AdLibraryAd {
  id: string;
  page_id: string;
  page_name: string;
  ad_delivery_start_time: string;
  ad_snapshot_url: string;
  // Domínio/site mostrado no rodapé do anúncio (ex: "minhaescola.com.br") —
  // vem como array porque anúncios diferentes da mesma página podem apontar
  // pra domínios diferentes; a Meta às vezes não devolve nada aqui.
  ad_creative_link_captions?: string[];
}

export interface GarimpoResult {
  page_id: string;
  page_name: string;
  // Domínio mais usado entre os anúncios ativos dessa página — null quando
  // a Meta não devolveu esse dado pra nenhum anúncio da página.
  site_name: string | null;
  total_active_ads: number;
  max_days_active: number;
  atende_duplicacao_3x: boolean;
  atende_30_dias: boolean;
  status: "CANDIDATO FORTE" | "CANDIDATO" | "DESCARTAR";
  link_biblioteca: string;
  ads: { id: string; days_active: number; snapshot_url: string }[];
}

/**
 * Entre os domínios vistos nos anúncios de uma página (pode variar de
 * anúncio pra anúncio), escolhe o mais frequente — o que representa melhor
 * "o site dessa página" pro usuário decidir se conhece ou não.
 */
function siteMaisFrequente(captions: string[]): string | null {
  if (captions.length === 0) return null;
  const contagem = new Map<string, number>();
  for (const c of captions) contagem.set(c, (contagem.get(c) ?? 0) + 1);
  let melhor: string | null = null;
  let melhorContagem = 0;
  for (const [site, n] of contagem.entries()) {
    if (n > melhorContagem) {
      melhor = site;
      melhorContagem = n;
    }
  }
  return melhor;
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
    "id,page_id,page_name,ad_delivery_start_time,ad_snapshot_url,ad_creative_link_captions"
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

    const captions = ads.flatMap((a) => a.ad_creative_link_captions ?? []).filter(Boolean);

    // "Criativo campeão": entre os anúncios ativos dessa página, o mais
    // antigo (maior tempo no ar) — se a página tem várias cópias do mesmo
    // anúncio rodando, a mais antiga é a que já provou que funciona, então
    // é essa que vira o link de referência (em vez de mandar pra lista geral
    // de anúncios da página, que cai no filtro de país errado e não mostra
    // qual anúncio específico bateu os critérios).
    const campeao = withDays.reduce(
      (melhor, atual) => (atual.days_active > melhor.days_active ? atual : melhor),
      withDays[0]
    );

    results.push({
      page_id: pageId,
      page_name: ads[0].page_name,
      site_name: siteMaisFrequente(captions),
      total_active_ads: ads.length,
      max_days_active: maxDays,
      atende_duplicacao_3x: atendeDup3x,
      atende_30_dias: atende30,
      status,
      link_biblioteca:
        campeao?.snapshot_url ||
        `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&search_type=page&view_all_page_id=${pageId}`,
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

export interface RaspagemDoAnuncio {
  titulo?: string;
  descricao?: string;
  nomeDaPagina?: string;
  midia?: { tipo: "video" | "imagem"; url: string };
}

/**
 * Abre uma URL de renderização de anúncio da Meta (render_ad / o formato do
 * campo ad_snapshot_url) num Chromium headless e lê o conteúdo já montado.
 *
 * IMPORTANTE: essa página não é HTML estático — o conteúdo (texto, imagem,
 * vídeo) só existe depois que o JavaScript da própria Meta roda no
 * navegador (confirmado testando: um fetch() simples devolve só uma casca
 * vazia, sem nenhuma tag Open Graph e sem o vídeo — foi por isso que a
 * primeira versão dessa função, baseada só em fetch + regex, nunca
 * funcionava, pra nenhum anúncio). Por isso a gente abre a URL num Chromium
 * headless (via puppeteer-core + @sparticuz/chromium, rodando dentro da
 * própria função serverless), espera a página montar o conteúdo e lê o
 * resultado do DOM já pronto. Confirmado funcionando sem precisar de login.
 *
 * Por ser fora do contrato oficial da API (é raspagem de uma página pensada
 * pra humano, não um endpoint de dados), é sempre best-effort: pode não
 * trazer nada, ou parar de funcionar se a Meta mudar o layout.
 */
async function abrirERasparAnuncio(url: string): Promise<RaspagemDoAnuncio | null> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 1400 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 25000 });
    // Dá uma folga extra pro vídeo/imagem terminar de montar no DOM (às
    // vezes finaliza um instante depois do "networkidle2").
    await page
      .waitForSelector('video, img[src*="scontent"]', { timeout: 6000 })
      .catch(() => {});

    const dados = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      const linhas = bodyText
        .split("\n")
        .map((l) => l.replace(/​/g, "").trim())
        .filter(Boolean);

      const nomeDaPagina = linhas[0] || "";
      // A "Identificação da biblioteca: 123..." (ou equivalente em outro
      // idioma) sempre termina com um número longo — usa isso como marco
      // pra saber onde o texto do anúncio começa, sem depender do idioma.
      const idxId = linhas.findIndex((l) => /\d{8,}\s*$/.test(l) && l.length < 80);
      // A duração do vídeo ("0:00 / 0:15") é um marco confiável de onde o
      // texto principal termina, também independente de idioma.
      const idxDuracao = linhas.findIndex((l) => /^\d+:\d{2}\s*\/\s*\d+:\d{2}$/.test(l));

      // Alguns elementos de interface (botão de menu "...", etc.) têm texto
      // acessível que entra no innerText mesmo sem aparecer visualmente — às
      // vezes até colado na mesma linha do texto do anúncio, sem quebra de
      // linha. Filtra as linhas 100% ruído e remove o resto como prefixo.
      const RUIDO_DE_INTERFACE = ["menu", "open dropdown", "abrir menu", "more options"];
      const inicio = idxId >= 0 ? idxId + 1 : 2;
      const fim = idxDuracao >= 0 ? idxDuracao : Math.min(inicio + 4, linhas.length);
      let textoPrincipal = linhas
        .slice(inicio, fim)
        .filter((l) => !RUIDO_DE_INTERFACE.includes(l.toLowerCase()))
        .join(" ")
        .trim();
      for (const ruido of RUIDO_DE_INTERFACE) {
        const padrao = new RegExp(`^${ruido}\\s*`, "i");
        textoPrincipal = textoPrincipal.replace(padrao, "").trim();
      }

      const video = document.querySelector("video") as HTMLVideoElement | null;
      const videoSrc = video?.currentSrc || video?.src || null;

      const imagens = Array.from(document.querySelectorAll("img"))
        .filter((img) => /scontent/i.test((img as HTMLImageElement).src))
        .sort((a, b) => {
          const ai = a as HTMLImageElement;
          const bi = b as HTMLImageElement;
          return bi.naturalWidth * bi.naturalHeight - ai.naturalWidth * ai.naturalHeight;
        });
      const imgSrc = (imagens[0] as HTMLImageElement | undefined)?.src || null;

      return { nomeDaPagina, textoPrincipal, videoSrc, imgSrc };
    });

    await browser.close();
    browser = null;

    if (!dados.textoPrincipal && !dados.videoSrc && !dados.imgSrc) return null;

    const midia: RaspagemDoAnuncio["midia"] = dados.videoSrc
      ? { tipo: "video", url: dados.videoSrc }
      : dados.imgSrc
        ? { tipo: "imagem", url: dados.imgSrc }
        : undefined;

    return {
      titulo: undefined,
      descricao: dados.textoPrincipal || undefined,
      nomeDaPagina: dados.nomeDaPagina || undefined,
      midia,
    };
  } catch {
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Busca (best-effort) os dados de UM anúncio específico direto pelo ID —
 * sem precisar saber a página dele — montando a URL de renderização
 * (mesmo formato do campo ad_snapshot_url que a Ad Library API devolve:
 * "https://www.facebook.com/ads/archive/render_ad/?id=...&access_token=...")
 * e raspando o resultado (ver abrirERasparAnuncio).
 */
export async function buscarAnuncioRenderizado(adId: string): Promise<RaspagemDoAnuncio | null> {
  const token = env.metaAccessToken();
  const url = `https://www.facebook.com/ads/archive/render_ad/?id=${encodeURIComponent(adId)}&access_token=${encodeURIComponent(token)}`;
  return abrirERasparAnuncio(url);
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
  const raspagem = await abrirERasparAnuncio(snapshotUrl);
  return raspagem?.midia ?? null;
}
