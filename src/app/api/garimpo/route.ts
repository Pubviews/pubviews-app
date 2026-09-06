import { NextRequest, NextResponse } from "next/server";
import { searchAdLibrary, PAISES_BUSCA_PADRAO } from "@/lib/meta";

export const runtime = "nodejs";
// Pode rodar até 3 buscas extras (termos parecidos) + 1 chamada à IA além da
// busca original — a busca em si costuma ser rápida, mas com ampliação some
// mais margem que os 30s de antes (sem ampliação).
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const searchTerms: string | undefined = typeof body.searchTerms === "string" ? body.searchTerms : undefined;
    // Domínio opcional (ex: "flowquest.com") pra restringir a busca a um site
    // específico — pode vir sozinho (busca tudo que o site roda) ou junto
    // com searchTerms (filtra o nicho buscado só pras páginas desse site).
    const site: string | undefined = typeof body.site === "string" ? body.site : undefined;
    // ID(s) de página da Meta, colados manualmente pelo usuário (a partir da
    // Ad Library) — aceita array ou string separada por vírgula/quebra de
    // linha. É o único jeito garantido de buscar 100% do que uma página
    // roda, já que a API não tem parâmetro nenhum de busca por domínio.
    const pageIds: string[] = Array.isArray(body.pageIds)
      ? body.pageIds.map(String)
      : typeof body.pageIds === "string"
        ? body.pageIds.split(/[,\n]/)
        : [];
    // Sem país informado, usa uma lista ampla de mercados comuns — a Ad
    // Library exige pelo menos um país em toda busca (não existe "todos os
    // países"/mundial na API).
    const countries: string[] = body.countries?.length ? body.countries : PAISES_BUSCA_PADRAO;
    // Ampliação automática com termos parecidos (IA) ligada por padrão — só
    // desliga se o front mandar ampliar: false explicitamente.
    const ampliar: boolean = body.ampliar !== false;

    if (!searchTerms?.trim() && !site?.trim() && pageIds.filter((p) => p.trim()).length === 0) {
      return NextResponse.json(
        { error: "Informe o termo de busca (searchTerms), um site ou um ID de página." },
        { status: 400 }
      );
    }

    const busca = await searchAdLibrary({ searchTerms, site, pageIds, countries, ampliar });
    return NextResponse.json({
      resultados: busca.resultados,
      melhoresTextosPrincipais: busca.melhoresTextosPrincipais,
      melhoresTitulos: busca.melhoresTitulos,
      melhoresDescricoes: busca.melhoresDescricoes,
      termoOriginal: busca.termoOriginal,
      termosTentados: busca.termosTentados,
      termosComResultado: busca.termosComResultado,
      nichos: busca.nichos,
      termoAdivinhadoDoSite: busca.termoAdivinhadoDoSite,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
