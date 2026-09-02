import { env } from "./env";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Nomes de modelo configuráveis por variável de ambiente, com um padrão razoável.
// Se a Google trocar o nome do modelo disponível, é só atualizar a env var na Vercel,
// sem precisar mexer no código.
const TEXT_MODEL = process.env.GOOGLE_TEXT_MODEL || "gemini-3.6-flash";
const IMAGE_MODEL = process.env.GOOGLE_IMAGE_MODEL || "gemini-2.5-flash-image";

async function callGemini(model: string, body: unknown) {
  const key = env.googleAiApiKey();
  const res = await fetch(`${BASE}/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini (${model}) erro ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Gera N variações de roteiro (texto de narração) a partir de uma referência.
 * Mantém a mesma estrutura/gancho do vencedor, com texto novo.
 */
export async function gerarVariacoesDeRoteiro(params: {
  referencia: string;
  nicho: string;
  quantidade: number;
}): Promise<string[]> {
  const prompt = `Você é um redator de anúncios em vídeo para Meta Ads (Facebook/Instagram).
Nicho: ${params.nicho}
Criativo vencedor de referência (formato e ideia central): "${params.referencia}"

Gere ${params.quantidade} variações de roteiro para narração (voz em off), em INGLÊS, cada uma com 2 a 4 frases curtas, mantendo a mesma estrutura/gancho do vencedor mas com texto diferente (evite repetir as mesmas frases entre as variações). O texto deve soar natural quando narrado por uma voz de IA, sem instruções de cena, sem markdown, sem numeração dentro do texto.

Responda em JSON puro, um array de strings, exemplo: ["texto variação 1", "texto variação 2"]. Nada além do array JSON.`;

  const json = await callGemini(TEXT_MODEL, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9 },
  });

  const raw: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // fallback: quebra por linha se o modelo não devolveu JSON limpo
  }
  return cleaned
    .split("\n")
    .map((l) => l.replace(/^[-\d.\s"]+/, "").replace(/"$/, "").trim())
    .filter(Boolean)
    .slice(0, params.quantidade);
}

/**
 * Gera uma imagem realista (bytes PNG/JPEG em base64) a partir de uma descrição textual.
 */
export async function gerarImagem(descricao: string): Promise<{ base64: string; mimeType: string }> {
  const prompt = `Fotografia realista, estilo anúncio de redes sociais, alta qualidade, iluminação natural: ${descricao}. Sem texto sobreposto, sem marca d'água, sem logotipos.`;

  const json = await callGemini(IMAGE_MODEL, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"] },
  });

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType || "image/png" };
    }
  }
  throw new Error("Gemini não retornou imagem. Resposta: " + JSON.stringify(json).slice(0, 500));
}

/**
 * Sugere termos de busca em inglês (para Pexels) a partir de uma descrição de nicho/cena.
 */
export async function sugerirTermosDeBusca(descricao: string): Promise<string> {
  const json = await callGemini(TEXT_MODEL, {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Dê 2 a 4 palavras-chave em inglês para buscar um vídeo de banco de imagens (stock video) que combine com esta cena: "${descricao}". Responda só as palavras-chave, sem explicação.`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.3 },
  });
  const raw: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? descricao;
  return raw.trim().replace(/["\n]/g, "");
}
