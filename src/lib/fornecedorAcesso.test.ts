import { nivelEfetivo } from "./permissoes";
import { bancoLiberado, resumoAcesso, type AcessoFornecedor } from "./fornecedorAcesso";

let ok = 0, falhou = 0;
const t = (nome: string, real: any, esperado: any) => {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (bate) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHA ${nome} → esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(real)}`); }
};

const F = ["fornecedor"];
console.log("\n[1] MÓDULOS — fornecedor recém-criado, nada liberado:");
t("doc-empresa sem override", nivelEfetivo("doc-empresa", F, {}), "nenhum");
t("doc-bancarios sem override", nivelEfetivo("doc-bancarios", F, {}), "nenhum");
t("financeiro (fora do teto)", nivelEfetivo("financeiro", F, {}), "nenhum");
t("rh (fora do teto)", nivelEfetivo("rh", F, {}), "nenhum");

console.log("\n[2] MÓDULOS — só Documentos da Empresa liberado:");
const soEmp = { "doc-empresa": "ver" as const };
t("doc-empresa liberado", nivelEfetivo("doc-empresa", F, soEmp), "ver");
t("doc-bancarios continua fechado", nivelEfetivo("doc-bancarios", F, soEmp), "nenhum");

console.log("\n[3] TETO — override não eleva nem escapa do papel:");
t("doc-empresa marcado 'editar' → capa em ver", nivelEfetivo("doc-empresa", F, { "doc-empresa": "editar" }), "ver");
t("financeiro marcado 'editar' → segue nenhum", nivelEfetivo("financeiro", F, { financeiro: "editar" }), "nenhum");
t("obras marcado 'editar' → segue nenhum", nivelEfetivo("obras", F, { obras: "editar" }), "nenhum");
t("admin marcado 'editar' → segue nenhum", nivelEfetivo("admin", F, { admin: "editar" }), "nenhum");

console.log("\n[4] MÓDULOS — usuário interno não é afetado:");
t("financeiro do perfil financeiro", nivelEfetivo("financeiro", ["financeiro"], {}) !== "nenhum", true);
t("admin vê doc-bancarios", nivelEfetivo("doc-bancarios", ["admin"], {}), "editar");

console.log("\n[5] BANCOS — escopo por lista:");
const soItau: AcessoFornecedor = { docEmpresa: false, docBancarios: true, bancosModo: "lista", bancos: ["Itaú"] };
t("Itaú liberado", bancoLiberado(soItau, "Itaú"), true);
t("Itaú sem acento/caixa", bancoLiberado(soItau, "itau"), true);
t("Bradesco bloqueado", bancoLiberado(soItau, "Bradesco"), false);
t("banco vazio bloqueado", bancoLiberado(soItau, ""), false);
t("banco nulo bloqueado", bancoLiberado(soItau, null), false);

console.log("\n[6] BANCOS — modo todos e módulo desligado:");
const todos: AcessoFornecedor = { docEmpresa: true, docBancarios: true, bancosModo: "todos", bancos: [] };
t("qualquer banco passa", bancoLiberado(todos, "Sicoob"), true);
t("banco novo (futuro) passa", bancoLiberado(todos, "Banco XPTO"), true);
const semBanc: AcessoFornecedor = { docEmpresa: true, docBancarios: false, bancosModo: "todos", bancos: [] };
t("módulo desligado bloqueia mesmo com modo 'todos'", bancoLiberado(semBanc, "Itaú"), false);
const listaVazia: AcessoFornecedor = { docEmpresa: false, docBancarios: true, bancosModo: "lista", bancos: [] };
t("lista vazia não libera nada", bancoLiberado(listaVazia, "Itaú"), false);

console.log("\n[7] RESUMO em texto:");
t("resumo lista", resumoAcesso(soItau), "Documentos Bancários (Itaú)");
t("resumo todos", resumoAcesso(todos), "Documentos da Empresa + Documentos Bancários (todos os bancos)");
t("resumo vazio", resumoAcesso({ docEmpresa: false, docBancarios: false, bancosModo: "lista", bancos: [] }), "nenhum acesso liberado");

console.log(`\n${falhou === 0 ? "TUDO PASSOU" : "TEM FALHA"} — ${ok} ok, ${falhou} falha(s)\n`);
process.exit(falhou === 0 ? 0 : 1);
