// ---------------------------------------------------------------------------
// Puxar as vendas do Mercado Livre direto do portal — sem passar pelo robô.
//
// Por que existe (21/08/2026), palavras dela: "Os pedidos que estão sendo
// realizados no Mercado Livre continua não subindo automático para o portal.
// (...) Pois, preciso saber os custos do produto para não pagar errado."
//
// A esteira antiga dependia do GitHub Actions (`src/pedidos_main.py`, de 2 em
// 2 horas). Em 20/08 o orçamento do Actions bateu no teto e TODO job passou a
// morrer em 3 segundos — inclusive a leitura de pedidos. A venda existia no
// ML, existia na TrazPraCa, e o painel não sabia o custo. Foi assim que ela
// pagou a Luminária Homem de Ferro achando que tinha lucro.
//
// Esta função tira a leitura de pedidos da dependência do Actions: roda dentro
// do portal (Vercel), na hora em que ela apertar o botão, de graça, e continua
// funcionando mesmo com o Actions bloqueado. O robô continua rodando no
// horário — os dois escrevem na mesma tabela, com a mesma trava de duplicata.
//
// O que esta função NUNCA faz:
//   • não compra e não paga nada — isso é ato dela, como sempre;
//   • não sobrescreve o que a TELA marcou (`fornecedor_status`,
//     `fornecedor_pedido`, `comprado_em`, `comprado_por`, `observacao`).
//     Uma releitura não pode desfazer um "já comprei".
// ---------------------------------------------------------------------------

const API = "https://api.mercadolibre.com";
const TIMEOUT_MS = 15000;

export type ResumoImportacao = {
  lidas: number;
  novas: number;
  atualizadas: number;
  erros: number;
  semCusto: string[];   // pedidos em que não achamos o custo da ficha
  avisos: string[];
};

// --- HTTP com prazo, para o botão nunca ficar girando para sempre ----------
async function buscar(url: string, token: string): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Token do ML.
//
// O refresh token do ML ROTACIONA: cada uso pode devolver um novo, e o antigo
// morre. Por isso ele mora na tabela `vendas_ml_auth` (migration 101) e não
// num secret estático — em 15/08 um secret envelhecido derrubou a rodada
// inteira com 400. Aqui a regra é a mesma do robô: leu, renovou, GRAVOU DE
// VOLTA na hora. Se a gravação falhar, o próximo uso falha — então ela é
// tratada como parte da operação, não como detalhe.
// ---------------------------------------------------------------------------
export async function tokenML(db: any): Promise<{ token: string; userId: number }> {
  const appId = import.meta.env.ML_APP_ID;
  const secret = import.meta.env.ML_CLIENT_SECRET;
  if (!appId || !secret) {
    throw new Error(
      "Faltam ML_APP_ID e ML_CLIENT_SECRET nas variáveis de ambiente da Vercel.",
    );
  }

  const { data: cofre, error } = await db
    .from("vendas_ml_auth")
    .select("refresh_token, access_token, user_id, expira_em")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw new Error(`Não consegui ler o cofre do token: ${error.message}`);
  if (!cofre?.refresh_token) {
    throw new Error(
      "O cofre vendas_ml_auth está vazio — o robô precisa gravar o primeiro refresh token.",
    );
  }

  // Access token ainda válido (com 5 min de folga): não gasta refresh à toa.
  // Cada refresh queima o anterior; usar sem precisar é criar chance de erro.
  const folga = 5 * 60 * 1000;
  if (cofre.access_token && cofre.expira_em && cofre.user_id) {
    if (new Date(cofre.expira_em).getTime() - folga > Date.now()) {
      return { token: cofre.access_token, userId: Number(cofre.user_id) };
    }
  }

  const corpo = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: String(appId),
    client_secret: String(secret),
    refresh_token: String(cofre.refresh_token),
  });
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: corpo.toString(),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(
      `O Mercado Livre recusou a renovação do token (${r.status}): ${j.message || j.error || "sem detalhe"}. ` +
        "Pode ser autorização revogada — refazer a autorização do app TrazPraCa Automacao no DevCenter.",
    );
  }

  const userId = Number(j.user_id || cofre.user_id || 0);
  const expira = new Date(Date.now() + Number(j.expires_in || 21600) * 1000).toISOString();
  const { error: erroGravar } = await db.from("vendas_ml_auth").upsert(
    {
      id: "default",
      refresh_token: j.refresh_token || cofre.refresh_token,
      access_token: j.access_token,
      user_id: userId || null,
      expira_em: expira,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  // Falhar aqui em silêncio é o pior caso: o refresh novo se perde e o
  // ANTIGO já morreu — a próxima rodada cai com 400 sem explicação.
  if (erroGravar) {
    throw new Error(
      `Renovei o token mas não consegui guardar o refresh novo (${erroGravar.message}). ` +
        "Não siga adiante: o refresh antigo já foi invalidado pelo ML.",
    );
  }

  if (!userId) throw new Error("O ML não devolveu o user_id da conta.");
  return { token: j.access_token, userId };
}

// --- Utilitários pequenos ---------------------------------------------------
const num = (v: any): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: any): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/** SKU do anúncio: o ML guarda em três lugares diferentes conforme a época. */
function skuDoItem(item: any): string | null {
  const direto = txt(item?.seller_sku) || txt(item?.seller_custom_field);
  if (direto) return direto;
  const attrs: any[] = item?.attributes || [];
  const a = attrs.find((x) => x?.id === "SELLER_SKU");
  return txt(a?.value_name);
}

// ---------------------------------------------------------------------------
// A importação.
//
// `dias` limita a janela — o botão usa 7 dias, que cobre qualquer atraso sem
// varrer o histórico inteiro a cada clique.
// ---------------------------------------------------------------------------
export async function importarPedidosML(db: any, dias = 7): Promise<ResumoImportacao> {
  const resumo: ResumoImportacao = {
    lidas: 0, novas: 0, atualizadas: 0, erros: 0, semCusto: [], avisos: [],
  };

  const { token, userId } = await tokenML(db);
  const desde = new Date(Date.now() - dias * 86400000).toISOString();

  // 1) As vendas. Paginado: 50 por página, teto de 200 por clique — se um dia
  //    passar disso, a rodada do robô pega o resto e o aviso aparece na tela.
  const vendas: any[] = [];
  for (let offset = 0; offset < 200; offset += 50) {
    const url =
      `${API}/orders/search?seller=${userId}` +
      `&order.date_created.from=${encodeURIComponent(desde)}` +
      `&sort=date_desc&limit=50&offset=${offset}`;
    const pag = await buscar(url, token);
    if (!pag) {
      if (offset === 0) {
        throw new Error(
          "O Mercado Livre não devolveu as vendas. Se for 403, a aplicação perdeu a permissão " +
            "de Pedidos no DevCenter e é preciso refazer a autorização.",
        );
      }
      resumo.avisos.push("A leitura parou no meio da paginação; rode de novo em instantes.");
      break;
    }
    const res: any[] = pag.results || [];
    vendas.push(...res);
    if (res.length < 50) break;
    if (offset + 50 >= Number(pag.paging?.total || 0)) break;
  }
  resumo.lidas = vendas.length;
  if (!vendas.length) return resumo;

  // 2) As fichas, para saber o custo REAL. Duas chaves porque anúncio antigo
  //    da migração pode não ter SELLER_SKU gravado — casar só por SKU deixaria
  //    o custo em branco justamente nos anúncios órfãos, que são os que já
  //    causaram prejuízo.
  const { data: fichas } = await db
    .from("vendas_produtos")
    .select("sku_trazpraca, ml_item_id, nome, custo")
    .not("custo", "is", null);
  const porSku = new Map<string, any>();
  const porItem = new Map<string, any>();
  for (const f of fichas || []) {
    if (f.sku_trazpraca) porSku.set(String(f.sku_trazpraca), f);
    if (f.ml_item_id) porItem.set(String(f.ml_item_id), f);
  }

  // 3) O que a tela já decidiu, para não sobrescrever.
  const numeros = vendas.map((v) => String(v.id));
  const { data: existentes } = await db
    .from("vendas_pedidos")
    .select("id, pedido_canal")
    .eq("canal", "mercadolivre")
    .in("pedido_canal", numeros);
  const jaTem = new Map<string, string>();
  for (const p of existentes || []) jaTem.set(String(p.pedido_canal), p.id);

  for (const v of vendas) {
    try {
      const pedidoCanal = String(v.id);

      // --- itens + custo ---
      let custoTotal = 0;
      let temTodosOsCustos = true;
      const itens = (v.order_items || []).map((oi: any) => {
        const mlItemId = txt(oi?.item?.id);
        const sku = skuDoItem(oi?.item);
        const ficha =
          (sku ? porSku.get(sku) : null) || (mlItemId ? porItem.get(mlItemId) : null) || null;
        const qtd = num(oi?.quantity) ?? 1;
        const custoUnit = ficha ? num(ficha.custo) : null;
        if (custoUnit == null) temTodosOsCustos = false;
        else custoTotal += custoUnit * qtd;
        return {
          sku: sku || ficha?.sku_trazpraca || null,
          nome: txt(oi?.item?.title) || ficha?.nome || null,
          quantidade: qtd,
          preco_unitario: num(oi?.unit_price),
          ml_item_id: mlItemId,
          custo: custoUnit,
        };
      });
      if (!temTodosOsCustos) resumo.semCusto.push(pedidoCanal);

      // Tarifa do ML: vem por item, já com a quantidade embutida na venda.
      const tarifa = (v.order_items || []).reduce(
        (s: number, oi: any) => s + (num(oi?.sale_fee) ?? 0) * (num(oi?.quantity) ?? 1),
        0,
      );

      // --- envio: endereço, prazo de despacho e frete que ELA paga ---
      let envio: any = null;
      let custosEnvio: any = null;
      const shipId = v?.shipping?.id;
      if (shipId) {
        envio = await buscar(`${API}/shipments/${shipId}`, token);
        custosEnvio = await buscar(`${API}/shipments/${shipId}/costs`, token);
      }
      const end = envio?.receiver_address || {};
      // O frete do vendedor é o do lado "senders" — o "receiver" é o que o
      // comprador pagou e não sai do bolso dela.
      const freteVendedor =
        num(custosEnvio?.senders?.[0]?.cost) ??
        num(custosEnvio?.senders?.[0]?.charges?.cost) ??
        null;

      const valorTotal = num(v?.total_amount);
      const liquido =
        valorTotal == null ? null : valorTotal - (tarifa || 0) - (freteVendedor || 0);

      // Documento do comprador: pode vir bloqueado pelo guarda de dado pessoal
      // do ML. Se vier, ótimo; se não, a tela mostra o resto e ela completa —
      // melhor um campo vazio do que a rodada inteira falhar por causa dele.
      let doc: string | null = null;
      const fat = await buscar(`${API}/orders/${pedidoCanal}/billing_info`, token);
      doc =
        txt(fat?.billing_info?.doc_number) ||
        txt(fat?.buyer?.billing_info?.doc_number) ||
        txt(v?.buyer?.billing_info?.doc_number);

      // Campos que o ROBÔ é dono. Os campos da tela ficam de fora de propósito.
      const doRobo: Record<string, any> = {
        canal: "mercadolivre",
        pedido_canal: pedidoCanal,
        vendido_em: v?.date_created || null,
        status_canal: txt(v?.status),
        prazo_despacho: envio?.shipping_option?.estimated_handling_limit?.date || null,
        comprador_nome:
          txt([v?.buyer?.first_name, v?.buyer?.last_name].filter(Boolean).join(" ")) ||
          txt(end?.receiver_name),
        comprador_documento: doc,
        comprador_apelido: txt(v?.buyer?.nickname),
        comprador_celular: txt(end?.receiver_phone),
        entrega_cep: txt(end?.zip_code),
        entrega_rua: txt(end?.street_name),
        entrega_numero: txt(end?.street_number),
        entrega_complemento: txt(end?.comment),
        entrega_bairro: txt(end?.neighborhood?.name),
        entrega_cidade: txt(end?.city?.name),
        entrega_estado: txt(end?.state?.id) || txt(end?.state?.name),
        entrega_recebedor: txt(end?.receiver_name),
        itens,
        valor_total: valorTotal,
        tarifa_canal: tarifa || null,
        frete_canal: freteVendedor,
        liquido,
        updated_at: new Date().toISOString(),
      };

      // 21/08/2026 — BUG QUE APAGOU DADO REAL, corrigido no mesmo dia.
      // Antes, `custo_fornecedor` entrava SEMPRE no update, valendo null
      // quando a ficha não tinha o custo. Como o update roda em cima da linha
      // que já existe, isso APAGAVA o custo que já estava lá: no primeiro
      // clique do botão, 7 vendas perderam o custo e o lucro do painel caiu
      // de R$ 211,94 para R$ 86,63 sem nada ter mudado na realidade.
      //
      // Agora o custo só é gravado quando REALMENTE foi encontrado. Não achar
      // o custo é motivo para avisar (resumo.semCusto), nunca para escrever
      // por cima do que já existe. Em linha nova o campo simplesmente nasce
      // vazio, que é o correto.
      if (temTodosOsCustos) {
        doRobo.custo_fornecedor = Number(custoTotal.toFixed(2));
      }

      const idExistente = jaTem.get(pedidoCanal);
      if (idExistente) {
        const { error } = await db.from("vendas_pedidos").update(doRobo).eq("id", idExistente);
        if (error) throw new Error(error.message);
        resumo.atualizadas++;
      } else {
        const { error } = await db.from("vendas_pedidos").insert(doRobo);
        if (error) {
          // 23505 = a trava de duplicata funcionou: o robô gravou entre a
          // leitura e a escrita. Isso é o sistema certo, não erro.
          if (String(error.code) === "23505") resumo.atualizadas++;
          else throw new Error(error.message);
        } else {
          resumo.novas++;
        }
      }
    } catch (e: any) {
      resumo.erros++;
      resumo.avisos.push(`Venda ${v?.id}: ${e?.message || e}`);
    }
  }

  // O log é o que faz a tela mostrar "Última leitura" — e é onde a rodada
  // aparece no histórico junto com as do robô.
  await db
    .from("vendas_sync_log")
    .insert({
      tipo: "pedidos",
      // O check da tabela só aceita ok | erro | alerta (migration 078).
      status: resumo.erros ? "alerta" : "ok",
      itens_encontrados: resumo.lidas,
      itens_novos: resumo.novas,
      itens_alterados: resumo.novas + resumo.atualizadas,
      mensagem:
        `Botão do portal: ${resumo.lidas} venda(s), ${resumo.novas} nova(s), ` +
        `${resumo.atualizadas} atualizada(s), ${resumo.erros} erro(s)` +
        (resumo.semCusto.length ? `, ${resumo.semCusto.length} sem custo na ficha` : ""),
    })
    .then(
      () => {},
      () => {},
    );

  return resumo;
}
