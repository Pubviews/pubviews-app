import { env } from "./env";

const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "TX3LPaxmHKxFdv7VOQHJ"; // Liam - Energetic

/**
 * Gera narração em áudio (MP3, bytes) a partir de um texto.
 */
export async function gerarNarracao(texto: string, voiceId: string = DEFAULT_VOICE_ID): Promise<Buffer> {
  const key = env.elevenLabsApiKey();
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: texto,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs erro ${res.status}: ${body}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export interface Voz {
  voice_id: string;
  name: string;
}

export async function listarVozes(): Promise<Voz[]> {
  const key = env.elevenLabsApiKey();
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": key },
  });
  if (!res.ok) throw new Error(`ElevenLabs erro ${res.status}`);
  const json = await res.json();
  return (json.voices ?? []).map((v: { voice_id: string; name: string }) => ({
    voice_id: v.voice_id,
    name: v.name,
  }));
}
