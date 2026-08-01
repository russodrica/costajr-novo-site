// Testes do motor de precificação. Rodam sem rede e sem banco.
//
//   node --experimental-strip-types src/lib/precificacao.test.ts
//
// (Node 22+ roda TypeScript direto com essa flag — não precisa de build.)
import {
  CONFIG_PADRAO, normalizarConfig, resultadoML, resultadoShopee,
  precoParaMargemML, precoParaMargemShopee, zonaMortaML, avaliar, faixaShopee,
  precoRecomendado, fugirDaZonaMortaML,
} from './precificacao.ts';

let falhas = 0;
const perto = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
function t(nome, fn) {
  try { fn(); console.log('  OK   ' + nome); }
  catch (e) { falhas++; console.log('  FALHOU ' + nome + ': ' + e.message); }
}
function eq(a, b, msg) { if (!perto(a, b)) throw new Error(`${msg}: esperado ~${b}, veio ${a}`); }
function ok(v, msg) { if (!v) throw new Error(msg); }

const cfg = normalizarConfig(null);

// ---------- produtos reais dela ----------
t('Mini Luminária Snoopy (52,34 -> 102,06): ML', () => {
  const r = resultadoML(52.34, 102.06, cfg);
  // acima de 79: comissao 13% = 13,27 + frete 22 = 35,27
  eq(r.taxas, 35.27, 'taxas ML');
  eq(r.lucro, 14.45, 'lucro ML');
  eq(r.margemPct, 14.16, 'margem ML');
});

t('Mini Luminária Snoopy: Shopee', () => {
  const r = resultadoShopee(52.34, 102.06, cfg);
  // faixa 100-199,99: 14% = 14,29 + fixo 20 = 34,29
  eq(r.taxas, 34.29, 'taxas Shopee');
  eq(r.lucro, 15.43, 'lucro Shopee');
});

t('Luminária 3D Snoopy (129,20 -> 251,94): margem ~24-27%', () => {
  const ml = resultadoML(129.20, 251.94, cfg);
  const sh = resultadoShopee(129.20, 251.94, cfg);
  eq(ml.lucro, 67.99, 'lucro ML');
  eq(sh.lucro, 61.47, 'lucro Shopee');
  ok(ml.margemPct > 24 && ml.margemPct < 28, 'margem ML fora do esperado');
});

// ---------- o risco do ticket baixo ----------
t('Item barato (custo 10 -> sugerido 19,50) quase não dá lucro', () => {
  const ml = resultadoML(10, 19.50, cfg);
  const sh = resultadoShopee(10, 19.50, cfg);
  ok(ml.lucro < 1.50, 'ML deveria sobrar quase nada, veio ' + ml.lucro);
  ok(sh.lucro < 2.00, 'Shopee deveria sobrar quase nada, veio ' + sh.lucro);
});

t('Preço abaixo do custo é prejuízo detectado', () => {
  const a = avaliar(100, 50, cfg);
  ok(a.temPrejuizo, 'deveria marcar prejuízo');
});

// ---------- faixas da Shopee ----------
t('Faixas da Shopee selecionam corretamente', () => {
  eq(faixaShopee(50, cfg).fixo, 4, 'faixa ate 79,99');
  eq(faixaShopee(85, cfg).fixo, 16, 'faixa 80-99,99');
  eq(faixaShopee(150, cfg).fixo, 20, 'faixa 100-199,99');
  eq(faixaShopee(300, cfg).fixo, 26, 'faixa 200-499,99');
  eq(faixaShopee(900, cfg).fixo, 28, 'faixa acima de 500');
});

// ---------- zona morta do ML ----------
t('Zona morta do ML é calculada', () => {
  const z = zonaMortaML(cfg);
  ok(z, 'deveria existir zona morta');
  eq(z.de, 79, 'inicio da zona morta');
  eq(z.ate, 97.38, 'fim da zona morta');
});

t('Dentro da zona morta lucra MENOS que logo abaixo dela', () => {
  const custo = 40;
  const antes = resultadoML(custo, 78.99, cfg).lucro;
  const dentro = resultadoML(custo, 85, cfg).lucro;
  const saida = resultadoML(custo, 97.38, cfg).lucro;
  ok(dentro < antes, `vender a 85 (${dentro}) deveria render menos que a 78,99 (${antes})`);
  eq(saida, antes, 'na saída da zona morta o lucro deve empatar com 78,99');
});

t('avaliar() sinaliza preço dentro da zona morta', () => {
  ok(avaliar(40, 85, cfg).naZonaMortaML, 'deveria sinalizar zona morta');
  ok(!avaliar(40, 120, cfg).naZonaMortaML, 'não deveria sinalizar fora dela');
});

// ---------- preço mínimo para a margem alvo ----------
t('Preço mínimo ML atinge exatamente a margem alvo', () => {
  for (const custo of [20, 50, 100, 150]) {
    const p = precoParaMargemML(custo, 30, cfg);
    const r = resultadoML(custo, p, cfg);
    ok(r.margemPct >= 29.9, `custo ${custo}: margem veio ${r.margemPct}% no preço ${p}`);
  }
});

t('Preço mínimo Shopee atinge a margem alvo e respeita a faixa', () => {
  for (const custo of [20, 50, 100, 150, 400]) {
    const p = precoParaMargemShopee(custo, 30, cfg);
    const r = resultadoShopee(custo, p, cfg);
    ok(r.margemPct >= 29.5, `custo ${custo}: margem veio ${r.margemPct}% no preço ${p}`);
  }
});

t('Preço mínimo nunca cai dentro da zona morta do ML', () => {
  const z = zonaMortaML(cfg);
  for (let custo = 5; custo <= 200; custo += 2.5) {
    const p = precoParaMargemML(custo, 30, cfg);
    ok(!(p > z.de && p < z.ate), `custo ${custo} gerou preço ${p} dentro da zona morta`);
  }
});

t('Margem impossível devolve null', () => {
  ok(precoParaMargemML(50, 95, cfg) === null, 'comissão 13% + margem 95% > 100%, deveria ser null');
});

// ---------- config vinda do banco ----------
t('Config do banco sobrescreve o padrão', () => {
  const c = normalizarConfig({ ml_comissao_pct: 17.5, margem_alvo_pct: 40 });
  eq(c.ml_comissao_pct, 17.5, 'comissao');
  eq(c.margem_alvo_pct, 40, 'margem alvo');
  eq(c.ml_frete_estimado, 22, 'campo ausente cai no padrão');
  const r = resultadoML(100, 200, c);
  eq(r.taxas, 57, 'taxas com comissão premium (35 + 22)');
});

t('Faixas fora de ordem são normalizadas', () => {
  const c = normalizarConfig({ shopee_faixas: [
    { ate: null, pct: 14, fixo: 28 },
    { ate: 79.99, pct: 20, fixo: 4 },
    { ate: 199.99, pct: 14, fixo: 20 },
  ]});
  eq(faixaShopee(50, c).fixo, 4, 'deveria pegar a faixa mais baixa');
  eq(faixaShopee(150, c).fixo, 20, 'faixa intermediária');
  eq(faixaShopee(900, c).fixo, 28, 'faixa sem teto por último');
});

t('Campanha da Shopee entra na conta', () => {
  const c = normalizarConfig({ shopee_campanha_pct: 2.5 });
  const semCampanha = resultadoShopee(50, 150, cfg).taxas;
  const comCampanha = resultadoShopee(50, 150, c).taxas;
  eq(comCampanha - semCampanha, 3.75, 'campanha 2,5% sobre 150');
});


// ---------------------------------------------------------------------------
// Politica de preco competitivo (regra da Adriana, 31/07/2026):
// mira 30%; acompanha o concorrente ate 15%; nunca abaixo disso.
// ---------------------------------------------------------------------------

t('Sem referencia de mercado, recomenda o preco da margem alvo', () => {
  const r = precoRecomendado('ml', 35.31, cfg, null);
  ok(r.motivo === 'alvo', 'motivo deveria ser alvo, veio ' + r.motivo);
  eq(r.margemPct, cfg.margem_alvo_pct, 'margem no alvo');
});

t('Concorrente acima do alvo: mantem o alvo, nao sobe junto', () => {
  const alvo = precoParaMargemML(35.31, cfg.margem_alvo_pct, cfg);
  const r = precoRecomendado('ml', 35.31, cfg, alvo + 40);
  ok(r.motivo === 'alvo', 'nao deveria acompanhar concorrente mais caro');
  eq(r.preco, alvo, 'preco alvo');
});

t('Concorrente entre o piso e o alvo: acompanha o concorrente', () => {
  const r = precoRecomendado('ml', 35.31, cfg, 62.0);
  ok(r.motivo === 'mercado', 'deveria acompanhar o mercado, veio ' + r.motivo);
  eq(r.preco, 62.0, 'preco de mercado');
  ok(r.margemPct >= cfg.margem_minima_pct - 0.02, 'margem furou o piso: ' + r.margemPct);
  ok(!r.foraDeCompeticao, 'ainda esta competindo');
});

t('Concorrente abaixo do piso: para no piso e sinaliza fora de competicao', () => {
  const r = precoRecomendado('ml', 35.31, cfg, 40.0);
  ok(r.motivo === 'piso', 'deveria parar no piso, veio ' + r.motivo);
  ok(r.foraDeCompeticao, 'deveria sinalizar que nao da para competir');
  eq(r.margemPct, cfg.margem_minima_pct, 'margem no piso');
});

t('NUNCA recomenda preco com margem zero ou negativa', () => {
  for (let custo = 5; custo <= 300; custo += 3.5) {
    for (const mercado of [1, 5, 10, custo, custo * 1.1]) {
      const r = precoRecomendado('ml', custo, cfg, mercado);
      ok(r.margemPct > 0, `custo ${custo} / mercado ${mercado} deu margem ${r.margemPct}%`);
      ok(r.preco > custo, `preco ${r.preco} nao cobre o custo ${custo}`);
    }
  }
});

t('Recomendacao nunca cai dentro da zona morta do ML', () => {
  const zm = zonaMortaML(cfg);
  for (let custo = 5; custo <= 200; custo += 2.5) {
    for (const mercado of [null, 60, 80, 85, 90, 95, 120]) {
      const r = precoRecomendado('ml', custo, cfg, mercado);
      ok(r.preco < zm.de || r.preco > zm.ate,
         `custo ${custo} / mercado ${mercado} caiu na zona morta: ${r.preco}`);
    }
  }
});

t('Shopee tambem respeita o piso de margem minima', () => {
  const r = precoRecomendado('shopee', 35.31, cfg, 30.0);
  ok(r.motivo === 'piso', 'deveria parar no piso da Shopee, veio ' + r.motivo);
  ok(r.margemPct >= cfg.margem_minima_pct - 0.5, 'piso da Shopee furado: ' + r.margemPct);
});

t('fugirDaZonaMorta empurra para BAIXO, nunca para cima', () => {
  const zm = zonaMortaML(cfg);
  const dentro = (zm.de + zm.ate) / 2;
  ok(fugirDaZonaMortaML(dentro, cfg) < zm.de, 'deveria sair por baixo');
  eq(fugirDaZonaMortaML(50, cfg), 50, 'fora da zona nao mexe');
  eq(fugirDaZonaMortaML(150, cfg), 150, 'acima da zona nao mexe');
});

console.log('\n' + (falhas ? `${falhas} FALHA(S)` : 'TODOS OS TESTES PASSARAM'));
process.exit(falhas ? 1 : 0);
