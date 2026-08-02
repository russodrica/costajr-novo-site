import type { APIRoute } from "astro";
import { requireAdminCookie, temPerfil, jsonOk, jsonErr } from "../../../../lib/auth";
import { supabaseAdmin } from "../../../../lib/supabase";
import { registrarAcao } from "../../../../lib/auditoria";

export const prerender = false;
const PERFIS = ["admin"];

// ---------------------------------------------------------------------------
// Recebe o retrato da Shopee.
//
// Por que este endpoint existe em vez de uma integração automática: a Shopee
// não liberou API de leitura para esta conta. O que existe é a API interna do
// Seller Centre, que só responde dentro da sessão logada da vendedora. Então o
// caminho honesto é: ela roda o coletor na aba da Shopee, cola o resultado
// aqui, e o portal grava. Sem cookie de terceiro guardado em lugar nenhum,
// sem senha passando pelo servidor.
//
// O corpo aceito é a lista que o coletor gera:
//   [{ id, sku, name, price, estoque, vendidos, status }, …]
// `status` é "active" ou "unlisted". Anúncio "unlisted" NÃO conta como no ar.
// ---------------------------------------------------------------------------

const LIMITE_ANUNCIOS = 5000;

type Entrada = {
  id: string;
  sku: string | null;
  titulo: string | null;
  preco: number | null;
  estoque: number | null;
  vendidos: number | null;
  situacao: "active" | "unlisted";
  // Ficha vinda do próprio anúncio da Shopee. Os produtos dela na Shopee SÃO
  // produtos da TrazPraCa, então esta é a ficha original — e para as centenas
  // de produtos que a vitrine não reconhece pelo SKU, é a ÚNICA fonte de foto.
  fotos: string[];
  descricao: string | null;
  peso: number | null;
  altura: number | null;
  largura: number | null;
  profundidade: number | null;
  marca: string | null;
};

function normalizar(texto: any): string {
  if (!texto) return "";
  return String(texto)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, " ")
    .trim();
}

function numero(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizarEntrada(bruto: any): Entrada | null {
  const id = String(bruto?.id ?? bruto?.item_id ?? "").trim();
  if (!id) return null;
  const unlist = bruto?.unlist === true;
  const situacaoBruta = String(bruto?.status ?? bruto?.situacao ?? "active").toLowerCase();
  return {
    id,
    sku: String(bruto?.sku ?? bruto?.parent_sku ?? "").trim() || null,
    titulo: String(bruto?.name ?? bruto?.titulo ?? "").trim() || null,
    preco: numero(bruto?.price ?? bruto?.preco),
    estoque: numero(bruto?.estoque ?? bruto?.stock),
    vendidos: numero(bruto?.vendidos ?? bruto?.sold),
    situacao: unlist || situacaoBruta !== "active" ? "unlisted" : "active",
    fotos: Array.isArray(bruto?.fotos)
      ? bruto.fotos.filter((f: any) => typeof f === "string" && /^https:\/\//.test(f)).slice(0, 10)
      : [],
    descricao: String(bruto?.descricao ?? "").trim().slice(0, 4000) || null,
    peso: numero(bruto?.peso),
    altura: numero(bruto?.alt ?? bruto?.altura),
    largura: numero(bruto?.larg ?? bruto?.largura),
    profundidade: numero(bruto?.prof ?? bruto?.profundidade),
    marca: String(bruto?.marca ?? "").trim().slice(0, 60) || null,
  };
}

// O anúncio da Shopee que veio com este SKU é MESMO deste produto?
//
// Existe porque alguns anúncios dela na Shopee foram criados com o SKU de
// outro item — "Giz Líquido Neon" com o SKU do peitoral para cães, "Garrafa
// Térmica" com o SKU da guia pet. Casar por SKU sem olhar o nome faz a ficha
// (foto, descrição, peso) do giz virar a ficha do peitoral. É exatamente o
// erro que tirou onze anúncios do ar em 02/08 — de outra porta de entrada.
//
// A régua é a mesma do enriquecedor: um terço das palavras do nome que já
// conhecemos precisa aparecer no título do anúncio. Compara nos dois sentidos
// porque o portal costuma ter o nome mais comprido que o marketplace.
function palavras(texto: any): string[] {
  return String(texto || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^0-9a-z]+/)
    .filter((w) => w.length > 3);
}

function mesmoProduto(tituloAnuncio: any, nomeProduto: any): boolean {
  const a = palavras(tituloAnuncio);
  const b = palavras(nomeProduto);
  if (!a.length || !b.length) return true; // sem material para julgar: não acusa
  const setA = new Set(a);
  const setB = new Set(b);
  const paraCa = b.filter((w) => setA.has(w)).length / b.length;
  const paraLa = a.filter((w) => setB.has(w)).length / a.length;
  return Math.max(paraCa, paraLa) >= 0.34;
}

// Medida só entra se for plausível. Os mesmos limites do enriquecedor: a ficha
// é digitada à mão e erra unidade, e medida errada vira frete errado.
function medidaOk(v: number | null, min: number, max: number): number | null {
  return v != null && v >= min && v <= max ? v : null;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const admin = await requireAdminCookie(request);
    if (!temPerfil(admin, PERFIS)) return jsonErr(403, "Sem permissão");

    const corpo = await request.json();
    const bruta: any[] = Array.isArray(corpo) ? corpo : corpo?.anuncios;
    if (!Array.isArray(bruta)) {
      return jsonErr(400, "Esperava uma lista de anúncios. Cole o texto que o coletor gerou, inteiro.");
    }
    if (bruta.length === 0) return jsonErr(400, "A lista veio vazia — nada foi gravado.");
    if (bruta.length > LIMITE_ANUNCIOS) {
      return jsonErr(400, `Lista grande demais (${bruta.length}). O limite é ${LIMITE_ANUNCIOS}.`);
    }

    const anuncios = bruta.map(normalizarEntrada).filter(Boolean) as Entrada[];
    if (anuncios.length === 0) return jsonErr(400, "Nenhum anúncio da lista tinha id. Refaça a coleta.");

    const db = supabaseAdmin();
    const { data: produtos, error: erroProdutos } = await db
      .from("vendas_produtos")
      .select("id,sku_trazpraca,sku_proprio,nome,titulo_anuncio,shopee_item_id,publicado_shopee,shopee_situacao,preco_shopee,fotos,descricao,peso_kg,altura_cm,largura_cm,profundidade_cm,marca")
      .limit(5000);
    if (erroProdutos) return jsonErr(400, erroProdutos.message);

    // Índices para casar anúncio → produto sem varrer a lista a cada volta.
    const porShopeeId = new Map<string, any>();
    const porSkuTraz = new Map<string, any>();
    const porSkuProprio = new Map<string, any>();
    const porTitulo = new Map<string, any>();
    for (const p of produtos || []) {
      if (p.shopee_item_id && !porShopeeId.has(String(p.shopee_item_id))) porShopeeId.set(String(p.shopee_item_id), p);
      if (p.sku_trazpraca && !porSkuTraz.has(String(p.sku_trazpraca))) porSkuTraz.set(String(p.sku_trazpraca), p);
      if (p.sku_proprio && !porSkuProprio.has(String(p.sku_proprio))) porSkuProprio.set(String(p.sku_proprio), p);
      for (const t of [p.titulo_anuncio, p.nome]) {
        const chave = normalizar(t);
        if (chave && !porTitulo.has(chave)) porTitulo.set(chave, p);
      }
    }

    const agora = new Date().toISOString();
    const linhas: any[] = [];
    const doProduto = new Map<string, Entrada[]>();
    const descasados: Array<{ sku: string | null; anuncio: string | null; produto: string }> = [];
    let orfaos = 0;

    for (const a of anuncios) {
      let produto: any = porShopeeId.get(a.id) || null;
      let comoCasou: string | null = produto ? "shopee_item_id" : null;
      if (!produto && a.sku) {
        produto = porSkuTraz.get(a.sku) || null;
        if (produto) comoCasou = "sku_trazpraca";
        if (!produto) {
          produto = porSkuProprio.get(a.sku) || null;
          if (produto) comoCasou = "sku_proprio";
        }
      }
      if (!produto) {
        const chave = normalizar(a.titulo);
        if (chave) {
          produto = porTitulo.get(chave) || null;
          if (produto) comoCasou = "titulo";
        }
      }
      // Casou por SKU mas o título fala de outra coisa: o anúncio fica órfão.
      // Melhor um anúncio sem dono na tela — que ela vê e resolve — do que a
      // ficha errada colada num produto certo.
      if (produto && comoCasou !== "shopee_item_id" && !mesmoProduto(a.titulo, produto.nome)) {
        descasados.push({ sku: a.sku, anuncio: a.titulo, produto: produto.nome });
        produto = null;
        comoCasou = null;
      }

      if (produto) {
        const lista = doProduto.get(produto.id) || [];
        lista.push(a);
        doProduto.set(produto.id, lista);
      } else {
        orfaos++;
      }

      linhas.push({
        canal: "shopee",
        item_id: a.id,
        sku: a.sku,
        titulo: a.titulo,
        preco: a.preco,
        estoque: a.estoque,
        vendidos: a.vendidos,
        situacao: a.situacao, // "active" | "unlisted" (não listado na vitrine)
        tipo_anuncio: null,
        permalink: `https://shopee.com.br/product/0/${a.id}`,
        saude: null,
        produto_id: produto?.id ?? null,
        casado_por: comoCasou,
        fonte: "snapshot",
        visto_em: agora,
      });
    }

    // Upsert em lotes — payload grande demais de uma vez costuma estourar.
    let gravados = 0;
    for (let i = 0; i < linhas.length; i += 200) {
      const lote = linhas.slice(i, i + 200);
      const { error } = await db
        .from("vendas_anuncios_canal")
        .upsert(lote, { onConflict: "canal,item_id" });
      if (error) return jsonErr(400, `Falha ao gravar os anúncios: ${error.message}`);
      gravados += lote.length;
    }

    // Reflete no produto. Quem não apareceu na coleta volta para "não está na
    // Shopee" — é assim que a publicação que falhou fica visível.
    //
    // Duas travas de tempo, aprendidas na marra (a primeira versão levava um
    // 504 da Vercel): só escreve QUEM MUDOU, e escreve em paralelo. Escrever
    // 400 produtos um a um, todo dia, para reafirmar o que já estava lá, é
    // trabalho que ninguém pediu.
    let comAnuncio = 0;
    let enriquecidos = 0;
    const tarefas: Array<() => Promise<any>> = [];

    for (const p of produtos || []) {
      const lista = doProduto.get(p.id) || [];
      const noAr = lista.filter((a) => a.situacao === "active");
      const escolhido = noAr[0] || lista[0] || null;
      if (lista.length > 0) comAnuncio++;

      // Produto que nunca esteve na Shopee e continua fora dela não precisa de
      // escrita nenhuma.
      if (!escolhido && p.publicado_shopee !== true && p.shopee_item_id == null) continue;

      const patch: any = {};
      const publicado = noAr.length > 0;
      const situacao = escolhido ? escolhido.situacao : null;
      const itemId = escolhido ? escolhido.id : null;
      if (p.publicado_shopee !== publicado) patch.publicado_shopee = publicado;
      if ((p.shopee_situacao ?? null) !== situacao) patch.shopee_situacao = situacao;
      if ((p.shopee_item_id != null ? String(p.shopee_item_id) : null) !== itemId) patch.shopee_item_id = itemId;
      if (escolhido?.preco != null && Number(p.preco_shopee) !== escolhido.preco) patch.preco_shopee = escolhido.preco;

      // Ficha: só PREENCHE BURACO. Nunca sobrescreve o que a vitrine da
      // TrazPraCa já entregou — aquela fonte foi conferida contra o nome do
      // produto; esta não tem como ser conferida foto a foto.
      if (escolhido) {
        if (!(p.fotos || []).length && escolhido.fotos.length) {
          patch.fotos = escolhido.fotos;
          enriquecidos++;
        }
        if (!p.descricao && escolhido.descricao) patch.descricao = escolhido.descricao;
        if (p.peso_kg == null) {
          const kg = medidaOk(escolhido.peso, 0.005, 60);
          if (kg != null) patch.peso_kg = kg;
        }
        if (p.altura_cm == null) {
          const a = medidaOk(escolhido.altura, 0.5, 300);
          if (a != null) patch.altura_cm = a;
        }
        if (p.largura_cm == null) {
          const l = medidaOk(escolhido.largura, 0.5, 300);
          if (l != null) patch.largura_cm = l;
        }
        if (p.profundidade_cm == null) {
          const f = medidaOk(escolhido.profundidade, 0.5, 300);
          if (f != null) patch.profundidade_cm = f;
        }
        if (!p.marca && escolhido.marca) patch.marca = escolhido.marca;
      }

      if (Object.keys(patch).length === 0) continue;
      patch.inventariado_em = agora;
      tarefas.push(async () => { await db.from("vendas_produtos").update(patch).eq("id", p.id); });
    }

    let atualizados = 0;
    for (let i = 0; i < tarefas.length; i += 25) {
      await Promise.all(tarefas.slice(i, i + 25).map((t) => t()));
      atualizados += Math.min(25, tarefas.length - i);
    }

    const noArTotal = anuncios.filter((a) => a.situacao === "active").length;
    const mensagem =
      `Shopee: ${anuncios.length} anúncio(s) recebidos, ${noArTotal} no ar, ` +
      `${comAnuncio} casado(s) com produto do catálogo, ${orfaos} sem produto correspondente. ` +
      `${atualizados} produto(s) atualizados, ${enriquecidos} ganharam foto da Shopee.` +
      (descasados.length ? ` ATENÇÃO: ${descasados.length} anúncio(s) vieram com o SKU de outro produto e não foram casados.` : "");

    await db.from("vendas_sync_log").insert({
      tipo: "inventario",
      status: "ok",
      itens_encontrados: anuncios.length,
      itens_alterados: comAnuncio,
      mensagem,
      detalhes: { canal: "shopee", no_ar: noArTotal, orfaos, descasados: descasados.slice(0, 50), por: admin.email },
    });

    await registrarAcao(db, { req: request, admin }, {
      acao: "editar",
      entidade: "vendas_anuncios_canal",
      registro_id: null,
      descricao: `Atualizou o inventário da Shopee (${anuncios.length} anúncios)`,
    }).catch(() => {});

    return jsonOk({ ok: true, recebidos: anuncios.length, gravados, no_ar: noArTotal, casados: comAnuncio, orfaos, atualizados, com_foto: enriquecidos, descasados, mensagem });
  } catch (e: any) {
    return jsonErr(e.message === "Não autenticado" ? 401 : 500, e.message);
  }
};
