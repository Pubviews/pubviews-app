import { NextRequest, NextResponse } from "next/server";

// Proteção simples com senha única compartilhada (HTTP Basic Auth).
// Só é ativada se a variável de ambiente APP_PASSWORD estiver configurada na Vercel.
// Sem essa variável, o app fica aberto (sem gate nenhum).
export function proxy(req: NextRequest) {
  const senha = process.env.APP_PASSWORD;
  if (!senha) return NextResponse.next();

  const auth = req.headers.get("authorization");
  const esperado = "Basic " + Buffer.from(`pubviews:${senha}`).toString("base64");

  if (auth === esperado) return NextResponse.next();

  return new NextResponse("Autenticação necessária.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="PubViews Tool"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
