/**
 * Servidor MCP remoto que liga a sua conta do Nubank ao claude.ai.
 *
 * Desenho: um Cloudflare Worker, sem VPS, sem tunel, sem Durable Object e sem
 * banco de dados. Nao ha maquina para cair, e o unico estado e um cache em KV
 * que pode ser jogado fora a qualquer momento.
 *
 * Somente leitura, e isso e estrutural, nao disciplina: o cliente HTTP recusa
 * qualquer metodo que nao seja GET (ver `provedor.ts`), e nao existe tool que
 * transfira, pague ou altere coisa alguma. O pior que um atacante consegue com
 * acesso total a este servidor e ler.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import * as fin from "./financeiro";
import { comOAuth as criarOAuth, type EnvOAuth } from "./oauth";

interface Env extends fin.EnvFinanceiro, EnvOAuth {
  /** Frase de acesso. Workers Secret, nunca em wrangler.jsonc. */
  TOKEN_DE_ACESSO?: string;
}

/** Retorno padrao de tool. Tipar num lugar so evita repetir `as const` em cada uma. */
function texto(conteudo: string) {
  return { content: [{ type: "text" as const, text: conteudo }] };
}

/**
 * O SDK recusa reusar uma instancia ja conectada a um transporte, porque uma
 * instancia global vazaria resposta entre clientes. Por isso a fabrica cria uma
 * por requisicao.
 */
function createServer(env: Env) {
  const server = new McpServer({ name: "nubank-mcp", version: "1.0.0" });

  // Toda resposta carrega a idade do dado: a coleta do banco roda cerca de uma
  // vez por dia, entao numero sem data engana quem le.
  const erro = (e: unknown) =>
    texto(`Nao consegui ler a conta: ${e instanceof Error ? e.message : "falha inesperada"}`);

  const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("AAAA-MM-DD");
  const pagina = z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("pagina da lista; cada resposta diz quantas paginas existem");
  const porPagina = z
    .number()
    .int()
    .min(10)
    .max(500)
    .optional()
    .describe("lancamentos por pagina (padrao 200)");
  const semCache = z
    .boolean()
    .optional()
    .describe(
      "pula o cache deste servidor e rele o que o provedor tem agora. Use depois de " +
        "mandar o app do agregador sincronizar; nao forca coleta nova no banco.",
    );

  server.registerTool(
    "saldo_agora",
    {
      description:
        "Posicao das contas e cartoes no ultimo retrato do banco: saldo, numero da conta, " +
        "titular, limite do cartao, limite disponivel, fechamento e vencimento do ciclo, " +
        "cheque especial e saldo rendendo na conta. Nao e tempo real: a coleta roda cerca " +
        "de uma vez por dia, e a resposta diz de quando e o dado.",
      inputSchema: { sem_cache: semCache },
    },
    async ({ sem_cache }) => {
      try {
        return texto(await fin.saldo(env, sem_cache ?? false));
      } catch (e) {
        return erro(e);
      }
    },
  );

  server.registerTool(
    "extrato",
    {
      description:
        "Extrato da conta corrente num periodo, ate onde a ultima coleta enxergou: todo " +
        "lancamento, com categoria, meio de pagamento, contraparte e saldo apos cada um. " +
        "Sem corte: lista longa vem paginada e a resposta diz quantas paginas existem.",
      inputSchema: { conta: z.enum(["pj", "pf"]), de: data, ate: data, pagina, por_pagina: porPagina },
    },
    async ({ conta, de, ate, pagina, por_pagina }) => {
      try {
        return texto(await fin.transacoes(env, conta, de, ate, pagina ?? 1, por_pagina ?? 200));
      } catch (e) {
        return erro(e);
      }
    },
  );

  server.registerTool(
    "gastos_cartao",
    {
      description:
        "Compras no cartao de credito num periodo, com quebra por categoria e a lista " +
        "inteira (parcela inclusive). Pagamento de fatura e estorno ficam de fora.",
      inputSchema: { conta: z.enum(["pj", "pf"]), de: data, ate: data, pagina, por_pagina: porPagina },
    },
    async ({ conta, de, ate, pagina, por_pagina }) => {
      try {
        return texto(await fin.gastosCartao(env, conta, de, ate, pagina ?? 1, por_pagina ?? 200));
      } catch (e) {
        return erro(e);
      }
    },
  );

  server.registerTool(
    "fatura_agora",
    {
      description:
        "Cartao por dentro: limite, ciclo, encargos e o historico de faturas, mais os " +
        "lancamentos item a item. Sem vencimento informado detalha o ciclo em formacao " +
        "(derivado do padrao das faturas publicadas); com vencimento, a fatura fechada.",
      inputSchema: {
        conta: z.enum(["pj", "pf"]),
        vencimento: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("vencimento da fatura a detalhar, como aparece na tabela"),
        pagina,
        por_pagina: porPagina,
        sem_cache: semCache,
      },
    },
    async ({ conta, vencimento, pagina, por_pagina, sem_cache }) => {
      try {
        return texto(
          await fin.fatura(env, conta, vencimento, pagina ?? 1, por_pagina ?? 200, sem_cache ?? false),
        );
      } catch (e) {
        return erro(e);
      }
    },
  );

  server.registerTool(
    "resumo_do_mes",
    {
      description:
        "Mes fechado: entradas, saidas e resultado por conta, gasto no cartao, quebra por " +
        "categoria de onde veio e para onde foi, e os maiores lancamentos dos dois lados.",
      inputSchema: { mes: z.string().regex(/^\d{4}-\d{2}$/).describe("AAAA-MM") },
    },
    async ({ mes }) => {
      try {
        return texto(await fin.resumoMensal(env, mes));
      } catch (e) {
        return erro(e);
      }
    },
  );

  server.registerTool(
    "recorrentes",
    {
      description:
        "Cobrancas que se repetem (assinatura, mensalidade): mesmo comerciante em dois ou " +
        "mais meses, somando conta e cartao, PJ e PF.",
      inputSchema: {
        meses: z.number().int().min(2).max(12).optional().describe("janela em meses (padrao 3)"),
      },
    },
    async ({ meses }) => {
      try {
        return texto(await fin.recorrentes(env, meses ?? 3));
      } catch (e) {
        return erro(e);
      }
    },
  );

  server.registerTool(
    "investimentos",
    {
      description:
        "Aplicacoes da conta (CDB, caixinha, fundo): valor aplicado, saldo atual, taxa e " +
        "vencimento. Conexao que nao expoe investimentos diz isso em vez de falhar.",
    },
    async () => {
      try {
        return texto(await fin.investimentos(env));
      } catch (e) {
        return erro(e);
      }
    },
  );

  return server;
}

/** Sem frase configurada o Worker nao serve nada: falha fechado, nunca aberto. */
function autorizado(request: Request, env: Env): boolean {
  if (!env.TOKEN_DE_ACESSO) return false;
  const cabecalho = request.headers.get("Authorization") ?? "";
  const enviado = cabecalho.replace(/^Bearer\s+/i, "").trim();
  if (enviado.length !== env.TOKEN_DE_ACESSO.length) return false;
  // comparacao de tempo constante: evita distinguir a frase por latencia
  let diff = 0;
  for (let i = 0; i < enviado.length; i++) {
    diff |= enviado.charCodeAt(i) ^ env.TOKEN_DE_ACESSO.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * O MCP em si. Recebe requisicao ja autenticada: ou pelo Bearer token (uso
 * direto, MCP Inspector), ou pelo OAuth (connector do claude.ai), que injeta
 * `props` e so encaminha o que ja validou.
 */
const mcp = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return createMcpHandler(() => createServer(env))(request, env, ctx);
  },
};

const comOAuth = criarOAuth(mcp);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Diagnostico sem dado nenhum da conta: so diz se esta configurado.
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        protegido: Boolean(env.TOKEN_DE_ACESSO),
        oauth: Boolean(env.OAUTH_KV),
      });
    }

    // Aviso de coleta do agregador. Fica fora do OAuth porque quem chama e um
    // servidor, nao uma pessoa: a credencial e o segredo na query, conferido
    // dentro. So apaga cache proprio, nunca devolve dado da conta.
    if (url.pathname === "/webhook/sync" && request.method === "POST") {
      return fin.webhookColeta(request, env);
    }

    // Caminho direto por Bearer: serve o MCP Inspector e o uso por script, sem
    // obrigar OAuth para tudo. So vale em /mcp e so com a frase exata.
    if (url.pathname === "/mcp" && autorizado(request, env)) {
      return mcp.fetch(request, env, ctx);
    }

    // Todo o resto (inclusive /mcp sem a frase) vai para o OAuth, que responde
    // /authorize, /token, /register e o .well-known, e devolve 401 quando falta
    // credencial.
    return comOAuth.fetch(request, env, ctx);
  },
};
