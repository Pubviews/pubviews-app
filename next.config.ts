import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // fluent-ffmpeg e os binários instalados via @ffmpeg-installer/@ffprobe-installer
  // usam require() dinâmico e não podem ser processados pelo bundler do Next —
  // precisam ser carregados diretamente em runtime (Node.js) nas rotas de API.
  serverExternalPackages: [
    "fluent-ffmpeg",
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
    "@napi-rs/canvas",
    "puppeteer-core",
    "@sparticuz/chromium",
    "pg",
  ],
  // Os arquivos .br do Chromium (@sparticuz/chromium) são lidos em runtime
  // via caminho de arquivo (não via require/import), então o rastreador de
  // arquivos do Next não os inclui sozinho — sem isso a função na Vercel
  // sobe sem o binário do Chromium e falha em produção.
  outputFileTracingIncludes: {
    "/api/variacoes/analisar-biblioteca/route": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
