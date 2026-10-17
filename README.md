# nubank-mcp

Servidor MCP remoto que liga a sua conta do **Nubank** ao **claude.ai**, por Open Finance.
Roda num Cloudflare Worker, é **somente leitura** e não guarda dado nenhum da sua conta.

Depois de instalado, você pergunta em linguagem normal, inclusive por voz:

> "Qual meu saldo agora?"
> "O que entrou na fatura do cartão PJ este mês?"
> "Quais são minhas cobranças recorrentes?"

## O que ele responde

| Ferramenta | O que devolve |
|---|---|
| `saldo_agora` | saldo das contas e cartões, número da conta, titular, limite, limite disponível, ciclo, cheque especial e saldo rendendo |
| `extrato` | todo lançamento da conta corrente num período, com categoria, meio de pagamento, contraparte e saldo após cada um |
| `gastos_cartao` | compras do cartão num período, com quebra por categoria e parcelas |
| `fatura_agora` | faturas item a item, limite, encargos e o ciclo em formação |
| `resumo_do_mes` | entradas, saídas, resultado, gasto no cartão e os maiores lançamentos dos dois lados |
| `recorrentes` | assinaturas e mensalidades: mesmo comerciante em dois ou mais meses |
| `investimentos` | CDB, caixinha e fundos: aplicado, saldo, taxa e vencimento |

Listas longas vêm paginadas, e a resposta diz quantas páginas existem. Nada é truncado em silêncio.

## Como funciona

```
claude.ai  ──OAuth──>  Cloudflare Worker  ──GET──>  agregador Open Finance  ──>  Nubank
                              │
                              └── KV: cache curto (sem dado seu depois que expira)
```

O agregador usado é a **[Pluggy](https://pluggy.ai)**, pelo conector pessoal gratuito
([meu.pluggy.ai](https://meu.pluggy.ai)), que expõe a sua própria conta via Open Finance
sem custo. O código não depende de nada específico dele além do endpoint: trocar de
agregador é reescrever um arquivo, `src/provedor.ts`.

Este projeto não tem vínculo com o Nubank nem com a Pluggy.

## Segurança

O modelo de ameaça aqui é simples de enunciar: **o pior que alguém consegue, com acesso
total a este servidor, é ler.**

- **Somente leitura no transporte, não na disciplina.** O cliente HTTP recusa qualquer
  método que não seja `GET`, com uma exceção explícita para o `POST /auth` do agregador.
  Host e esquema são conferidos na mesma guarda: checar só o caminho deixaria passar um
  `POST https://evil.com/auth`.
- **Nenhuma ferramenta de escrita.** Não existe, e não vai existir, tool que transfira,
  pague ou altere qualquer coisa.
- **Texto de terceiro é dado, nunca instrução.** A descrição de uma transação é escrita por
  **outra pessoa**: quem mandou o PIX, o comerciante. Esse texto entra no contexto de um
  modelo com acesso a outras ferramentas, então antes de sair ele perde caracteres de
  controle e quebras de linha, tem CPF e CNPJ redigidos e é truncado. Isso **reduz e não
  elimina** o risco: não existe filtro confiável de instrução em linguagem natural. A
  contenção real é o servidor não ter escrita e a sessão que o consome ter permissão
  apertada.
- **Documento e número de conta saem mascarados**, mesmo sendo seus.
- **OAuth endurecido:** PKCE `plain` recusado (só S256), fluxo implícito desligado, registro
  dinâmico com TTL de 30 dias e token de acesso de 1 hora. A tela de consentimento não pede
  credencial nenhuma: ela mostra quem está pedindo e o endereço de retorno, e pede uma frase
  que só você sabe.
- **Segredo nunca em arquivo versionado.** Tudo entra por `wrangler secret put`, e nenhuma
  mensagem de erro ecoa segredo.
- **O webhook não devolve dado da conta.** Ele só apaga cache e anota a hora.

## Instalação

Você vai precisar de uma conta na Cloudflare (o plano gratuito basta) e de uma conta no
agregador.

### 1. Credenciais do agregador

1. Crie uma aplicação em [dashboard.pluggy.ai](https://dashboard.pluggy.ai) e guarde o
   **Client ID** e o **Client Secret**.
2. Em [meu.pluggy.ai](https://meu.pluggy.ai), conecte a sua conta do Nubank. Repita para a
   conta PJ, se tiver as duas.
3. Abra cada conexão e copie o **id dela**, que aparece na URL. Guarde um como `CONEXAO_PF`
   e outro como `CONEXAO_PJ`.

> O id da conexão precisa ser informado à mão de propósito: na API, `GET /items` responde
> 401, então não existe descoberta automática. Tentar adivinhar foi o que quebrou a primeira
> versão deste servidor.

### 2. Os dois namespaces de KV

```bash
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create OAUTH_KV
```

Copie os dois ids para o `wrangler.jsonc`, nos lugares marcados. O binding do segundo
precisa se chamar exatamente `OAUTH_KV`: o provider de OAuth o procura por nome, e com
outro nome toda requisição morre em erro 1101.

### 3. Os segredos

```bash
npx wrangler secret put PROVEDOR_CLIENT_ID
npx wrangler secret put PROVEDOR_CLIENT_SECRET
npx wrangler secret put CONEXAO_PF
npx wrangler secret put CONEXAO_PJ
npx wrangler secret put TOKEN_DE_ACESSO     # frase longa e aleatória, só sua
npx wrangler secret put WEBHOOK_SEGREDO     # opcional, ver adiante
```

### 4. Publicar

```bash
npm install
npm run verificar    # typecheck + build, sem publicar
npm run deploy
```

Confira com `curl https://<seu-worker>.workers.dev/health`. Ele responde se está protegido
e se o OAuth está ligado, e **não devolve dado nenhum da conta**.

### 5. Ligar no claude.ai

Em **Configurações → Conectores → Adicionar conector personalizado**:

- URL: `https://<seu-worker>.workers.dev/mcp`
- O OAuth é detectado sozinho. Clique em **Vincular**.
- Na tela de autorização, confira que o endereço de retorno é `claude.ai/api/mcp/auth_callback`
  e cole a frase do `TOKEN_DE_ACESSO`.

Para testar sem o claude.ai, use o Bearer direto:

```bash
curl -X POST https://<seu-worker>.workers.dev/mcp \
  -H "Authorization: Bearer $TOKEN_DE_ACESSO" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### 6. Opcional: webhook de coleta

O agregador avisa quando coletou, e o Worker joga o cache fora na hora. Sem isso, o dado
novo pode esperar até o TTL vencer, mesmo já estando disponível.

Registre o webhook apontando para:

```
https://<seu-worker>.workers.dev/webhook/sync?k=<WEBHOOK_SEGREDO>
```

## Limitações, e elas importam

**Isto não é tempo real, e chamar de "ao vivo" seria mentira.**

- A coleta do banco roda cerca de **uma vez por dia** no conector gratuito. Entre uma coleta
  e a seguinte, o número pode estar até 24 horas atrasado.
- A API **recusa** coleta sob demanda nesse conector: `PATCH /items/{id}` responde
  `400 "MeuPluggy item cant be updated"`. Não há contorno pelo código.
- O que dá para fazer é atualizar **pela interface** do agregador, onde não existe esse
  limite, e usar `sem_cache: true` na pergunta seguinte.
- Por isso toda resposta diz a **idade do dado** ("há 20 h") e avisa quando a sincronização
  passou de seis horas. Número velho com cara de novo é pior que número ausente.

**O conector não entrega o ciclo atual do cartão.** `balanceCloseDate` vem nulo e
`balanceDueDate` costuma ficar um ciclo inteiro atrás, mesmo logo depois de uma coleta
bem-sucedida. Então o ciclo corrente é **derivado** do padrão das faturas já publicadas:

- o fechamento repete o mesmo dia do mês e **não** se move por feriado;
- o vencimento é o fechamento mais um prazo fixo, e **é** empurrado para o próximo dia útil
  quando cai em fim de semana ou feriado nacional (incluindo os móveis, com a Páscoa
  calculada);
- o prazo usado é o **menor** observado no histórico, nunca o da última fatura: o ajuste de
  feriado só empurra para frente, e uma fatura adiada contaminaria todas as projeções
  seguintes.

A resposta sempre diz que a data é derivada, e aponta a fatura que já fechou e o agregador
ainda não publicou, para o mês não sumir da conta.

**Convenção de sinal do cartão.** Compra entra positiva e o pagamento da fatura entra
negativo, ao contrário da conta corrente. Tratar os dois igual faz compra virar receita e
pagamento virar despesa em duplicidade. O código separa os dois por tipo de conta, e os
totais não se misturam.

## Desenvolvimento

```bash
cp .dev.vars.example .dev.vars   # preencha, fica fora do git
npm run dev
npm run verificar
```

Arquivos:

| Arquivo | Papel |
|---|---|
| `src/index.ts` | roteamento, registro das sete ferramentas e o Bearer direto |
| `src/provedor.ts` | cliente HTTP do agregador, com a guarda de somente leitura e a higienização de texto de terceiro |
| `src/financeiro.ts` | a lógica toda: cache, ciclo derivado, conciliação de fatura, recorrentes |
| `src/oauth.ts` | provider de OAuth e a tela de consentimento |

## Contribuindo

Issue e pull request são bem-vindos. Duas regras que não mudam, porque são a razão de o
projeto poder rodar com acesso à sua conta:

1. **Nenhuma ferramenta de escrita**, em nenhuma hipótese.
2. **Texto que vem de fora é dado**, nunca instrução, e passa pela higienização antes de
   chegar ao modelo.

## Licença

[MIT](LICENSE).

Este software é fornecido como está. Ele lê dados financeiros: revise o código antes de
publicar com as suas credenciais, e guarde os segredos como segredos.
