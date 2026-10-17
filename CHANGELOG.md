# Changelog

Formato baseado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versionamento em [SemVer](https://semver.org/lang/pt-BR/).

## [1.0.0] - 2026-10-16

Primeira versão pública. O servidor já roda em produção desde setembro de 2026, lendo uma
conta real todos os dias; esta é a extração limpa dele, sem nada do uso privado que o
originou.

### Adicionado

- **Servidor MCP remoto** num Cloudflare Worker, com OAuth, para ligar a conta ao claude.ai
  sem VPS, sem túnel e sem banco de dados.
- **Sete ferramentas de leitura:** `saldo_agora`, `extrato`, `gastos_cartao`, `fatura_agora`,
  `resumo_do_mes`, `recorrentes` e `investimentos`.
- **Ciclo do cartão derivado do histórico**, porque o conector entrega data de fechamento
  vazia e vencimento de um ciclo atrás. O vencimento respeita feriado nacional (inclusive os
  móveis, com a Páscoa calculada) e o prazo nominal sai do menor observado, nunca do da
  última fatura.
- **Idade do dado em toda resposta**, com aviso quando a última coleta passa de seis horas.
- **Paginação explícita** em vez de corte silencioso: a resposta diz quantas páginas existem.
- **Conciliação de fatura** que separa compra de pagamento, respeitando a convenção de sinal
  invertida do cartão, e mostra a fatura que já fechou e o agregador ainda não publicou.
- **Webhook opcional** (`POST /webhook/sync`) que invalida o cache assim que o agregador
  coleta.
- **Rota `/health`** que diz se o servidor está configurado sem devolver nada da conta.
- **Instalador de um comando** (`npm run configurar`): entra na Cloudflare, cria os dois
  namespaces de KV e escreve os ids na configuração, pergunta as credenciais uma única vez
  (o *secret* não aparece na tela), aceita a URL da conexão colada inteira em vez do id
  cru, sorteia a frase de acesso, grava tudo como segredo, publica e confere a saúde do
  servidor. É idempotente: rodar de novo não duplica nada.
- **README com o caminho de quinze minutos** e o passo a passo manual guardado num bloco
  recolhido, para quem quiser entender cada etapa ou destravar o instalador.
- Licença MIT e política de segurança (`SECURITY.md`).

### Segurança

- **Somente leitura no transporte:** o cliente HTTP recusa qualquer método diferente de
  `GET`, exceto o `POST /auth` do agregador, e confere host e esquema do destino. Conferir
  apenas o caminho deixaria passar um `POST` para outro domínio terminado em `/auth`.
- **Nenhuma ferramenta de escrita**, por desenho.
- **Texto de terceiro tratado como dado:** descrição de transação é escrita por quem mandou
  o PIX ou pelo comerciante, então sai sem caracteres de controle, com CPF e CNPJ redigidos
  e truncada. Reduz, e não elimina, injeção indireta de prompt.
- **Documento e número de conta mascarados**, mesmo sendo do titular.
- **OAuth endurecido:** PKCE `plain` recusado, fluxo implícito desligado, registro dinâmico
  com TTL de 30 dias, token de acesso de 1 hora, e tela de consentimento que mostra o
  endereço de retorno e não pede credencial.
- **Comparação de frase em tempo constante**, para não distinguir segredo por latência.
- Nenhum segredo versionado: tudo por `wrangler secret put`.

### Limitações conhecidas

- A coleta do banco roda cerca de uma vez por dia no conector gratuito, e a API recusa
  coleta sob demanda nele. O dado pode estar até 24 horas atrasado, e a resposta sempre diz
  de quando ele é.
- O ciclo derivado assume que o banco não muda a data de corte do cartão. Se mudar, as datas
  saem erradas até o histórico refletir o padrão novo.

[1.0.0]: https://github.com/tedfernandes/nubank-mcp/releases/tag/v1.0.0
