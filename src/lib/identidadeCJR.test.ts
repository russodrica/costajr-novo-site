// Testes da identificação dos lados do comprovante.
//
// Rodar: npx tsx src/lib/identidadeCJR.test.ts
//
// Existe porque errar aqui não dá erro na tela — dá lançamento errado no livro.
// Os casos vieram de comprovantes reais da Costa Júnior (17/09/2026) e dos
// falsos positivos que a auditoria daquele dia encontrou.

import { identificarLado, ehAPropriaCJR } from "./identidadeCJR";

let ok = 0;
let falhou = 0;

function checa(
  descricao: string,
  nome: string | null,
  doc: string | null,
  esperado: "cjr" | "terceiro" | "desconhecido",
) {
  const r = identificarLado(nome, doc);
  const bom = r.lado === esperado;
  if (bom) ok++;
  else falhou++;
  console.log(
    `${bom ? "ok  " : "ERRO"} ${r.lado.padEnd(12)} ${bom ? "" : `(esperava ${esperado}) `}` +
      `${descricao}  →  ${r.motivo}`,
  );
}

console.log("── a empresa ──");
checa("razão social inteira", "COSTA JUNIOR ENGENHARIA E CONSTRUCOES LTDA", null, "cjr");
checa("razão social truncada pelo banco", "COSTA JUNIOR ENGENHARIA E CONSTRUCOE...", null, "cjr");
checa("com acento", "COSTA JÚNIOR ENGENHARIA E CONSTRUÇÃO", null, "cjr");
checa("CNPJ inteiro, sem nome", null, "07.132.942/0001-72", "cjr");
checa("CNPJ mascarado com 8 dígitos visíveis", null, "07.***.***/0001-72", "cjr");
checa("nome fraco mas CNPJ confere", "COSTA JR", "07132942000172", "cjr");
checa("documento colado no nome", "COSTA JUNIOR ENG 07.132.942/0001-72", null, "cjr");

console.log("\n── o sócio e outras pessoas físicas ──");
checa("o SÓCIO, que recebe da empresa", "JOSE FERREIRA DA COSTA JUNIOR", null, "terceiro");
checa("o sócio em caixa baixa", "Jose Ferreira da Costa Junior", null, "terceiro");
checa("o sócio com CPF", "JOSE FERREIRA DA COSTA JUNIOR", "123.456.789-09", "terceiro");
checa("outra pessoa com o mesmo sobrenome", "MARIA DE COSTA JUNIOR", null, "terceiro");

console.log("\n── terceiros ──");
checa("fornecedor comum", "LEROY MERLIN COMPANHIA BRASILEIRA", null, "terceiro");
checa("o tribunal, num depósito judicial", "CEF MATRIZ", null, "terceiro");
checa("um banco", "BANCO VILLELA S.A.", null, "terceiro");
checa("CNPJ de outra empresa decide sozinho", "COSTA JUNIOR ENGENHARIA", "11.222.333/0001-44", "terceiro");

console.log("\n── quando NÃO dá para afirmar (o bot tem de perguntar) ──");
checa("vazio", "", null, "desconhecido");
checa("máscara com só 4 dígitos visíveis", null, "07.******/****-72", "desconhecido");
checa("nome ambíguo entre a empresa e o sócio", "COSTA JUNIOR", null, "desconhecido");
checa("abreviação sem marca de empresa", "COSTA JR", null, "desconhecido");

console.log("\n── o atalho ehAPropriaCJR ──");
for (const [txt, esperado] of [
  ["COSTA JUNIOR ENGENHARIA E CONSTRUCOES", true],
  ["JOSE FERREIRA DA COSTA JUNIOR", false],
  ["CARREFOUR COMERCIO", false],
] as const) {
  const r = ehAPropriaCJR(txt);
  const bom = r === esperado;
  if (bom) ok++;
  else falhou++;
  console.log(`${bom ? "ok  " : "ERRO"} ${String(r).padEnd(5)} ${txt}`);
}

console.log(`\n${ok}/${ok + falhou}`);
if (falhou) process.exit(1);
