// Centraliza a leitura das variáveis de ambiente e dá erro claro se faltar alguma.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} não configurada. Adicione em Project Settings -> Environment Variables na Vercel.`
    );
  }
  return value;
}

export const env = {
  metaAccessToken: () => required("META_ACCESS_TOKEN"),
  elevenLabsApiKey: () => required("ELEVENLABS_API_KEY"),
  googleAiApiKey: () => required("GOOGLE_AI_API_KEY"),
  pexelsApiKey: () => required("PEXELS_API_KEY"),
  appPassword: () => process.env.APP_PASSWORD || "",
  waveSpeedApiKey: () => required("WAVESPEED_API_KEY"),
};
