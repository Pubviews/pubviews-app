import { env } from "./env";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Nomes de modelo configuráveis por variável de ambiente, com um padrão razoável.
// Se a Google trocar o nome do modelo disponível, é só atualizar a env var na Vercel,
// sem precisar mexer no código.
const TEXT_MODEL = process.env.GOOGLE_TEXT_MODEL || "gemini-3.6-flash";
const IMAGE_MODEL = process.env.GOOGLE_IMAGE_MODEL || "gemini-2.5-flash-image";

async function callGemini(model: string, body: unknown, timeoutMs = 45000) {
  const key = env.googleAiApiKey();
  let res: Response;
  try {
    res = await fetch(`${BASE}/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Sem isso, se a chamada pra Gemini travar/demorar demais, a função
      // fica presa até o Vercel matar a execução na marra (e às vezes nem
      // isso chega limpo até o navegador) — com o timeout aqui a gente
      // sempre devolve um erro claro pro usuário bem antes disso.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`A IA (Gemini) demorou mais de ${Math.round(timeoutMs / 1000)}s para responder. Tente de novo.`);
    }
    throw err;
  }
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
  const prompt = `Fotografia realista, estilo anúncio de redes sociais, alta qualidade, iluminação natural: ${descricao}. Sem texto sobreposto, sem marca d'água, sem logotipos. Se a cena mostrar naturalmente algum texto legível (tela de celular, letreiro, embalagem, notificação etc.), esse texto deve estar em INGLÊS, nunca em português — o anúncio final é em inglês.`;

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
 * Analisa um vídeo de criativo vencedor enviado pelo usuário (bytes em base64) e
 * extrai: o roteiro/estrutura pra preencher o campo de referência automaticamente,
 * um nicho sugerido, e uma descrição só da cena visual (usada depois pra decidir,
 * variação por variação, se ainda faz sentido reaproveitar esse mesmo visual).
 */
export async function analisarVideoDeReferencia(
  base64: string,
  mimeType: string
): Promise<{ referencia: string; nicho: string; descricaoVisual: string }> {
  const prompt = `Você é um estrategista de anúncios em vídeo para Meta Ads (Facebook/Instagram).
Analise o vídeo anexado, que é um criativo de anúncio vencedor, e responda em português com:
1. "referencia": um parágrafo curto juntando o roteiro/narração (ou texto mostrado) com a estrutura e o gancho do anúncio — como alguém descreveria esse anúncio pra pedir variações dele.
2. "nicho": uma categoria/nicho curto pro produto ou serviço anunciado (ex: "curso de empilhadeira").
3. "descricaoVisual": uma descrição objetiva só da CENA visual (pessoas, ambiente, produto, ação) — sem falar do áudio/roteiro.

Responda em JSON puro, exemplo: {"referencia": "...", "nicho": "...", "descricaoVisual": "..."}. Nada além do JSON.`;

  // Analisar vídeo demora bem mais que os outros usos do Gemini (a IA
  // "assiste" o vídeo inteiro) — timeout maior, alinhado ao maxDuration
  // dessa rota (veja src/app/api/variacoes/analisar-video/route.ts).
  const json = await callGemini(
    TEXT_MODEL,
    {
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }],
        },
      ],
      generationConfig: { temperature: 0.3 },
    },
    100000
  );

  const raw: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    return {
      referencia: String(parsed.referencia || "").trim(),
      nicho: String(parsed.nicho || "").trim(),
      descricaoVisual: String(parsed.descricaoVisual || "").trim(),
    };
  } catch {
    throw new Error("Não consegui entender a resposta da IA ao analisar o vídeo. Resposta: " + cleaned.slice(0, 300));
  }
}

export interface VariacaoComDecisaoVisual {
  texto: string;
  usarVisualOriginal: boolean;
  descricaoVisual: string;
}

/**
 * Igual a gerarVariacoesDeRoteiro, mas usada quando o usuário enviou um vídeo
 * próprio como referência: pra CADA variação, a IA decide se a cena visual
 * original ainda combina com o roteiro novo (reaproveita o vídeo enviado) ou
 * se o ângulo mudou demais e precisa de uma cena nova (imagem/vídeo gerado).
 */
export async function gerarVariacoesComVideoBase(params: {
  referencia: string;
  nicho: string;
  quantidade: number;
  descricaoVisualOriginal: string;
}): Promise<VariacaoComDecisaoVisual[]> {
  const prompt = `Você é um redator e estrategista de anúncios em vídeo para Meta Ads (Facebook/Instagram).
Nicho: ${params.nicho}
Criativo vencedor de referência (roteiro e estrutura): "${params.referencia}"
Cena visual do vídeo original enviado pelo usuário: "${params.descricaoVisualOriginal}"

Gere ${params.quantidade} variações de roteiro para narração (voz em off), em INGLÊS, cada uma com 2 a 4 frases curtas, mantendo a mesma estrutura/gancho do vencedor mas com texto diferente (evite repetir as mesmas frases entre as variações). Sem instruções de cena, sem markdown, sem numeração dentro do texto.

Para CADA variação, decida também se a cena visual original (descrita acima) ainda combina bem com esse roteiro novo:
- Se ainda combinar (mesmo produto/ambiente/ação, só o texto muda), marque "usarVisualOriginal": true e deixe "descricaoVisual" igual à cena original.
- Se o roteiro pedir uma cena diferente (produto, ambiente ou ação diferente do vídeo original), marque "usarVisualOriginal": false e escreva em "descricaoVisual" uma nova descrição de cena, em português, objetiva, pra gerar uma imagem nova.

Responda em JSON puro, um array de objetos, exemplo:
[{"texto": "...", "usarVisualOriginal": true, "descricaoVisual": "..."}, {"texto": "...", "usarVisualOriginal": false, "descricaoVisual": "..."}]
Nada além do array JSON.`;

  const json = await callGemini(TEXT_MODEL, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9 },
  });

  const raw: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => ({
        texto: String(v.texto || ""),
        usarVisualOriginal: Boolean(v.usarVisualOriginal),
        descricaoVisual: String(v.descricaoVisual || params.descricaoVisualOriginal),
      }));
    }
  } catch {
    // se a IA não devolver JSON limpo, cai pra tudo com visual novo (mais seguro)
  }
  return [];
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
