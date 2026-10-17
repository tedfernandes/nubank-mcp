#!/usr/bin/env node
/**
 * Instalador de um comando: `npm run configurar`.
 *
 * Faz, na ordem, tudo o que antes eram doze comandos manuais: entra na
 * Cloudflare, cria os dois namespaces de KV, escreve os ids no wrangler.jsonc,
 * pergunta as credenciais uma vez, sorteia a frase de acesso, grava todos os
 * segredos, publica e imprime o que colar no claude.ai.
 *
 * E idempotente: rodar de novo nao duplica KV nem exige redigitar o que ja
 * esta configurado.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

const CONFIG = new URL("./wrangler.jsonc", import.meta.url);
const HEX32 = /^[0-9a-f]{32}$/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const cor = {
  titulo: (s) => `\n\x1b[1m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  aviso: (s) => `\x1b[33m${s}\x1b[0m`,
  erro: (s) => `\x1b[31m${s}\x1b[0m`,
  fraco: (s) => `\x1b[2m${s}\x1b[0m`,
};

/** Roda um comando mostrando a saida, e devolve o que saiu. */
function rodar(cmd, args, { entrada, silencioso = false } = {}) {
  const r = spawnSync(cmd, args, {
    input: entrada,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const saida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (!silencioso && saida.trim()) console.log(cor.fraco(saida.trim().split("\n").slice(-3).join("\n")));
  return { ok: r.status === 0, saida };
}

function perguntar(texto, { escondido = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    if (escondido) {
      // nao ecoa o que for digitado: credencial nao fica na tela nem no scrollback
      const escrever = rl._writeToOutput?.bind(rl);
      rl._writeToOutput = function (s) {
        if (s.includes(texto)) escrever(s);
      };
    }
    rl.question(texto, (resposta) => {
      rl.close();
      if (escondido) stdout.write("\n");
      resolve(resposta.trim());
    });
  });
}

/** Poe o texto na area de transferencia. Falhar aqui nao atrapalha nada. */
function copiar(texto) {
  const cmd =
    process.platform === "win32"
      ? ["clip", []]
      : process.platform === "darwin"
        ? ["pbcopy", []]
        : ["xclip", ["-selection", "clipboard"]];
  try {
    const r = spawnSync(cmd[0], cmd[1], { input: texto, shell: process.platform === "win32" });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Abre a pagina no navegador padrao, sem derrubar o instalador se nao der.
 *
 * O endereco vai entre aspas no Windows de proposito: `&` e `?` sao
 * metacaracteres do cmd, e uma URL com query string quebraria o comando ao
 * meio sem erro visivel.
 */
function abrirNavegador(endereco) {
  const cmd =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", `"${endereco}"`]]
      : process.platform === "darwin"
        ? ["open", [endereco]]
        : ["xdg-open", [endereco]];
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* segue sem abrir: o endereco esta impresso acima */
  }
}

/** Aceita o id cru ou a URL inteira copiada do painel. */
function extrairId(valor) {
  const m = String(valor).match(UUID);
  return m ? m[0] : valor.trim();
}

function lerConfig() {
  return readFileSync(CONFIG, "utf8");
}

function idJaConfigurado(binding) {
  const t = lerConfig();
  const m = t.match(new RegExp(`"binding"\\s*:\\s*"${binding}"\\s*,\\s*"id"\\s*:\\s*"([^"]+)"`));
  return m && HEX32.test(m[1]) ? m[1] : null;
}

function gravarId(binding, id) {
  const t = lerConfig();
  const novo = t.replace(
    new RegExp(`("binding"\\s*:\\s*"${binding}"\\s*,\\s*"id"\\s*:\\s*")([^"]*)(")`),
    `$1${id}$3`,
  );
  writeFileSync(CONFIG, novo, "utf8");
}

async function garantirKv(binding) {
  const existente = idJaConfigurado(binding);
  if (existente) {
    console.log(`  ${cor.ok("ja configurado")} ${binding} (${existente.slice(0, 8)}...)`);
    return;
  }
  console.log(`  criando ${binding}...`);
  const { ok, saida } = rodar("npx", ["wrangler", "kv", "namespace", "create", binding], {
    silencioso: true,
  });
  const m = saida.match(/"id"\s*:\s*"([0-9a-f]{32})"/i) || saida.match(/id\s*=\s*"([0-9a-f]{32})"/i);
  if (!ok || !m) {
    console.log(cor.erro(`  nao consegui criar ${binding}.`));
    console.log(cor.fraco(saida.trim().split("\n").slice(-5).join("\n")));
    process.exit(1);
  }
  gravarId(binding, m[1]);
  console.log(`  ${cor.ok("criado")} ${binding} (${m[1].slice(0, 8)}...)`);
}

function gravarSegredo(nome, valor) {
  const { ok, saida } = rodar("npx", ["wrangler", "secret", "put", nome], {
    entrada: `${valor}\n`,
    silencioso: true,
  });
  if (!ok) {
    console.log(cor.erro(`  falhou ao gravar ${nome}`));
    console.log(cor.fraco(saida.trim().split("\n").slice(-4).join("\n")));
    process.exit(1);
  }
  console.log(`  ${cor.ok("guardado")} ${nome}`);
}

async function main() {
  console.log(cor.titulo("nubank-mcp: instalacao"));
  console.log(
    cor.fraco(
      "Tenha em maos o Client ID e o Client Secret do painel do agregador,\n" +
        "e a pagina de cada conexao aberta (voce pode colar a URL inteira).",
    ),
  );

  console.log(cor.titulo("1. Cloudflare"));
  const quem = rodar("npx", ["wrangler", "whoami"], { silencioso: true });
  if (!quem.ok || /not authenticated|You are not logged in/i.test(quem.saida)) {
    console.log("  abrindo o navegador para autorizar...");
    const login = spawnSync("npx", ["wrangler", "login"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (login.status !== 0) {
      console.log(cor.erro("  login nao concluido. Rode `npx wrangler login` e tente de novo."));
      process.exit(1);
    }
  }
  console.log(`  ${cor.ok("conectado")}`);

  console.log(cor.titulo("2. Armazenamento (KV)"));
  await garantirKv("CACHE");
  await garantirKv("OAUTH_KV");

  console.log(cor.titulo("3. Credenciais do agregador"));
  const clientId = await perguntar("  Client ID: ");
  const clientSecret = await perguntar("  Client Secret (nao aparece na tela): ", { escondido: true });
  if (!clientId || !clientSecret) {
    console.log(cor.erro("  as duas sao obrigatorias."));
    process.exit(1);
  }

  console.log(cor.titulo("4. Conexoes"));
  console.log(cor.fraco("  Cole a URL da conexao ou so o id. Enter em branco pula."));
  const pf = extrairId(await perguntar("  Conta pessoal (PF): "));
  const pj = extrairId(await perguntar("  Conta PJ: "));
  if (!pf && !pj) {
    console.log(cor.erro("  pelo menos uma conexao e necessaria."));
    process.exit(1);
  }

  console.log(cor.titulo("5. Frase de acesso"));
  const frase = randomBytes(48).toString("base64url");
  console.log(`  ${cor.ok("sorteada")} (aparece no fim, para voce colar no claude.ai)`);

  console.log(cor.titulo("6. Guardando os segredos na Cloudflare"));
  gravarSegredo("PROVEDOR_CLIENT_ID", clientId);
  gravarSegredo("PROVEDOR_CLIENT_SECRET", clientSecret);
  if (pf) gravarSegredo("CONEXAO_PF", pf);
  if (pj) gravarSegredo("CONEXAO_PJ", pj);
  gravarSegredo("TOKEN_DE_ACESSO", frase);

  console.log(cor.titulo("7. Publicando"));
  const deploy = rodar("npx", ["wrangler", "deploy"], { silencioso: true });
  const url = deploy.saida.match(/https:\/\/[^\s]+workers\.dev/)?.[0];
  if (!deploy.ok || !url) {
    console.log(cor.erro("  o deploy falhou."));
    console.log(cor.fraco(deploy.saida.trim().split("\n").slice(-8).join("\n")));
    process.exit(1);
  }
  console.log(`  ${cor.ok("no ar")} ${url}`);

  const saude = await fetch(`${url}/health`).then((r) => r.json()).catch(() => null);
  if (saude?.protegido && saude?.oauth) {
    console.log(`  ${cor.ok("conferido")} servidor protegido e com login ligado`);
  } else {
    console.log(cor.aviso(`  atencao: /health respondeu ${JSON.stringify(saude)}`));
  }

  // O endereco vai para a area de transferencia porque e a unica coisa que a
  // pessoa precisa colar na proxima tela, e digitar na mao erra facil.
  const copiado = copiar(`${url}/mcp`);

  console.log(cor.titulo("Pronto. Falta so ligar no claude.ai:"));
  console.log(`
  1. Adicionar conector personalizado
  2. Endereco:  ${cor.ok(`${url}/mcp`)}${copiado ? cor.fraco("   (ja copiado para a area de transferencia)") : ""}
  3. Clique em Vincular. Confira que o retorno e claude.ai/api/mcp/auth_callback
  4. Cole esta frase quando for pedida:

     ${cor.ok(frase)}

  ${cor.fraco("Guarde a frase num gerenciador de senhas: ela nao e mostrada de novo.")}
  ${cor.fraco('Depois, pergunte na conversa: "qual meu saldo agora?"')}
`);

  const abrir = (await perguntar("  Abrir a pagina de conectores agora? [S/n] ")) || "s";
  if (/^s/i.test(abrir)) {
    abrirNavegador("https://claude.ai/settings/connectors");
    console.log(cor.fraco("  abrindo claude.ai/settings/connectors..."));
  }
}

main().catch((e) => {
  console.log(cor.erro(`\nfalhou: ${e?.message ?? e}`));
  process.exit(1);
});
