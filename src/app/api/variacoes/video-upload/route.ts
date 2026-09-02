import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Autoriza o upload do vídeo de referência direto do navegador pro Vercel
 * Blob — o arquivo NUNCA passa pelo corpo desta função (que teria o limite
 * de ~4.5MB de requisição das Vercel Functions). O navegador sobe o arquivo
 * direto pro armazenamento, usando um token de curta duração gerado aqui.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/*"],
          maximumSizeInBytes: 80 * 1024 * 1024, // 80MB — bem folgado pra um criativo de anúncio curto
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // nada a fazer aqui — a análise acontece quando o front chama /api/variacoes/analisar-video
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
