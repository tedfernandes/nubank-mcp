# nubank-mcp

[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)
[![Versão](https://img.shields.io/github/v/release/tedfernandes/nubank-mcp?label=vers%C3%A3o)](https://github.com/tedfernandes/nubank-mcp/releases)
[![Acesso somente leitura](https://img.shields.io/badge/acesso-somente%20leitura-green.svg)](SECURITY.md)

**Pergunte ao Claude sobre a sua conta do Nubank.** Servidor MCP remoto que roda num
Cloudflare Worker, lê a conta por Open Finance e não escreve nada, em lugar nenhum.

```
Você: quanto gastei com mercado nos últimos três meses?

Claude: R$ 2.847,30 em 38 compras, 31% do cartão no período.
        O maior mês foi agosto, com R$ 1.102,40.
        (dado de há 3 h; a coleta do banco é diária)
```

Funciona por texto ou por voz, no claude.ai, no celular ou no computador.

## O que dá para perguntar

| Ferramenta | Responde coisas como |
|---|---|
| `saldo_agora` | "quanto tenho?", "quanto sobrou de limite?", "quando fecha o cartão?" |
| `extrato` | "o que entrou em setembro?", "quem me pagou essa semana?" |
| `gastos_cartao` | "onde foi meu dinheiro no cartão?", "quanto de delivery no mês?" |
| `fatura_agora` | "o que tem na fatura?", "por que ela veio maior?" |
| `resumo_do_mes` | "fechei no azul?", "de onde veio e para onde foi?" |
| `recorrentes` | "quais assinaturas estou pagando sem perceber?" |
| `investimentos` | "quanto tenho aplicado, rendendo quanto?" |

Sete ferramentas, todas de leitura. Cada resposta traz a idade do dado, e lista grande vem
paginada dizendo quantas páginas existem: nada é cortado em silêncio.

```
claude.ai  ──OAuth──>  Cloudflare Worker  ──GET──>  agregador Open Finance  ──>  Nubank
                              │
                              └── KV: cache curto, descartável
```

O agregador é a [Pluggy](https://pluggy.ai), pelo conector pessoal gratuito
([meu.pluggy.ai](https://meu.pluggy.ai)). Trocar de agregador é reescrever um arquivo,
`src/provedor.ts`. Projeto independente, sem vínculo com o Nubank ou com a Pluggy.

## Instalação

Três telas no navegador e um comando, cerca de 15 minutos. Nenhum passo pede cartão.

Você precisa do aplicativo do Nubank no celular, do [Node.js](https://nodejs.org) instalado
e de uma conta gratuita na [Cloudflare](https://dash.cloudflare.com/sign-up).

**1. Chaves do agregador.** Crie a conta em
[dashboard.pluggy.ai](https://dashboard.pluggy.ai), crie uma **aplicação** e copie o
**Client ID** e o **Client Secret** (em alguns painéis o secret aparece uma vez só).

**2. Conecte o Nubank.** Em [meu.pluggy.ai](https://meu.pluggy.ai), **Nova conexão** →
**Nubank**, e confirme dentro do aplicativo do banco, no celular. Espere a bolinha verde.
Tem conta PJ também? Repita. Depois abra cada conexão em **Ver detalhes** e copie a **URL
inteira** da barra do navegador: o instalador extrai o código sozinho.

**3. Rode o instalador.**

```bash
git clone https://github.com/tedfernandes/nubank-mcp.git
cd nubank-mcp && npm install && npm run configurar
```

Ele entra na Cloudflare, cria o armazenamento, pergunta as chaves e as URLs (o secret não
aparece na tela), sorteia a sua frase de acesso, guarda tudo como segredo, publica e confere
se subiu de pé. Rodar de novo não duplica nada.

**4. Ligue no claude.ai.** O instalador copia o endereço e se oferece para abrir a página.
Lá: **Adicionar conector personalizado** → cole o endereço → **Vincular** → confira que o
retorno é `claude.ai/api/mcp/auth_callback` → cole a frase sorteada.

Pronto. Pergunte: *"qual meu saldo agora?"*

<details>
<summary><strong>Sem o instalador, na mão</strong></summary>

```bash
npx wrangler login
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create OAUTH_KV
# cole os dois ids nos lugares marcados em wrangler.jsonc

node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npx wrangler secret put PROVEDOR_CLIENT_ID
npx wrangler secret put PROVEDOR_CLIENT_SECRET
npx wrangler secret put CONEXAO_PF
npx wrangler secret put CONEXAO_PJ      # pule se não tiver
npx wrangler secret put TOKEN_DE_ACESSO

npm run verificar && npm run deploy
```

O segundo KV precisa se chamar exatamente `OAUTH_KV`: com outro nome, toda tentativa de
login morre em erro 1101 sem explicar o motivo. Confira em `https://seu-servidor/health`,
que diz se está protegido sem mostrar nada da conta.

</details>

## Dia a dia

O dado é de até 24 horas atrás. Para o número exato antes de decidir algo, abra a conexão em
[meu.pluggy.ai](https://meu.pluggy.ai), clique em **Atualizar** (de 15 a 30 segundos) e
pergunte *"qual meu saldo agora, sem cache?"*.

Conferência que fecha a conta do cartão: no aplicativo do banco, limite total menos limite
disponível dá a fatura corrente.

Para a atualização ficar instantânea, cadastre no painel do agregador um webhook de item
atualizado apontando para `https://seu-servidor/webhook/sync?k=SUA_FRASE`, com a frase
guardada antes em `npx wrangler secret put WEBHOOK_SEGREDO`.

## Quando algo dá errado

| O que aparece | O que fazer |
|---|---|
| Erro **1101** ao vincular | o segundo KV não se chama `OAUTH_KV`. Corrija e publique |
| `/health` com `protegido: false` | o `TOKEN_DE_ACESSO` não foi salvo. Rode o instalador de novo |
| "Frase incorreta" ao autorizar | a frase colada não é a que o instalador sorteou |
| "Nenhum item configurado" | faltou `CONEXAO_PF` ou `CONEXAO_PJ` |
| Saldo diferente do aplicativo | é a defasagem da coleta, veja abaixo |
| Conexão vermelha no agregador | o consentimento do Open Finance caiu ou expirou (vale 12 meses) |

## Limitações

**Não é tempo real.** A coleta do banco roda cerca de uma vez por dia no conector gratuito, e
a API recusa coleta sob demanda nele (`PATCH /items/{id}` responde
`400 "MeuPluggy item cant be updated"`). Pela interface do agregador, funciona. Por isso toda
resposta diz a idade do dado: número velho com cara de novo é pior que número ausente.

**O ciclo do cartão é derivado.** O conector entrega data de fechamento vazia e vencimento de
um ciclo atrás, então o ciclo corrente sai do padrão das faturas já publicadas: mesmo dia de
fechamento, mais o menor prazo observado, com o vencimento empurrado para o próximo dia útil
em feriado nacional (inclusive os móveis). A resposta sempre diz que a data é derivada. Se o
banco mudar a data de corte, as datas saem erradas até o histórico refletir o padrão novo.

**No cartão o sinal é invertido:** compra entra positiva e pagamento de fatura entra
negativo. O código separa por tipo de conta, senão compra viraria receita.

## Segurança

O pior que alguém consegue, com acesso total a este servidor, é **ler**:

- o cliente HTTP recusa qualquer método diferente de `GET` e confere host e esquema;
- nenhuma ferramenta escreve, transfere ou paga;
- descrição de transação é texto de terceiro e sai higienizada, o que **reduz sem eliminar**
  injeção indireta de prompt;
- documento e número de conta saem mascarados;
- OAuth com PKCE S256 obrigatório, fluxo implícito desligado e comparação em tempo constante;
- nenhum segredo versionado ou ecoado em erro.

Detalhes, e como reportar uma falha, em **[SECURITY.md](SECURITY.md)**.

## Custo

Zero nos planos gratuitos: o Worker dá 100 mil requisições por dia e o KV 1.000 escritas,
contra algumas dezenas de consultas que um uso pessoal gera. O conector pessoal do agregador
é gratuito para a própria conta.

## Dúvidas comuns

**Funciona com outro banco?** O agregador cobre vários bancos do Open Finance, e o código não
tem nada específico do Nubank além da observação sobre o vencimento. Os rótulos são `pf` e
`pj`, então hoje cabem duas contas.

**Claude Desktop ou Claude Code?** Sim, é um MCP remoto comum: aponte para
`https://seu-servidor/mcp` com `Authorization: Bearer <sua frase>`.

**Onde meus dados ficam?** Em lugar nenhum de forma durável. O Worker não tem banco, e o KV
guarda a última resposta por pouco tempo.

**O Claude vê a senha do banco?** Não. Você nunca a digita aqui: a autorização acontece no
Open Finance, dentro do aplicativo do Nubank, e é revogável por lá.

**Como desinstalo?** `npx wrangler delete`, mais `npx wrangler kv namespace delete --binding
CACHE` e o mesmo para `OAUTH_KV`. Depois remova o conector no claude.ai, a conexão no
agregador, e revogue o consentimento no aplicativo do banco.

## Desenvolvimento

```bash
cp .dev.vars.example .dev.vars   # preencha; fica fora do git
npm run dev
npm run verificar                # typecheck + build
```

| Arquivo | Papel |
|---|---|
| `src/index.ts` | roteamento, as sete ferramentas e o acesso por Bearer |
| `src/provedor.ts` | cliente HTTP: guarda de somente leitura e higienização de texto de terceiro |
| `src/financeiro.ts` | cache, ciclo derivado, conciliação de fatura, recorrentes |
| `src/oauth.ts` | provider de OAuth e tela de consentimento |
| `configurar.mjs` | o instalador de um comando |

Issue e pull request são bem-vindos. Duas regras não mudam, porque são a razão de este
projeto poder rodar com acesso à sua conta: **nenhuma ferramenta de escrita**, e **texto que
vem de fora é dado**, nunca instrução.

Histórico em [CHANGELOG.md](CHANGELOG.md). Licença [MIT](LICENSE): fornecido como está, e ele
lê dados financeiros, então revise o código antes de apontá-lo para a sua conta.
