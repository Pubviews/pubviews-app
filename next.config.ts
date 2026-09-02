import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // fluent-ffmpeg e os binários instalados via @ffmpeg-installer/@ffprobe-installer
  // usam require() dinâmico e não podem ser processados pelo bundler do Next —
  // precisam ser carregados diretamente em runtime (Node.js) nas rotas de API.
  serverExternalPackages: [
    "fluent-ffmpeg",
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
  ],
};

export default nextConfig;
