# nubank-mcp

[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)
[![Versão](https://img.shields.io/github/v/release/tedfernandes/nubank-mcp?label=vers%C3%A3o)](https://github.com/tedfernandes/nubank-mcp/releases)
[![Acesso somente leitura](https://img.shields.io/badge/acesso-somente%20leitura-green.svg)](#segurança)

**Pergunte ao Claude sobre a sua conta do Nubank.** Um servidor MCP remoto que roda num
Cloudflare Worker, lê a conta por Open Finance e não escreve nada, em lugar nenhum.

```
Você: quanto gastei com mercado nos últimos três meses?

Claude: R$ 2.847,30 em 38 compras, 31% do cartão no período.
        O maior mês foi agosto, com R$ 1.102,40.
        (dado de há 3 h; a coleta do banco é diária)
```

Funciona por texto ou por voz, no claude.ai, no celular ou no computador.

**Atalhos:**
[o que perguntar](#o-que-dá-para-perguntar) ·
[instalação](#instalação) ·
[dia a dia](#dia-a-dia) ·
[limitações](#limitações) ·
[segurança](#segurança) ·
[custo](#custo) ·
[dúvidas](#perguntas-frequentes)

## O que dá para perguntar

Sete ferramentas, todas de leitura:

| Ferramenta | Responde coisas como |
|---|---|
| `saldo_agora` | "quanto tenho?", "quanto sobrou de limite?", "quando fecha o cartão?" |
| `extrato` | "o que entrou em setembro?", "quem me pagou essa semana?" |
| `gastos_cartao` | "onde foi meu dinheiro no cartão?", "quanto de delivery no mês?" |
| `fatura_agora` | "o que tem na fatura?", "por que ela veio maior?" |
| `resumo_do_mes` | "fechei no azul?", "de onde veio e para onde foi?" |
| `recorrentes` | "quais assinaturas estou pagando sem perceber?" |
| `investimentos` | "quanto tenho aplicado, rendendo quanto?" |

Cada resposta traz **a idade do dado**, porque a coleta do banco é diária. Lista grande vem
paginada, e a resposta diz quantas páginas existem: nada é cortado em silêncio.

## Como funciona

```
claude.ai  ──OAuth──>  Cloudflare Worker  ──GET──>  agregador Open Finance  ──>  Nubank
                              │
                              └── KV: cache curto, descartável
```

O agregador é a **[Pluggy](https://pluggy.ai)**, pelo conector pessoal gratuito
([meu.pluggy.ai](https://meu.pluggy.ai)), que expõe a sua própria conta via Open Finance sem
custo. O código só depende do endereço da API dele: trocar de agregador é reescrever um
arquivo, `src/provedor.ts`.

Projeto independente, sem vínculo com o Nubank ou com a Pluggy.

## Instalação

Três telas no navegador e **um comando**. Cerca de 15 minutos na primeira vez, e nenhum passo
pede cartão de crédito.

**Você vai precisar de:** o aplicativo do Nubank no celular (para autorizar),
[Node.js](https://nodejs.org) instalado (versão LTS, instalação padrão) e uma conta gratuita
na [Cloudflare](https://dash.cloudflare.com/sign-up).

### 1. Pegue as duas chaves do agregador

O Nubank não entrega seus dados direto para um programa. Quem faz essa ponte, com a sua
autorização, é um agregador de Open Finance.

1. Crie a conta em [dashboard.pluggy.ai](https://dashboard.pluggy.ai).
2. Crie uma **aplicação** (Application). O nome pode ser `nubank-mcp`.
3. Copie o **Client ID** e o **Client Secret**. Em alguns painéis o secret aparece uma vez só.

> Essas duas chaves são o usuário e a senha do seu programa. Não mande por e-mail nem cole
> em chat.

### 2. Conecte o Nubank

1. Entre em [meu.pluggy.ai](https://meu.pluggy.ai) com a mesma conta.
2. **Nova conexão**, escolha **Nubank** e siga a autorização. Em algum momento você confirma
   **dentro do aplicativo do Nubank**, no celular.
3. Espere a bolinha verde (de 15 a 30 segundos).
4. Tem conta pessoal e PJ? Repita: viram duas conexões.
5. Abra cada uma em **Ver detalhes** e copie a **URL inteira** da barra do navegador:

   ```
   https://meu.pluggy.ai/connections/a1b2c3d4-0000-1111-2222-333344445555
   ```

   Pode colar assim mesmo. O instalador extrai o código sozinho.

### 3. Rode o instalador

```bash
git clone https://github.com/tedfernandes/nubank-mcp.git
cd nubank-mcp
npm install
npm run configurar
```

> Sem `git`? Baixe o ZIP no botão verde **Code**, descompacte e abra o terminal na pasta.

Ele cuida do resto: entra na Cloudflare (abrindo o navegador), cria o armazenamento e grava
os ids na configuração, pergunta as chaves do passo 1 e as URLs do passo 2 (o secret não
aparece na tela), **sorteia a sua frase de acesso**, guarda tudo como segredo, publica e
confere se o servidor subiu de pé. Rodar de novo não duplica nada.

No fim ele imprime o endereço do seu servidor e a frase.

### 4. Ligue no claude.ai

O instalador termina copiando o endereço para a área de transferência e se oferecendo para
abrir a página certa. Lá:

1. **Adicionar conector personalizado**.
2. Cole o endereço (já está copiado) e salve. O login é detectado sozinho.
3. **Vincular**. Confira que o endereço de retorno é `claude.ai/api/mcp/auth_callback`.
   Se for outro, pare.
4. Cole a frase que o instalador sorteou.

Pronto. Pergunte na conversa: *"qual meu saldo agora?"*

<details>
<summary><strong>Prefere fazer na mão, sem o instalador?</strong></summary>

É exatamente o que ele automatiza, depois dos passos 1 e 2 acima:

```bash
npx wrangler login

# cria o armazenamento e mostra os ids
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create OAUTH_KV
# cole os dois ids nos lugares marcados em wrangler.jsonc

# gere a sua frase de acesso
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# cada comando pergunta o valor; nada aparece na tela enquanto você digita
npx wrangler secret put PROVEDOR_CLIENT_ID
npx wrangler secret put PROVEDOR_CLIENT_SECRET
npx wrangler secret put CONEXAO_PF
npx wrangler secret put CONEXAO_PJ      # pule se não tiver
npx wrangler secret put TOKEN_DE_ACESSO

npm run verificar   # typecheck e build, sem publicar
npm run deploy
```

O binding do segundo KV precisa se chamar exatamente `OAUTH_KV`: com outro nome, toda
tentativa de login morre em erro 1101 sem explicar o motivo.

Confira com `https://seu-servidor/health`, que responde se está protegido e com login
ligado, sem mostrar nada da conta.

</details>

## Dia a dia

**O dado é de até 24 horas atrás.** Quando precisar do número exato antes de decidir algo,
abra a conexão em [meu.pluggy.ai](https://meu.pluggy.ai), clique em **Atualizar** (de 15 a 30
segundos) e pergunte de novo. Para não esperar o cache vencer, peça assim:

> "qual meu saldo agora, sem cache?"

**Conferência que fecha a conta do cartão:** no aplicativo do banco, limite total menos
limite disponível dá a fatura corrente. É o número do minuto, e serve de referência quando a
coleta estiver atrasada.

**Avisar o servidor quando houver dado novo** (opcional, deixa a atualização instantânea):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put WEBHOOK_SEGREDO
```

No painel do agregador, cadastre um webhook para o evento de item atualizado apontando para
`https://seu-servidor/webhook/sync?k=SUA_FRASE_DO_WEBHOOK`.

## Quando algo dá errado

| O que aparece | O que fazer |
|---|---|
| Erro **1101** ao vincular | o segundo KV não se chama `OAUTH_KV`. Corrija no `wrangler.jsonc` e publique |
| `/health` com `protegido: false` | o `TOKEN_DE_ACESSO` não foi salvo. Rode `npm run configurar` de novo |
| "Frase incorreta" ao autorizar | a frase colada não é a que o instalador sorteou. Rode de novo e use a nova |
| "Nenhum item configurado" | faltou `CONEXAO_PF` ou `CONEXAO_PJ` |
| Saldo diferente do aplicativo | é a defasagem da coleta, veja [Limitações](#limitações) |
| Conexão vermelha no agregador | o consentimento do Open Finance caiu ou expirou (vale 12 meses). Reconecte |

## Limitações

**Isto não é tempo real, e chamar de "ao vivo" seria mentira.**

- A coleta do banco roda cerca de **uma vez por dia** no conector gratuito. Entre uma coleta e
  a seguinte, o número pode estar até 24 horas atrasado.
- A API **recusa** coleta sob demanda nesse conector: `PATCH /items/{id}` responde
  `400 "MeuPluggy item cant be updated"`. Não há contorno pelo código. Pela interface do
  agregador, funciona.
- Por isso toda resposta diz a idade do dado e avisa quando a última coleta passou de seis
  horas. Número velho com cara de novo é pior que número ausente.

**O conector não entrega o ciclo atual do cartão.** A data de fechamento vem vazia e a de
vencimento costuma ficar um ciclo inteiro atrás, mesmo logo após uma coleta bem-sucedida.
Então o ciclo corrente é **derivado** do padrão das faturas já publicadas:

- o fechamento repete o mesmo dia do mês e **não** se move por feriado;
- o vencimento é o fechamento mais um prazo fixo, e **é** empurrado para o próximo dia útil
  em fim de semana ou feriado nacional (incluindo os móveis, com a Páscoa calculada);
- o prazo é o **menor** observado no histórico, nunca o da última fatura: o ajuste de feriado
  só empurra para frente, e uma fatura adiada contaminaria as projeções seguintes.

A resposta sempre diz que a data é derivada, e aponta a fatura que já fechou e o agregador
ainda não publicou, para o mês não sumir da conta. Se o banco mudar a data de corte, as datas
saem erradas até o histórico refletir o padrão novo.

**Convenção de sinal do cartão.** Compra entra positiva e pagamento de fatura entra negativo,
ao contrário da conta corrente. Tratar os dois igual faz compra virar receita e pagamento
virar despesa em duplicidade. O código separa por tipo de conta, e os totais não se misturam.

## Segurança

O modelo de ameaça cabe numa frase: **o pior que alguém consegue, com acesso total a este
servidor, é ler.**

- **Somente leitura no transporte, não na disciplina de quem escreve.** O cliente HTTP recusa
  qualquer método diferente de `GET`, com uma exceção explícita para o `POST /auth` do
  agregador, e confere host e esquema do destino. Checar só o caminho deixaria passar um
  `POST https://evil.com/auth`.
- **Nenhuma ferramenta de escrita.** Não existe, e não vai existir, tool que transfira, pague
  ou altere qualquer coisa.
- **Texto de terceiro é dado, nunca instrução.** A descrição de uma transação é escrita por
  **outra pessoa**: quem mandou o PIX, o comerciante. Esse texto entra no contexto de um
  modelo com acesso a outras ferramentas, então antes de sair ele perde caracteres de controle
  e quebras de linha, tem CPF e CNPJ redigidos e é truncado. Isso **reduz e não elimina** o
  risco: não existe filtro confiável de instrução em linguagem natural. A contenção real é o
  servidor não ter escrita e a sessão que o consome ter permissão apertada.
- **Documento e número de conta saem mascarados**, mesmo sendo seus.
- **OAuth endurecido:** PKCE `plain` recusado (só S256), fluxo implícito desligado, registro
  dinâmico com TTL de 30 dias, token de acesso de 1 hora. A tela de consentimento não pede
  credencial: mostra quem está pedindo e o endereço de retorno, e pede a frase que só você
  sabe. Comparação em tempo constante, para não distinguir segredo por latência.
- **Segredo nunca em arquivo versionado.** Tudo por `wrangler secret put`, e nenhuma mensagem
  de erro ecoa segredo.
- **O webhook não devolve dado da conta:** só apaga cache e anota a hora.

Achou uma falha? Use **Security → Report a vulnerability** aqui no repositório, não uma issue
pública. Detalhes em [SECURITY.md](SECURITY.md).

## Custo

Zero, nos planos gratuitos, para uso pessoal:

| | Plano gratuito | O que este projeto usa |
|---|---|---|
| Cloudflare Workers | 100 mil requisições por dia | algumas dezenas por dia |
| Cloudflare KV | 1.000 escritas e 100 mil leituras por dia | uma escrita por consulta nova |
| Conector pessoal do agregador | gratuito para a própria conta | uma coleta por dia |

## Perguntas frequentes

**Funciona com outro banco?** O agregador cobre vários bancos do Open Finance, e o código não
tem nada específico do Nubank além da observação sobre a data de vencimento. Os rótulos das
conexões são `pf` e `pj`, então hoje cabem duas contas.

**Dá para usar no Claude Desktop ou no Claude Code?** Sim. É um MCP remoto comum: aponte para
`https://seu-servidor/mcp` com o cabeçalho `Authorization: Bearer <sua frase>`.

**Onde meus dados ficam guardados?** Em lugar nenhum, de forma durável. O Worker não tem
banco. O KV guarda a última resposta por pouco tempo, só para não consultar o agregador a cada
pergunta, e você pode apagar quando quiser.

**O Claude vê a senha do meu banco?** Não. Você nunca digita a senha do banco aqui: a
autorização acontece no Open Finance, dentro do aplicativo do Nubank, e o que este servidor
recebe é acesso de leitura que você pode revogar.

**Como desinstalo tudo?**

```bash
npx wrangler delete                                   # apaga o servidor
npx wrangler kv namespace delete --binding CACHE      # apaga o cache
npx wrangler kv namespace delete --binding OAUTH_KV
```

Depois, remova o conector no claude.ai e a conexão em meu.pluggy.ai. Para cortar na raiz,
revogue o consentimento do Open Finance no aplicativo do Nubank.

## Desenvolvimento

```bash
cp .dev.vars.example .dev.vars   # preencha; fica fora do git
npm run dev
npm run verificar                # typecheck + build
```

| Arquivo | Papel |
|---|---|
| `src/index.ts` | roteamento, registro das sete ferramentas e o acesso por Bearer |
| `src/provedor.ts` | cliente HTTP do agregador: guarda de somente leitura e higienização de texto de terceiro |
| `src/financeiro.ts` | a lógica: cache, ciclo derivado, conciliação de fatura, recorrentes |
| `src/oauth.ts` | provider de OAuth e tela de consentimento |
| `configurar.mjs` | o instalador de um comando |

Issue e pull request são bem-vindos. Duas regras não mudam, porque são a razão de este projeto
poder rodar com acesso à sua conta:

1. **Nenhuma ferramenta de escrita**, em nenhuma hipótese.
2. **Texto que vem de fora é dado**, nunca instrução, e passa pela higienização antes de
   chegar ao modelo.

Histórico de versões em [CHANGELOG.md](CHANGELOG.md).

## Licença

[MIT](LICENSE). Fornecido como está. Ele lê dados financeiros: revise o código antes de
publicar com as suas credenciais, e guarde os segredos como segredos.
