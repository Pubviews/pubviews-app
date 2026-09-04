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
 * Edita uma imagem existente (ex: um frame extraído de um "vídeo original"
 * que na prática é uma imagem/card estático) seguindo uma instrução em texto
 * — troca de ícone, mudança de texto, cor, etc. — mantendo o resto da imagem
 * como está. Opcionalmente aceita uma imagem de referência do elemento novo
 * (ex: "troque esse ícone pelo que está nessa outra imagem").
 *
 * Diferente da edição de VÍDEO (WaveSpeedAI, que só apaga), edição de IMAGEM
 * é a categoria de IA madura o bastante pra trocar/inserir elementos com
 * precisão — foi o que o usuário testou funcionando bem no ChatGPT.
 */
export async function editarImagemComIA(params: {
  imagemBase64: string;
  mimeType: string;
  instrucao: string;
  imagemReferenciaBase64?: string;
  mimeTypeReferencia?: string;
}): Promise<{ base64: string; mimeType: string }> {
  const partes: Array<Record<string, unknown>> = [
    { inlineData: { mimeType: params.mimeType, data: params.imagemBase64 } },
  ];
  if (params.imagemReferenciaBase64) {
    partes.push({
      inlineData: { mimeType: params.mimeTypeReferencia || "image/png", data: params.imagemReferenciaBase64 },
    });
  }

  const instrucaoCompleta = params.imagemReferenciaBase64
    ? `Esta é uma peça de anúncio (criativo). Edite a PRIMEIRA imagem seguindo esta instrução: "${params.instrucao}". Use a SEGUNDA imagem só como referência visual do elemento novo a inserir/trocar (o estilo/forma dela, não a cole como está). Mantenha tudo o resto da primeira imagem — layout, logos, textos não mencionados, cores, proporção da imagem — exatamente como está, mudando só o que foi pedido.`
    : `Esta é uma peça de anúncio (criativo). Edite esta imagem seguindo esta instrução: "${params.instrucao}". Mantenha tudo o resto — layout, logos, textos não mencionados, cores, proporção da imagem — exatamente como está, mudando só o que foi pedido.`;
  partes.push({ text: instrucaoCompleta });

  const json = await callGemini(
    IMAGE_MODEL,
    {
      contents: [{ role: "user", parts: partes }],
      generationConfig: { responseModalities: ["IMAGE"] },
    },
    60000
  );

  const parts = json.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType || "image/png" };
    }
  }
  throw new Error("Gemini não retornou uma imagem editada. Resposta: " + JSON.stringify(json).slice(0, 500));
}

/**
 * Sugere, a partir de um frame do vídeo/criativo original, qual das fontes
 * disponíveis (ver listarOpcoesDeFonte em src/lib/video.ts) mais se parece
 * com a fonte do texto que já estava no criativo — usada pra PRÉ-selecionar
 * a fonte nos seletores de "reescrever/corrigir texto" (o usuário sempre
 * pode trocar manualmente depois), em vez de sempre cair no padrão. Falha
 * silenciosa é aceitável em quem chama isso: é só uma conveniência, não uma
 * etapa obrigatória do fluxo.
 */
export async function sugerirFonteSemelhante(
  imagemBase64: string,
  mimeType: string,
  opcoes: { id: string; label: string }[]
): Promise<string> {
  const listaOpcoes = opcoes.map((o) => `- "${o.id}": ${o.label}`).join("\n");
  const prompt = `Esta imagem é um frame de um criativo de anúncio. Olhe para o texto principal/chamada (headline, botão de CTA etc.) já escrito na imagem e escolha, entre as opções de fonte abaixo, a que tem a aparência mais parecida com ela (grossura do traço, se é condensada/larga, se tem serifa, se é mais arredondada etc.):
${listaOpcoes}

Responda só com o id exato de uma das opções acima (ex: impacto), sem explicação, sem aspas, sem mais nada.`;

  const json = await callGemini(TEXT_MODEL, {
    contents: [
      {
        role: "user",
        parts: [{ inlineData: { mimeType, data: imagemBase64 } }, { text: prompt }],
      },
    ],
    generationConfig: { temperature: 0.1 },
  });

  const raw: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const idEscolhido = raw.trim().replace(/["'.]/g, "").toLowerCase();
  return opcoes.some((o) => o.id === idEscolhido) ? idEscolhido : "padrao";
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
 * Sugere um nicho curto (em português) a partir do texto de um anúncio —
 * usado quando o usuário cola o link de um anúncio da Ad Library e a gente
 * só tem o texto real do anúncio (Texto Principal/Título/Descrição), sem um
 * campo de "nicho" pronto como esse.
 */
export async function sugerirNichoDoTexto(texto: string): Promise<string> {
  const json = await callGemini(TEXT_MODEL, {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Baseado neste texto de um anúncio, responda só com uma categoria/nicho curta pro produto ou serviço anunciado (ex: "curso de empilhadeira"), em português, sem explicação e sem aspas: "${texto}"`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.3 },
  });
  const raw: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return raw.trim().replace(/^["']|["']$/g, "");
}

const ROTULO_TIPO_TEXTO: Record<string, string> = {
  texto_principal: "Texto Principal (corpo do anúncio, aparece acima da imagem/vídeo)",
  titulo: "Título (headline curta, aparece abaixo da imagem/vídeo, geralmente até ~40 caracteres)",
  descricao: "Descrição (linha extra abaixo do título, geralmente até ~30 caracteres, opcional em vários formatos)",
};

/**
 * Gera N variações de um Texto Principal, Título ou Descrição de anúncio que
 * já provou funcionar no nicho (repetido em vários anúncios ativos na Ad
 * Library) — mantém a ideia/gancho central, texto novo, mesmo tipo/tamanho.
 */
export async function gerarVariacoesDeTexto(params: {
  texto: string;
  tipo: "texto_principal" | "titulo" | "descricao";
  nicho: string;
  quantidade: number;
}): Promise<string[]> {
  const rotulo = ROTULO_TIPO_TEXTO[params.tipo] || params.tipo;
  const prompt = `Você é um redator de anúncios para Meta Ads (Facebook/Instagram).
Nicho: ${params.nicho}
Tipo de texto: ${rotulo}
Texto de referência, que já é usado em anúncios ativos e repetidos desse nicho (ou seja, já funciona): "${params.texto}"

Gere ${params.quantidade} variações desse texto, em INGLÊS, mantendo a mesma ideia central/gancho e aproximadamente o mesmo tamanho do texto de referência, mas com redação diferente entre si (evite repetir as mesmas frases). Sem markdown, sem aspas, sem numeração dentro do texto, sem emojis a menos que o texto de referência já use emojis.

Responda em JSON puro, um array de strings, exemplo: ["variação 1", "variação 2"]. Nada além do array JSON.`;

  const json = await callGemini(TEXT_MODEL, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9 },
  });

  const raw: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean).slice(0, params.quantidade);
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
 * Sugere termos de busca ALTERNATIVOS, no mesmo nicho do termo original, pra
 * ampliar uma busca na Ad Library que achou pouco — sinônimos, variações de
 * fraseado, termos mais genéricos ou mais específicos, mas sempre o mesmo
 * produto/serviço (nunca muda de nicho).
 */
export async function sugerirTermosRelacionados(termo: string, quantidade = 3): Promise<string[]> {
  const prompt = `Você busca anúncios na Meta Ad Library (Facebook/Instagram) por palavra-chave.
Termo de busca original: "${termo}"

Gere ${quantidade} termos de busca ALTERNATIVOS, em INGLÊS, que um comprador de mídia usaria pra encontrar anúncios do MESMO nicho/produto/serviço que "${termo}" — sinônimos, variações de fraseado, e termos um pouco mais genéricos ou mais específicos, mas sempre claramente o mesmo nicho. NÃO mude de nicho/produto (ex: se o termo é sobre curso/certificação de empilhadeira, não sugira algo como "warehouse jobs" ou "logistics company" — fique em torno de curso/certificação/treinamento de empilhadeira). Cada termo deve ter de 1 a 4 palavras, sem aspas, sem explicação, diferente entre si.

Responda em JSON puro, um array de strings, exemplo: ["termo 1", "termo 2", "termo 3"]. Nada além do array JSON.`;

  const json = await callGemini(TEXT_MODEL, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.6 },
  });

  const raw: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  let termos: string[] = [];
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) termos = parsed.map(String);
  } catch {
    termos = cleaned
      .split("\n")
      .map((l) => l.replace(/^[-\d.\s"]+/, "").replace(/"$/, "").trim())
      .filter(Boolean);
  }

  const termoNormalizado = termo.trim().toLowerCase();
  const vistos = new Set<string>();
  const resultado: string[] = [];
  for (const t of termos) {
    const limpo = t.trim();
    const chave = limpo.toLowerCase();
    if (!limpo || chave === termoNormalizado || vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(limpo);
    if (resultado.length >= quantidade) break;
  }
  return resultado;
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
            text:
              `Dê 2 a 4 palavras-chave em inglês para buscar um vídeo de banco de imagens (stock video) que combine com esta cena: "${descricao}".\n\n` +
              `Regras importantes:\n` +
              `- Se a cena menciona um esporte, time, liga ou lugar específico (ex: "futebol americano", "NFL", "basquete"), mantenha esse termo específico e literal nas palavras-chave (ex: "american football", não apenas "sports" ou "athlete") — buscas genéricas demais trazem vídeo de outro esporte ou de academia/alongamento, sem nada a ver com o pedido.\n` +
              `- Coloque a palavra-chave mais específica e importante primeiro.\n` +
              `- Prefira substantivos concretos e comuns em bancos de vídeo (ex: "stadium", "game", "crowd", "field") a frases publicitárias.\n\n` +
              `Responda só as palavras-chave, sem explicação.`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0.3 },
  });
  const raw: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? descricao;
  return raw.trim().replace(/["\n]/g, "");
}
