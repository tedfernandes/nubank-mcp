# Política de segurança

## Reportar uma falha

Não abra issue pública para vulnerabilidade. Use **Security → Report a vulnerability** no
próprio repositório (GitHub Security Advisories), que fica privado até a correção sair.

Descreva o impacto concreto: o que um atacante consegue ler, e com que acesso de partida.

## O modelo de ameaça

Cabe numa frase: **o pior que alguém consegue, com acesso total a este servidor, é ler.**

### Somente leitura no transporte, não na disciplina de quem escreve

O cliente HTTP (`src/provedor.ts`) recusa qualquer método diferente de `GET`, com uma
exceção explícita para o `POST /auth` do agregador. Host e esquema são conferidos na mesma
guarda, porque checar apenas o caminho deixaria passar um `POST https://evil.com/auth`.

Não existe, e não vai existir, ferramenta que transfira, pague ou altere qualquer coisa.
Pull request que adicione uma será recusado.

### Texto de terceiro é dado, nunca instrução

A descrição de uma transação não é um campo do banco: é texto livre escrito por **outra
pessoa**, o remetente do PIX (até 140 caracteres) ou o comerciante. Esse texto entra no
contexto de um modelo que tem acesso a outras ferramentas, então antes de sair ele:

- perde caracteres de controle e quebras de linha;
- tem CPF e CNPJ redigidos;
- é truncado num limite fixo.

Isso **reduz e não elimina** o risco. Não existe filtro confiável de instrução em linguagem
natural, e quem promete isso está vendendo. A contenção real é o servidor não ter escrita e
a sessão que o consome ter permissão apertada.

### Dado pessoal mascarado

Número de conta, agência e documento do titular saem mascarados, mesmo sendo do dono da
conta: eles identificam a conta sem precisar aparecer inteiros no chat.

### OAuth endurecido

A camada de OAuth foi escrita com os achados de uma auditoria de um servidor MCP remoto
anterior, onde a falha não foi de biblioteca e sim de configuração:

| Trava | Por quê |
|---|---|
| PKCE `plain` recusado, só S256 | `plain` aceita um verificador adivinhável |
| Fluxo implícito desligado | token no fragmento da URL vaza em log e histórico |
| Registro dinâmico com TTL de 30 dias | sem TTL, um POST anônimo em loop enche o armazenamento |
| Token de acesso de 1 hora | reduz a janela de um token vazado |
| Tela de consentimento que não pede credencial | pedir o token na tela é phishing pronto: basta registrar um cliente chamado "Claude" |
| Endereço de retorno sempre visível | o nome do aplicativo é escolhido por quem registra e não prova identidade; o retorno, sim |
| Comparação de frase em tempo constante | evita distinguir o segredo por latência |

### Segredos

Nenhum segredo é versionado, ecoado em mensagem de erro ou registrado em log. Tudo entra por
`wrangler secret put` e vive só na Cloudflare.

### Webhook

O endpoint de aviso de coleta fica fora do OAuth porque quem chama é um servidor, não uma
pessoa. Ele exige um segredo na query, conferido em tempo constante, aceita apenas as
conexões configuradas, não ecoa nada do corpo recebido e **não devolve dado da conta**: só
apaga o cache e anota a hora.

## O que este projeto NÃO garante

- **Imunidade a injeção indireta de prompt.** Veja acima: a higienização reduz, não elimina.
- **Atualidade do dado.** A coleta do agregador é diária. Toda resposta informa a idade.
- **Revisão de terceiros.** O código é curto de propósito, para caber numa leitura. Se você
  vai apontá-lo para a sua conta, leia antes.
