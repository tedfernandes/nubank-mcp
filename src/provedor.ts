/**
 * Cliente do agregador de Open Finance, somente leitura.
 *
 * Porta para TypeScript as invariantes que a revisao de seguranca impos no
 * `nubank-mcp` em Python, e que existem por motivo medido:
 *
 *  - So GET, exceto o POST /auth. A guarda esta no transporte, nao na
 *    disciplina de quem escreve: `pedir()` recusa qualquer outra combinacao.
 *  - Host e esquema conferidos. Checar so o caminho deixava
 *    `POST https://evil.com/auth` passar, porque o path era /auth.
 *  - Segredo nunca em log nem em mensagem de erro.
 *  - Descricao de transacao e texto que OUTRA pessoa escreveu (remetente de
 *    PIX, comerciante). Entra no contexto do modelo como dado, nunca como
 *    instrucao: `textoDeTerceiro()` tira controle e quebra de linha, redige
 *    CPF/CNPJ e corta em 140.
 */

const API = "https://api.pluggy.ai";
const HOST = "api.pluggy.ai";
const MAX_DESCRICAO = 140;

const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/g;
const DOC = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;

export function textoDeTerceiro(v: string | null | undefined): string {
  return (v ?? "")
    .replace(CONTROLE, " ")
    .replace(DOC, "[documento removido]")
    .split(/\s+/)
    .join(" ")
    .trim()
    .slice(0, MAX_DESCRICAO);
}

/** Mostra so o fim: identifica a conta sem despejar o numero inteiro no chat. */
export function mascarar(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.length <= 4 ? `••${s}` : `••••${s.slice(-4)}`;
}

export interface DadosBancarios {
  numeroTransferencia: string | null;
  saldoFechamento: number | null;
  investidoAutomatico: number | null;
  limiteChequeEspecial: number | null;
  chequeEspecialUsado: number | null;
}

export interface DadosCredito {
  nivel: string | null;
  bandeira: string | null;
  fechamento: string | null;
  vencimento: string | null;
  limiteTotal: number | null;
  limiteDisponivel: number | null;
  pagamentoMinimo: number | null;
  limiteFlexivel: boolean | null;
  titularidade: string | null;
  status: string | null;
}

export interface Conta {
  id: string;
  conta: "pj" | "pf";
  tipo: string;
  subtipo: string | null;
  nome: string;
  nomeMarketing: string | null;
  numero: string | null;
  titular: string | null;
  documentoTitular: string | null;
  moeda: string | null;
  saldo: number;
  atualizadoEm: string | null;
  banco: DadosBancarios | null;
  credito: DadosCredito | null;
}

export interface Transacao {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  categoria: string | null;
  tipo: string | null;
  status: string | null;
  saldoApos: number | null;
  moeda: string | null;
  parcela: string | null;
  comerciante: string | null;
  contraparte: string | null;
  metodo: string | null;
  faturaId: string | null;
}

export interface Fatura {
  id: string | null;
  vencimento: string;
  fechamento: string | null;
  total: number | null;
  minimo: number | null;
  parcelavel: boolean | null;
  encargos: Array<{ tipo: string; valor: number | null }>;
}

export interface Investimento {
  id: string;
  nome: string;
  tipo: string | null;
  subtipo: string | null;
  emissor: string | null;
  saldo: number | null;
  aplicado: number | null;
  quantidade: number | null;
  vencimento: string | null;
  taxa: string | null;
  status: string | null;
  atualizadoEm: string | null;
}

export class ProvedorError extends Error {}

export class Provedor {
  #apiKey: string | null = null;
  #expira = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  /** Nunca imprime o segredo, nem sob `${cliente}` ou console.log. */
  toString(): string {
    return `Provedor(clientId=${this.clientId.slice(0, 8)}…)`;
  }

  async #pedir(caminho: string, metodo: "GET" | "POST" = "GET", corpo?: unknown): Promise<any> {
    const url = new URL(caminho, API);
    if (url.protocol !== "https:" || url.host !== HOST) {
      throw new ProvedorError(`bloqueado: destino ${url.protocol}//${url.host} fora do provedor`);
    }
    if (metodo !== "GET" && url.pathname !== "/auth") {
      throw new ProvedorError(`bloqueado: ${metodo} ${url.pathname}: cliente somente leitura`);
    }
    const headers: Record<string, string> = {};
    if (corpo) headers["Content-Type"] = "application/json";
    if (url.pathname !== "/auth") headers["X-API-KEY"] = await this.#chave();

    const r = await fetch(url.toString(), {
      method: metodo,
      headers,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (!r.ok) {
      // Sem corpo da resposta e sem query string: nenhum dos dois entra em log.
      throw new ProvedorError(`HTTP ${r.status} em ${metodo} ${url.pathname}`);
    }
    return r.json();
  }

  async #chave(): Promise<string> {
    if (this.#apiKey && Date.now() < this.#expira) return this.#apiKey;
    const d = await this.#pedir("/auth", "POST", {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    });
    const chave: unknown = d?.apiKey;
    if (typeof chave !== "string" || !chave) {
      throw new ProvedorError("autenticacao nao devolveu apiKey");
    }
    this.#apiKey = chave;
    this.#expira = Date.now() + 110 * 60 * 1000; // a chave vale ~2h
    return chave;
  }

  async contas(itemId: string, rotulo: "pj" | "pf"): Promise<Conta[]> {
    const d = await this.#pedir(`/accounts?itemId=${encodeURIComponent(itemId)}`);
    return (d.results ?? []).map((a: any) => {
      const b = a.bankData ?? null;
      const c = a.creditData ?? null;
      return {
        id: a.id,
        conta: rotulo,
        tipo: a.type,
        subtipo: a.subtype ?? null,
        // nome tambem vem da API: trata como texto de terceiro
        nome: textoDeTerceiro(a.name),
        nomeMarketing: a.marketingName ? textoDeTerceiro(a.marketingName) : null,
        numero: mascarar(a.number),
        titular: a.owner ? textoDeTerceiro(a.owner) : null,
        // documento do titular nunca sai inteiro, nem sendo do dono da conta
        documentoTitular: mascarar(a.taxNumber),
        moeda: a.currencyCode ?? null,
        saldo: a.balance ?? 0,
        atualizadoEm: a.updatedAt ?? null,
        banco: b
          ? {
              numeroTransferencia: mascarar(b.transferNumber),
              saldoFechamento: b.closingBalance ?? null,
              investidoAutomatico: b.automaticallyInvestedBalance ?? null,
              limiteChequeEspecial: b.overdraftContractedLimit ?? null,
              chequeEspecialUsado: b.overdraftUsedLimit ?? null,
            }
          : null,
        credito: c
          ? {
              nivel: c.level ?? null,
              bandeira: c.brand ?? null,
              fechamento: c.balanceCloseDate ? String(c.balanceCloseDate).slice(0, 10) : null,
              vencimento: c.balanceDueDate ? String(c.balanceDueDate).slice(0, 10) : null,
              limiteTotal: c.creditLimit ?? null,
              limiteDisponivel: c.availableCreditLimit ?? null,
              pagamentoMinimo: c.minimumPayment ?? null,
              limiteFlexivel: c.isLimitFlexible ?? null,
              titularidade: c.holderType ?? null,
              status: c.status ?? null,
            }
          : null,
      };
    });
  }

  async transacoes(accountId: string, de: string, ate: string): Promise<Transacao[]> {
    const out: Transacao[] = [];
    for (let pagina = 1; pagina <= 20; pagina++) {
      const d = await this.#pedir(
        `/transactions?accountId=${encodeURIComponent(accountId)}` +
          `&from=${de}&to=${ate}&pageSize=500&page=${pagina}`,
      );
      for (const t of d.results ?? []) {
        const cc = t.creditCardMetadata ?? null;
        const pg = t.paymentData ?? null;
        // nome de quem pagou ou recebeu: texto que OUTRA pessoa escreveu
        const contra =
          pg?.receiver?.name ?? pg?.payer?.name ?? t.merchant?.name ?? null;
        out.push({
          id: t.id ?? "",
          data: String(t.date ?? "").slice(0, 10),
          descricao: textoDeTerceiro(t.description),
          valor: t.amount ?? 0,
          categoria: t.category ?? null,
          tipo: t.type ?? null,
          status: t.status ?? null,
          saldoApos: t.balance ?? null,
          moeda: t.currencyCode ?? null,
          parcela:
            cc?.installmentNumber && cc?.totalInstallments
              ? `${cc.installmentNumber}/${cc.totalInstallments}`
              : null,
          comerciante: t.merchant?.name ? textoDeTerceiro(t.merchant.name) : null,
          contraparte: contra ? textoDeTerceiro(contra) : null,
          metodo: pg?.paymentMethod ?? null,
          faturaId: cc?.billId ?? null,
        });
      }
      if (pagina >= (d.totalPages ?? 1)) break;
    }
    return out;
  }

  async faturas(accountId: string): Promise<Fatura[]> {
    const d = await this.#pedir(`/bills?accountId=${encodeURIComponent(accountId)}`);
    return (d.results ?? [])
      .map((b: any) => ({
        id: b.id ?? null,
        vencimento: String(b.dueDate ?? "").slice(0, 10),
        fechamento: b.billClosingDate ? String(b.billClosingDate).slice(0, 10) : null,
        total: b.totalAmount ?? null,
        minimo: b.minimumPaymentAmount ?? null,
        parcelavel: b.allowsInstallments ?? null,
        encargos: (b.financeCharges ?? []).map((e: any) => ({
          tipo: textoDeTerceiro(e.type ?? e.additionalInfo ?? "encargo"),
          valor: e.amount ?? null,
        })),
      }))
      .filter((f: Fatura) => f.vencimento)
      .sort((a: Fatura, b: Fatura) => b.vencimento.localeCompare(a.vencimento));
  }

  /**
   * Nem toda conexao expoe investimentos: o produto INVESTMENTS precisa estar
   * no item. Sem ele a API responde 403 ou 404, e quem chama trata como vazio.
   */
  async investimentos(itemId: string): Promise<Investimento[]> {
    const d = await this.#pedir(`/investments?itemId=${encodeURIComponent(itemId)}`);
    return (d.results ?? []).map((i: any) => ({
      id: i.id ?? "",
      nome: textoDeTerceiro(i.name),
      tipo: i.type ?? null,
      subtipo: i.subtype ?? null,
      emissor: i.issuer ? textoDeTerceiro(i.issuer) : null,
      saldo: i.balance ?? null,
      aplicado: i.amount ?? null,
      quantidade: i.quantity ?? null,
      vencimento: i.dueDate ? String(i.dueDate).slice(0, 10) : null,
      taxa:
        i.annualRate != null
          ? `${i.annualRate}% a.a.`
          : i.rate != null
            ? `${i.rate}${i.rateType ? " " + textoDeTerceiro(i.rateType) : ""}`
            : null,
      status: i.status ?? null,
      atualizadoEm: i.updatedAt ?? null,
    }));
  }
}
