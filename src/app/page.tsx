import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">PubViews Tool</h1>
      <p className="mt-3 max-w-2xl text-zinc-600">
        Ferramenta interna para garimpar inteligência de mercado na Ad Library da Meta e gerar
        variações reais de vídeo dos nossos criativos vencedores.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <Link
          href="/garimpo"
          className="block rounded-xl border border-zinc-200 bg-white p-6 hover:border-zinc-400 transition-colors"
        >
          <h2 className="text-xl font-medium">Garimpo</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Busca anúncios ativos na Ad Library por nicho/palavra-chave, agrupa por página e
            aponta os que estão ativos há 30+ dias e com 3+ duplicações simultâneas.
          </p>
        </Link>

        <Link
          href="/variacoes"
          className="block rounded-xl border border-zinc-200 bg-white p-6 hover:border-zinc-400 transition-colors"
        >
          <h2 className="text-xl font-medium">Variações</h2>
          <p className="mt-2 text-sm text-zinc-600">
            A partir de um criativo vencedor nosso, gera novos roteiros, narração (ElevenLabs) e
            monta o vídeo final (imagem + narração ou vídeo stock + narração).
          </p>
        </Link>
      </div>
    </div>
  );
}
