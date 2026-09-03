import { NextRequest, NextResponse } from "next/server";
import { searchAdLibrary } from "@/lib/meta";

export const runtime = "nodejs";
// Pode rodar até 3 buscas extras (termos parecidos) + 1 chamada à IA além da
// busca original — a busca em si costuma ser rápida, mas com ampliação some
// mais margem que os 30s de antes (sem ampliação).
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const searchTerms: string = body.searchTerms;
    const countries: string[] = body.countries?.length ? body.countries : ["US"];
    // Ampliação automática com termos parecidos (IA) ligada por padrão — só
    // desliga se o front mandar ampliar: false explicitamente.
    const ampliar: boolean = body.ampliar !== false;

    if (!searchTerms || typeof searchTerms !== "string") {
      return NextResponse.json({ error: "Informe o termo de busca (searchTerms)." }, { status: 400 });
    }

    const busca = await searchAdLibrary({ searchTerms, countries, ampliar });
    return NextResponse.json({
      resultados: busca.resultados,
      melhoresTextosPrincipais: busca.melhoresTextosPrincipais,
      melhoresTitulos: busca.melhoresTitulos,
      melhoresDescricoes: busca.melhoresDescricoes,
      termoOriginal: busca.termoOriginal,
      termosTentados: busca.termosTentados,
      termosComResultado: busca.termosComResultado,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
