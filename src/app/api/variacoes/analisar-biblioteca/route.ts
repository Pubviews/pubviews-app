import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { extrairIdDoAnuncio, buscarAnuncioPorId, extrairMidiaDoSnapshot } from "@/lib/meta";
import { analisarVideoDeReferencia, sugerirNichoDoTexto } from "@/lib/gemini";

export const runtime = "nodejs";
// Busca o anúncio na API + baixa o vídeo (se achar) + a IA assiste o vídeo —
// dá folga parecida com a análise de vídeo próprio (que já usa até 100s só
// na chamada da Gemini).
export const maxDuration = 150;

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

    const adId = extrairIdDoAnuncio(url);
    if (!adId) {
      return NextResponse.json(
        {
          error:
            "Não consegui identificar o ID do anúncio nesse link. Copie o link direto da página do anúncio na Ad Library (com \"id=\" na URL).",
        },
        { status: 400 }
      );
    }

    const anuncio = await buscarAnuncioPorId(adId);
    const textoAnuncio = [anuncio.textoPrincipal, anuncio.titulo, anuncio.descricao].filter(Boolean).join(" — ");
    if (!textoAnuncio) {
      return NextResponse.json(
        {
          error:
            "Encontrei o anúncio, mas a API da Meta não devolveu nenhum texto dele (Texto Principal/Título/Descrição) pra usar de referência.",
        },
        { status: 422 }
      );
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

    // Tentativa por fora da API oficial de achar a imagem/vídeo do anúncio —
    // best-effort, ver comentário em extrairMidiaDoSnapshot. Nunca deixa o
    // texto (já garantido acima) de ser aproveitado se isso falhar.
    const midia = await extrairMidiaDoSnapshot(anuncio.snapshotUrl);

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
      pageName: anuncio.pageName,
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
