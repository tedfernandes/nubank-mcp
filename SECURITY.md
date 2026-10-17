# Política de segurança

## Reportar uma falha

Não abra issue pública para vulnerabilidade. Use **Security → Report a vulnerability**
no próprio repositório (GitHub Security Advisories), que é privado até a correção sair.

Descreva o impacto concreto: o que um atacante consegue ler, e com que acesso de partida.

## O que este servidor garante

- Nenhuma ferramenta escreve: não há transferência, pagamento ou alteração.
- O cliente HTTP recusa qualquer método diferente de `GET`, exceto o `POST /auth` do
  agregador, e confere host e esquema do destino.
- Nenhum segredo é versionado, ecoado em erro ou registrado em log.
- Documento e número de conta saem mascarados.

## O que ele NÃO garante

- **Imunidade a injeção indireta de prompt.** A descrição de transação é texto escrito por
  terceiro. Ela é higienizada (controle e quebra de linha removidos, documento redigido,
  truncada), e isso reduz o risco sem eliminá-lo. Quem consome este MCP deve manter a
  sessão com permissão apertada.
- **Atualidade do dado.** A coleta é diária. A resposta sempre informa a idade.
