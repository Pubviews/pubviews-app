import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PubViews Tool",
  description: "Garimpo de Ad Library + geração de variações de criativos",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-200 bg-white">
          <div className="h-1 w-full bg-gradient-to-r from-brand-teal to-brand-green" />
          <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center">
              <Image
                src="/logo/pubviews-logo-full.png"
                alt="PubViews"
                width={715}
                height={164}
                priority
                className="h-8 w-auto"
              />
            </Link>
            <nav className="flex gap-6 text-sm font-medium text-zinc-600">
              <Link href="/garimpo" className="hover:text-brand">
                Garimpo
              </Link>
              <Link href="/variacoes" className="hover:text-brand">
                Variações
              </Link>
              <Link href="/variacoes/historico" className="hover:text-brand">
                Histórico
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
