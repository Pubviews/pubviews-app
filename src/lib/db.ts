import { Pool } from "pg";

// Conexão com o Postgres (Neon, via integração da Vercel — plano grátis).
// POSTGRES_URL é a variável padrão que a integração cria automaticamente no
// projeto (conexão via pooler, melhor pra funções serverless que abrem uma
// conexão nova a cada invocação). O Pool é reaproveitado entre invocações
// dentro da mesma instância "morna" da função (comportamento normal do
// Node.js na Vercel), então não recria conexão à toa o tempo todo.
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error(
        "POSTGRES_URL não configurada — o banco (Postgres/Neon) precisa estar conectado ao projeto na Vercel."
      );
    }
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

let tabelaGarantida = false;

/**
 * Cria a tabela de histórico se ainda não existir. Idempotente e barata
 * (IF NOT EXISTS) — chamada no início de toda operação de leitura/escrita
 * em vez de depender de uma migration manual separada, já que esse app não
 * tem uma etapa de deploy com step de migration.
 */
async function garantirTabela(): Promise<void> {
  if (tabelaGarantida) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS historico_variacoes (
      id SERIAL PRIMARY KEY,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      nicho TEXT,
      referencia TEXT,
      roteiro TEXT NOT NULL,
      formato TEXT NOT NULL,
      formato_video TEXT NOT NULL DEFAULT 'vertical',
      video_url TEXT NOT NULL
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS historico_variacoes_criado_em_idx ON historico_variacoes (criado_em DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS historico_variacoes_nicho_idx ON historico_variacoes (nicho);`);
  tabelaGarantida = true;
}

export interface EntradaHistorico {
  id: number;
  criadoEm: string;
  nicho: string | null;
  referencia: string | null;
  roteiro: string;
  formato: string;
  formatoVideo: string;
  videoUrl: string;
}

/**
 * Salva uma variação gerada no histórico. É best-effort do ponto de vista de
 * quem chama: se o banco falhar (não configurado, indisponível etc.), a
 * geração do vídeo em si não deve ser derrubada por isso — quem chama deve
 * envolver essa chamada num try/catch e só logar o erro.
 */
export async function salvarNoHistorico(params: {
  nicho?: string;
  referencia?: string;
  roteiro: string;
  formato: string;
  formatoVideo?: string;
  videoUrl: string;
}): Promise<number> {
  await garantirTabela();
  const db = getPool();
  const res = await db.query<{ id: number }>(
    `INSERT INTO historico_variacoes (nicho, referencia, roteiro, formato, formato_video, video_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      params.nicho || null,
      params.referencia || null,
      params.roteiro,
      params.formato,
      params.formatoVideo || "vertical",
      params.videoUrl,
    ]
  );
  return res.rows[0].id;
}

/**
 * Lista o histórico, mais recente primeiro, com paginação simples por
 * cursor (o id do último item já carregado) e filtro opcional por nicho
 * (busca parcial, sem diferenciar maiúsculas/minúsculas).
 */
export async function listarHistorico(params: {
  limit?: number;
  antesDoId?: number;
  nicho?: string;
}): Promise<EntradaHistorico[]> {
  await garantirTabela();
  const db = getPool();
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

  const condicoes: string[] = [];
  const valores: unknown[] = [];

  if (params.antesDoId) {
    valores.push(params.antesDoId);
    condicoes.push(`id < $${valores.length}`);
  }
  if (params.nicho) {
    valores.push(`%${params.nicho}%`);
    condicoes.push(`nicho ILIKE $${valores.length}`);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
  valores.push(limit);

  const res = await db.query(
    `SELECT id, criado_em, nicho, referencia, roteiro, formato, formato_video, video_url
     FROM historico_variacoes
     ${where}
     ORDER BY id DESC
     LIMIT $${valores.length}`,
    valores
  );

  return res.rows.map((r) => ({
    id: r.id,
    criadoEm: r.criado_em instanceof Date ? r.criado_em.toISOString() : String(r.criado_em),
    nicho: r.nicho,
    referencia: r.referencia,
    roteiro: r.roteiro,
    formato: r.formato,
    formatoVideo: r.formato_video,
    videoUrl: r.video_url,
  }));
}

export async function excluirDoHistorico(id: number): Promise<void> {
  await garantirTabela();
  const db = getPool();
  await db.query(`DELETE FROM historico_variacoes WHERE id = $1`, [id]);
}
