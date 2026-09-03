import { NextRequest, NextResponse } from "next/server";
import { searchAdLibrary } from "@/lib/meta";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const searchTerms: string = body.searchTerms;
    const countries: string[] = body.countries?.length ? body.countries : ["US"];

    if (!searchTerms || typeof searchTerms !== "string") {
      return NextResponse.json({ error: "Informe o termo de busca (searchTerms)." }, { status: 400 });
    }

    const busca = await searchAdLibrary({ searchTerms, countries });
    return NextResponse.json({
      resultados: busca.resultados,
      melhoresTextosPrincipais: busca.melhoresTextosPrincipais,
      melhoresTitulos: busca.melhoresTitulos,
      melhoresDescricoes: busca.melhoresDescricoes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
