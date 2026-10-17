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
([meu.pluggy.ai](https://meu.pluggy.ai)), que expõe a sua própria conta via Open Finance sem
custo. O código não depende de nada específico dele além do endereço da API: trocar de
agregador é reescrever um arquivo, `src/provedor.ts`.

Este projeto não tem vínculo com o Nubank nem com a Pluggy.

---

# Instalação

São três telas no navegador e **um comando**. Cerca de 15 minutos na primeira vez, e nada
aqui pede cartão de crédito.

## Antes de começar

1. **Sua conta do Nubank**, com o aplicativo no celular (vai ser pedido para autorizar).
2. **Node.js instalado.** Se não tiver, baixe a versão LTS em [nodejs.org](https://nodejs.org)
   e instale clicando em avançar. Para conferir, abra o terminal (no Windows, procure por
   "PowerShell"; no Mac, "Terminal") e digite `node --version`. Se aparecer um número, está
   pronto.
3. **Uma conta na Cloudflare**, gratuita, em
   [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). O instalador abre o
   navegador sozinho na hora de autorizar.

## 1. Pegue as duas chaves do agregador

O Nubank não entrega os seus dados direto para um programa: quem faz essa ponte, com a sua
autorização, é um agregador de Open Finance. Aqui é a Pluggy, gratuita para uso pessoal.

1. Crie sua conta em [dashboard.pluggy.ai](https://dashboard.pluggy.ai).
2. No painel, crie uma **aplicação** (Application). O nome pode ser `nubank-mcp`.
3. Copie o **Client ID** e o **Client Secret** para um bloco de notas. Em alguns painéis o
   *secret* aparece uma vez só.

> Essas duas chaves são o usuário e a senha do seu programa. Não mande por e-mail nem cole
> em chat.

## 2. Conecte o Nubank

1. Acesse [meu.pluggy.ai](https://meu.pluggy.ai) com a mesma conta.
2. **Nova conexão**, escolha **Nubank** e siga a autorização do Open Finance. Em algum
   momento você confirma **dentro do aplicativo do Nubank**, no celular.
3. Espere a bolinha verde. A primeira coleta leva de 15 a 30 segundos.
4. Tem conta pessoal e PJ? Repita. Elas ficam como duas conexões.
5. Abra cada conexão em **Ver detalhes** e copie a **URL inteira** da barra do navegador.
   Ela é assim:

   ```
   https://meu.pluggy.ai/connections/a1b2c3d4-0000-1111-2222-333344445555
   ```

   Não precisa separar o código: o instalador extrai sozinho.

## 3. Rode o instalador

```bash
git clone https://github.com/tedfernandes/nubank-mcp.git
cd nubank-mcp
npm install
npm run configurar
```

> Sem `git`? Baixe o ZIP pelo botão verde **Code** aqui em cima, descompacte e abra o
> terminal dentro da pasta.

O instalador faz o resto sozinho:

- entra na sua Cloudflare (abre o navegador para você autorizar);
- cria os dois espaços de armazenamento e escreve os ids na configuração;
- pergunta as chaves do passo 1 e as URLs do passo 2 (o *secret* não aparece na tela);
- **sorteia a sua frase de acesso**, para você não ter que inventar uma;
- guarda tudo como segredo na Cloudflare, sem deixar nada em arquivo;
- publica o servidor e confere se subiu de pé.

No fim ele imprime o endereço do seu servidor e a frase. Rodar de novo não duplica nada.

## 4. Ligue no claude.ai

O instalador termina mostrando exatamente isto, já com o seu endereço:

1. [claude.ai](https://claude.ai) → **Configurações** → **Conectores** →
   **Adicionar conector personalizado**.
2. Endereço: `https://nubank-mcp.SEU-USUARIO.workers.dev/mcp`
3. Clique em **Vincular**. Confira que o endereço de retorno é
   `claude.ai/api/mcp/auth_callback`. Se for outro, pare.
4. Cole a frase que o instalador mostrou.

Pronto. Na conversa, pergunte:

> "Qual meu saldo agora?"

## Opcional: avisar o servidor quando houver dado novo

Sem isso funciona igual, só com um pouco mais de atraso.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put WEBHOOK_SEGREDO
```

No painel do agregador, cadastre um webhook para o evento de item atualizado apontando para
`https://SEU-SERVIDOR/webhook/sync?k=SUA_FRASE_DO_WEBHOOK`. Assim, quando o agregador
coletar, o servidor joga o cache fora na hora.

<details>
<summary><strong>Prefere fazer na mão?</strong> O passo a passo completo, comando por comando</summary>

O instalador só automatiza o que está aqui. Se quiser entender cada etapa, ou se ele falhar
no meio, este é o caminho manual.

### Passo 1: criar a conta no agregador e pegar as duas chaves

O Nubank não entrega os seus dados direto para um programa: quem faz essa ponte, com a sua
autorização, é um agregador de Open Finance. Aqui usamos a Pluggy, que é gratuita para uso
pessoal.

1. Acesse [dashboard.pluggy.ai](https://dashboard.pluggy.ai) e crie sua conta.
2. Já dentro do painel, procure a seção de **aplicações** (Applications) e crie uma.
   O nome pode ser qualquer um, por exemplo `nubank-mcp`.
3. A aplicação mostra duas chaves: **Client ID** e **Client Secret**.
4. Copie as duas para um bloco de notas. O *secret* aparece uma vez só em alguns painéis,
   então guarde agora.

> Essas duas chaves são como usuário e senha do seu programa. Não mande por e-mail, não cole
> em chat, não suba para o GitHub.

### Passo 2: conectar o Nubank

1. Acesse [meu.pluggy.ai](https://meu.pluggy.ai) e entre com a mesma conta.
2. Clique em **Nova conexão** e escolha o **Nubank**.
3. Siga a autorização do Open Finance. Em algum momento o site vai mandar você confirmar
   **dentro do aplicativo do Nubank**, no celular. Confirme por lá e volte.
4. Espere a conexão ficar com a bolinha verde. A primeira coleta leva de 15 a 30 segundos.
5. Se você tem conta pessoal e conta PJ, repita para a segunda. Elas aparecem como duas
   conexões separadas.

### Passo 3: copiar o id de cada conexão

1. Ainda em [meu.pluggy.ai](https://meu.pluggy.ai), abra a conexão e clique em **Ver detalhes**.
2. Olhe o endereço na barra do navegador. Ele termina com um código comprido, assim:

   ```
   https://meu.pluggy.ai/connections/a1b2c3d4-0000-1111-2222-333344445555
                                     └──────────── isto aqui ────────────┘
   ```

3. Copie esse código. Ele é o id da conexão.
4. Faça o mesmo com a outra conexão, se tiver. Anote qual é a pessoal e qual é a PJ.

> Esse id precisa ser copiado à mão de propósito. Na API, a listagem de conexões responde
> 401, então o programa não tem como descobrir sozinho. Tentar adivinhar foi o que quebrou a
> primeira versão deste servidor.

### Passo 4: entrar na Cloudflare pelo terminal

Na pasta do projeto, rode:

```bash
npx wrangler login
```

Abre o navegador pedindo autorização. Clique em **Allow**. Quando o terminal disser que
ficou logado, siga.

### Passo 5: criar as duas gavetas de dados (KV)

O servidor precisa de dois espacinhos de armazenamento na Cloudflare. Rode os dois comandos:

```bash
npx wrangler kv namespace create CACHE
npx wrangler kv namespace create OAUTH_KV
```

Cada um responde com um trecho parecido com este:

```
{ binding = "CACHE", id = "0123456789abcdef0123456789abcdef" }
```

Abra o arquivo `wrangler.jsonc` num editor de texto e substitua os dois lugares marcados
pelos ids que apareceram:

```jsonc
"kv_namespaces": [
  { "binding": "CACHE", "id": "COLOQUE_O_ID_DO_SEU_CACHE" },
  { "binding": "OAUTH_KV", "id": "COLOQUE_O_ID_DO_SEU_OAUTH_KV" }
]
```

> O segundo precisa se chamar exatamente `OAUTH_KV`. Com outro nome, toda tentativa de
> login morre com erro 1101, e a mensagem não explica o motivo.

### Passo 6: criar a sua frase de acesso

É a senha que vai proteger o servidor. Gere uma aleatória:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Copie o resultado para o bloco de notas. Você vai usar essa frase duas vezes: agora e na
hora de ligar no claude.ai.

### Passo 7: guardar os segredos na Cloudflare

Rode um comando por vez. Cada um pergunta o valor, você cola e aperta Enter. **O valor não
aparece na tela enquanto você digita, isso é normal.**

```bash
npx wrangler secret put PROVEDOR_CLIENT_ID       # Client ID do passo 1
npx wrangler secret put PROVEDOR_CLIENT_SECRET   # Client Secret do passo 1
npx wrangler secret put CONEXAO_PF               # id da conexão pessoal, passo 3
npx wrangler secret put CONEXAO_PJ               # id da conexão PJ (pule se não tiver)
npx wrangler secret put TOKEN_DE_ACESSO          # a frase do passo 6
```

Nenhum desses valores fica em arquivo. Eles vivem só na Cloudflare, e nem você consegue
lê-los de volta depois.

### Passo 8: publicar

```bash
npm run verificar   # confere se está tudo certo, sem publicar
npm run deploy
```

No fim aparece o endereço do seu servidor, parecido com:

```
https://nubank-mcp.SEU-USUARIO.workers.dev
```

Copie. Para testar, abra no navegador o mesmo endereço com `/health` no fim:

```
https://nubank-mcp.SEU-USUARIO.workers.dev/health
```

Deve responder `{"ok":true,"protegido":true,"oauth":true}`. Se `protegido` vier `false`, o
segredo `TOKEN_DE_ACESSO` não foi salvo: refaça o passo 7.

> Essa página **não mostra dado nenhum da sua conta**, só diz se o servidor está configurado.

### Passo 9: ligar no claude.ai

1. Acesse [claude.ai](https://claude.ai) e vá em **Configurações → Conectores**.
2. Clique em **Adicionar conector personalizado**.
3. No endereço, cole o do passo 8 com `/mcp` no fim:

   ```
   https://nubank-mcp.SEU-USUARIO.workers.dev/mcp
   ```

4. Salve. Vai aparecer que o login foi detectado. Clique em **Vincular**.
5. Abre uma página sua, com o título "Autorizar acesso a sua conta". **Confira que o
   endereço de retorno é `claude.ai/api/mcp/auth_callback`.** Se for outro, pare.
6. Cole a frase do passo 6 e clique em autorizar.

Pronto. Volte para a conversa e pergunte:

> "Qual meu saldo agora?"

### Passo 10 (opcional): avisar o servidor quando houver dado novo

Sem isso funciona igual, só com um pouco mais de atraso.

```bash
npx wrangler secret put WEBHOOK_SEGREDO   # outra frase aleatória, gerada como no passo 6
```

No painel do agregador, cadastre um webhook para o evento de item atualizado, apontando para:

```
https://nubank-mcp.SEU-USUARIO.workers.dev/webhook/sync?k=SUA_FRASE_DO_WEBHOOK
```

Assim, quando o agregador coletar, o servidor joga o cache fora na hora.

</details>

---

## Quando algo dá errado

| O que aparece | O que é | O que fazer |
|---|---|---|
| Erro **1101** ao vincular | o segundo KV está com nome diferente de `OAUTH_KV` | refaça o passo 5 e publique de novo |
| `/health` com `protegido: false` | a frase de acesso não foi salva | refaça o passo 7 |
| "Frase incorreta" na tela de autorizar | a frase colada não é a mesma do `TOKEN_DE_ACESSO` | gere outra e refaça os passos 6, 7 e 9 |
| "Nenhum item configurado" | faltou `CONEXAO_PF` ou `CONEXAO_PJ` | refaça os passos 3 e 7 |
| Saldo diferente do aplicativo | o dado é da última coleta, não de agora | veja "Limitações" abaixo |
| Conexão vermelha no agregador | o Open Finance expirou (vale 12 meses) ou caiu | reconecte no passo 2 |

## Limitações, e elas importam

**Isto não é tempo real, e chamar de "ao vivo" seria mentira.**

- A coleta do banco roda cerca de **uma vez por dia** no conector gratuito. Entre uma coleta
  e a seguinte, o número pode estar até 24 horas atrasado.
- A API **recusa** coleta sob demanda nesse conector: `PATCH /items/{id}` responde
  `400 "MeuPluggy item cant be updated"`. Não há contorno pelo código.
- O que dá para fazer é atualizar **pela interface** do agregador (abrir a conexão em
  meu.pluggy.ai e clicar em **Atualizar**), onde esse limite não existe, e perguntar de
  novo com `sem_cache`.
- Por isso toda resposta diz a **idade do dado** ("há 20 h") e avisa quando a sincronização
  passou de seis horas. Número velho com cara de novo é pior que número ausente.

**O conector não entrega o ciclo atual do cartão.** A data de fechamento vem vazia e a de
vencimento costuma ficar um ciclo inteiro atrás, mesmo logo depois de uma coleta
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

## Desenvolvimento

```bash
cp .dev.vars.example .dev.vars   # preencha, fica fora do git
npm run dev
npm run verificar
```

| Arquivo | Papel |
|---|---|
| `src/index.ts` | roteamento, registro das sete ferramentas e o acesso direto por Bearer |
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
