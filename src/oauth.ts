/**
 * Camada OAuth para o connector do claude.ai.
 *
 * Escrita com os achados de uma auditoria de um servidor MCP remoto anterior,
 * porque a falha la nao foi de biblioteca, foi de configuracao e de desenho da
 * tela:
 *
 *  - PKCE `plain` era aceito. Aqui `allowPlainPKCE: false`: so S256.
 *  - Registro dinamico gravava cliente no KV **para sempre**, e um POST anonimo
 *    em loop enchia o namespace. Aqui `clientRegistrationTTL` de 30 dias.
 *  - A tela de "consentimento" era um formulario que pedia o TOKEN digitado, e
 *    o nome do cliente vinha de quem registrou. Isso e phishing pronto: bastava
 *    registrar um cliente chamado "Claude" e mandar o link no dominio legitimo.
 *    Aqui a tela nao pede credencial nenhuma: mostra quem esta pedindo, mostra
 *    o redirect_uri, e pede uma frase de aprovacao que so voce sabe.
 *  - Fluxo implicito desligado.
 */
import OAuthProvider from "@cloudflare/workers-oauth-provider";

export interface EnvOAuth {
  /** O provider exige exatamente este nome de binding. */
  OAUTH_KV?: KVNamespace;
  /** Mesma frase do TOKEN_DE_ACESSO: quem a conhece e voce. */
  TOKEN_DE_ACESSO?: string;
}

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function pagina(corpo: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autorizar acesso</title>
<style>
 :root{color-scheme:light dark}
 body{font:16px/1.55 system-ui,sans-serif;max-width:34rem;margin:6vh auto;padding:0 1.2rem}
 .cartao{border:1px solid color-mix(in oklab,currentColor 22%,transparent);border-radius:12px;padding:1.1rem 1.3rem;margin:1.2rem 0}
 dt{font-size:.8rem;opacity:.7;margin-top:.6rem}
 dd{margin:0;font-family:ui-monospace,monospace;word-break:break-all}
 input,button{font:inherit;padding:.6rem .8rem;border-radius:8px;border:1px solid color-mix(in oklab,currentColor 30%,transparent);width:100%;box-sizing:border-box}
 button{margin-top:.8rem;cursor:pointer;background:#2c6bed;color:#fff;border:0}
 .alerta{background:color-mix(in oklab,#e5a50a 18%,transparent);padding:.8rem 1rem;border-radius:8px;font-size:.92rem}
</style>${corpo}`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * Handler das telas de autorizacao. O `OAuthProvider` cuida de /token,
 * /register e do .well-known.
 */
export const telaDeConsentimento = {
  async fetch(request: Request, env: EnvOAuth, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const provider = (env as any).OAUTH_PROVIDER;

    if (url.pathname !== "/authorize") {
      return pagina(
        `<h1>nubank-mcp</h1><p>Servidor MCP privado. Nada aqui e publico.</p>`,
        404,
      );
    }

    let info;
    try {
      info = await provider.parseAuthRequest(request);
    } catch {
      return pagina(`<h1>Pedido invalido</h1><p>Faltam parametros de OAuth.</p>`, 400);
    }
    const cliente = await provider.lookupClient(info.clientId);

    if (request.method === "GET") {
      // O nome vem de quem registrou o cliente: mostrar como texto, sempre
      // acompanhado do redirect_uri, que e o que de fato importa conferir.
      return pagina(`
<h1>Autorizar acesso a sua conta</h1>
<div class="alerta">
  Confira <strong>para onde</strong> o acesso vai. O nome abaixo foi escolhido por
  quem pediu a conexao e nao prova identidade. O endereco de retorno, sim.
</div>
<div class="cartao">
  <dl>
    <dt>Aplicativo diz chamar-se</dt><dd>${escapar(cliente?.clientName ?? "(sem nome)")}</dd>
    <dt>Endereco de retorno</dt><dd>${escapar(info.redirectUri)}</dd>
    <dt>Permissoes pedidas</dt><dd>${escapar(info.scope.join(" ") || "leitura")}</dd>
  </dl>
</div>
<p>Se voce nao iniciou esta conexao, feche esta pagina.</p>
<form method="POST">
  <label for="f">Frase de aprovacao</label>
  <input id="f" name="frase" type="password" autocomplete="off" required
         placeholder="a mesma do token do servidor">
  <button type="submit">Autorizar somente leitura</button>
</form>`);
    }

    const form = await request.formData();
    const frase = String(form.get("frase") ?? "");
    if (!env.TOKEN_DE_ACESSO || frase !== env.TOKEN_DE_ACESSO) {
      return pagina(`<h1>Frase incorreta</h1><p>Nada foi autorizado.</p>`, 403);
    }

    const { redirectTo } = await provider.completeAuthorization({
      request: info,
      userId: "dono",
      metadata: { autorizadoEm: new Date().toISOString() },
      scope: info.scope,
      props: { papel: "dono" },
    });
    return Response.redirect(redirectTo, 302);
  },
};

export function comOAuth(apiHandler: any) {
  return new OAuthProvider({
    apiRoute: "/mcp",
    apiHandler,
    defaultHandler: telaDeConsentimento as any,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    // As tres travas que faltavam naquele servidor:
    allowPlainPKCE: false,
    allowImplicitFlow: false,
    clientRegistrationTTL: 30 * 24 * 60 * 60,
    accessTokenTTL: 60 * 60,
  });
}
