import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import {
  extrairIdsDoLink,
  buscarAnuncioRenderizado,
  buscarAnuncioNaPagina,
  extrairMidiaDoSnapshot,
} from "@/lib/meta";
import { analisarVideoDeReferencia, sugerirNichoDoTexto } from "@/lib/gemini";

export const runtime = "nodejs";
// Busca o anúncio + baixa o vídeo (se achar) + a IA assiste o vídeo — dá
// folga parecida com a análise de vídeo próprio (que já usa até 100s só na
// chamada da Gemini).
export const maxDuration = 150;

const ANUNCIO_NAO_ENCONTRADO =
  "Não consegui achar os dados desse anúncio — nem pela raspagem direta do ID, nem (quando o link tinha o ID da página) pela busca oficial da Ad Library. Pode ser um anúncio muito antigo/removido, ou a Meta pode ter mudado alguma coisa. Tente outro anúncio, ou use o Garimpo pra achar essa página por palavra-chave.";

/**
 * Recebe o link de um anúncio específico da Ad Library (colado pelo usuário
 * — um concorrente ou inspiração que ele encontrou) e devolve referência,
 * nicho e, quando consegue, o próprio vídeo do anúncio pronto pra reaproveitar
 * (mesmo fluxo do "vídeo original" enviado pelo usuário).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url: string = body.url;
    if (!url) {
      return NextResponse.json({ error: "Cole o link do anúncio na Ad Library." }, { status: 400 });
    }

    const { adId, pageId } = extrairIdsDoLink(url);
    if (!adId) {
      return NextResponse.json(
        {
          error:
            'Não consegui identificar o ID do anúncio nesse link. Copie o link direto da página do anúncio na Ad Library (com "id=" na URL).',
        },
        { status: 400 }
      );
    }

    // Caminho principal: raspa o anúncio direto pelo ID (funciona com
    // qualquer link, mesmo o mais simples tipo ".../library/?id=123...").
    const raspagem = await buscarAnuncioRenderizado(adId);

    let pageName = raspagem?.nomeDaPagina || "";
    let textoAnuncio = [raspagem?.descricao, raspagem?.titulo].filter(Boolean).join(" — ");
    let snapshotUrlParaMidia: string | null = null;

    // Reforço opcional (dados estruturados oficiais, mais confiáveis) — só
    // dá pra tentar quando o link já veio com o ID da página.
    if (pageId) {
      try {
        const oficial = await buscarAnuncioNaPagina(adId, pageId);
        if (oficial) {
          const textoOficial = [oficial.textoPrincipal, oficial.titulo, oficial.descricao].filter(Boolean).join(" — ");
          if (textoOficial) textoAnuncio = textoOficial;
          if (oficial.pageName) pageName = oficial.pageName;
          snapshotUrlParaMidia = oficial.snapshotUrl;
        }
      } catch {
        // segue só com o que a raspagem direta trouxe
      }
    }

    if (!textoAnuncio) {
      return NextResponse.json({ error: ANUNCIO_NAO_ENCONTRADO }, { status: 404 });
    }

    let nicho = "";
    try {
      nicho = await sugerirNichoDoTexto(textoAnuncio);
    } catch {
      // segue sem nicho sugerido — o usuário preenche na mão
    }

    let videoOriginalUrl: string | undefined;
    let descricaoVisualOriginal: string | undefined;
    let imagemPreviewUrl: string | undefined;
    let aviso: string | undefined;

    // Mídia: usa a que já veio da raspagem direta; se não achou nada e tem
    // uma URL de snapshot oficial (do reforço acima), tenta de novo nela.
    let midia = raspagem?.midia ?? null;
    if (!midia && snapshotUrlParaMidia) {
      midia = await extrairMidiaDoSnapshot(snapshotUrlParaMidia);
    }

    if (midia?.tipo === "video") {
      try {
        const respMidia = await fetch(midia.url, { signal: AbortSignal.timeout(30000) });
        if (!respMidia.ok) throw new Error(`status ${respMidia.status}`);
        const bytes = Buffer.from(await respMidia.arrayBuffer());

        // Rehospeda no nosso Blob (não confia na URL do fbcdn, que costuma
        // ser assinada/temporária) — o mesmo padrão de URL que o resto do
        // app já espera pra reaproveitar um vídeo original.
        const blob = await put(`biblioteca-${adId}-${Date.now()}.mp4`, bytes, {
          access: "public",
          contentType: "video/mp4",
        });
        videoOriginalUrl = blob.url;

        const analise = await analisarVideoDeReferencia(bytes.toString("base64"), "video/mp4");
        descricaoVisualOriginal = analise.descricaoVisual || undefined;
      } catch {
        aviso =
          "Encontrei o anúncio e o texto dele, mas não consegui baixar o vídeo automaticamente — só o texto foi usado como referência.";
      }
    } else if (midia?.tipo === "imagem") {
      // Só como preview/confirmação visual pro usuário — cada variação
      // ainda gera uma imagem nova (IA) a partir da descrição/nicho, igual
      // ao fluxo normal de "imagem estática".
      imagemPreviewUrl = midia.url;
    } else {
      aviso =
        "Encontrei o anúncio e o texto dele, mas não consegui identificar a imagem/vídeo automaticamente (a Meta não libera isso pela API oficial) — só o texto foi usado como referência.";
    }

    return NextResponse.json({
      referencia: textoAnuncio,
      nicho,
      pageName,
      videoOriginalUrl,
      descricaoVisualOriginal,
      imagemPreviewUrl,
      aviso,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
