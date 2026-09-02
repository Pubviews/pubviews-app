import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PubViews Tool",
  description: "Garimpo de Ad Library + geração de variações de criativos",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
            <Link href="/" className="font-semibold text-lg tracking-tight">
              PubViews Tool
            </Link>
            <nav className="flex gap-6 text-sm font-medium text-zinc-600">
              <Link href="/garimpo" className="hover:text-zinc-950">
                Garimpo
              </Link>
              <Link href="/variacoes" className="hover:text-zinc-950">
                Variações
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
