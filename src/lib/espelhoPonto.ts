import { apuracaoMensal, listarPessoas, rhidConfigurado } from "./rhid";
import { gerarEspelhoPontoPdf, type DiaEspelho } from "./espelhoPontoPdf";

// Gera o espelho de ponto de UM colaborador num mês e guarda na ficha dele
// (bucket privado `rh` + linha em rh_documentos). Usado pela tela do RH e pela
// rotina automática do dia 10.
//
// Regra de vínculo com a ControliD:
//   1) rhid_person_id, quando amarrado na mão pela tela de Vínculo;
//   2) senão, casamento automático por CPF.
// Isso resolve o caso em que o CPF está escrito diferente nos dois sistemas.

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const soDigitos = (s: any) => String(s || "").replace(/\D/g, "");
export const rotuloMes = (anoMes: string) => {
  const [a, m] = anoMes.split("-").map(Number);
  return `${MESES[m - 1] || m} / ${a}`;
};
const fmtBR = (iso: any) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : null);
const cpfMasc = (s: any) => { const d = soDigitos(s); return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : null; };

export type ResultadoEspelho =
  | { ok: true; colaborador: string; anoMes: string; documentoId: string; substituiu: boolean; dias: number }
  | { ok: false; colaborador: string; anoMes: string; motivo: string };

/** Descobre o id da pessoa na ControliD para um colaborador do Portal. */
export async function idNaControliD(colab: any, pessoas: { id: number; cpf: string }[]): Promise<number | null> {
  if (colab?.rhid_person_id) return Number(colab.rhid_person_id);
  const cpf = soDigitos(colab?.cpf);
  if (!cpf) return null;
  const achou = pessoas.find((p) => soDigitos(p.cpf) === cpf);
  return achou ? achou.id : null;
}

/**
 * Gera e ARQUIVA o espelho do mês na ficha. Se já existir um espelho daquele mês,
 * o antigo é substituído (não acumula duplicado quando a rotina roda de novo).
 */
export async function gerarEArquivarEspelho(
  db: any,
  colab: any,
  anoMes: string,
  pessoas: { id: number; cpf: string }[],
  autor: string,
): Promise<ResultadoEspelho> {
  const nome = colab?.nome || "colaborador";
  if (!rhidConfigurado()) return { ok: false, colaborador: nome, anoMes, motivo: "Integração com a ControliD não configurada." };

  const idPerson = await idNaControliD(colab, pessoas);
  if (!idPerson) return { ok: false, colaborador: nome, anoMes, motivo: "Sem vínculo com a ControliD (use a tela de Vínculo)." };

  const dias = await apuracaoMensal(idPerson, anoMes);
  if (!dias.length) return { ok: false, colaborador: nome, anoMes, motivo: "Nenhum registro de ponto neste mês." };

  const pdf = await gerarEspelhoPontoPdf({
    colaborador: nome,
    cargo: colab?.cargo || null,
    cpf: cpfMasc(colab?.cpf),
    admissao: fmtBR(colab?.data_admissao),
    mesLabel: rotuloMes(anoMes),
    anoMes,
    empresa: "Costa Junior Engenharia e Construcoes LTDA",
    geradoEm: new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date()),
    dias: dias as DiaEspelho[],
    logoBytes: null,
  });

  const titulo = `Espelho de ponto - ${rotuloMes(anoMes)}`;
  const storagePath = `documentos/${colab.id}/espelho-ponto-${anoMes}-${Date.now()}.pdf`;
  const { error: errUp } = await db.storage.from("rh").upload(storagePath, pdf, { contentType: "application/pdf", upsert: false });
  if (errUp) return { ok: false, colaborador: nome, anoMes, motivo: `Falha ao guardar o arquivo: ${errUp.message}` };

  // já existe espelho deste mês? então substitui, para não duplicar
  const { data: antigos } = await db.from("rh_documentos")
    .select("id, storage_path").eq("colaborador_id", colab.id).eq("titulo", titulo);
  const substituiu = !!(antigos && antigos.length);

  const { data: novo, error } = await db.from("rh_documentos").insert({
    colaborador_id: colab.id, titulo, tipo: "outro", storage_path: storagePath,
    validade_na: true, criado_por: autor,
    observacoes: `Gerado automaticamente a partir da ControliD. Competência ${anoMes}.`,
  }).select("id").single();
  if (error) {
    await db.storage.from("rh").remove([storagePath]).catch(() => {}); // rollback
    return { ok: false, colaborador: nome, anoMes, motivo: error.message };
  }

  if (substituiu) {
    for (const a of antigos as any[]) {
      if (a.storage_path) await db.storage.from("rh").remove([a.storage_path]).catch(() => {});
      await db.from("rh_documentos").delete().eq("id", a.id);
    }
  }

  return { ok: true, colaborador: nome, anoMes, documentoId: (novo as any).id, substituiu, dias: dias.length };
}

/** Colaboradores que entram na geração: ativos, com ponto (CLT/sócio). */
export async function colaboradoresComPonto(db: any, ids?: string[]) {
  let q = db.from("rh_colaboradores")
    .select("id, nome, cpf, cargo, data_admissao, regime, status, rhid_person_id")
    .neq("status", "desligado");
  if (ids?.length) q = q.in("id", ids);
  else q = q.in("regime", ["clt", "socio"]);
  const { data } = await q.order("nome");
  return (data || []) as any[];
}

/** Lista de pessoas da ControliD (uma chamada só, reaproveitada no lote). */
export async function pessoasControliD() {
  try { return await listarPessoas(); } catch { return []; }
}
