// Pesquisa de Clima / eNPS — dimensões e cálculo.

export const DIMENSOES: { k: string; t: string }[] = [
  { k: "ambiente", t: "Ambiente de trabalho" },
  { k: "lideranca", t: "Liderança e gestão" },
  { k: "reconhecimento", t: "Reconhecimento e valorização" },
  { k: "comunicacao", t: "Comunicação interna" },
  { k: "desenvolvimento", t: "Oportunidades de desenvolvimento" },
  { k: "equilibrio", t: "Equilíbrio entre vida e trabalho" },
];

// eNPS = % promotores (9-10) − % detratores (0-6). Passivos = 7-8.
export function calcularEnps(notas: number[]): { score: number; promotores: number; passivos: number; detratores: number; total: number } {
  const vals = notas.filter((n) => typeof n === "number" && n >= 0 && n <= 10);
  const total = vals.length;
  if (!total) return { score: 0, promotores: 0, passivos: 0, detratores: 0, total: 0 };
  const promotores = vals.filter((n) => n >= 9).length;
  const detratores = vals.filter((n) => n <= 6).length;
  const passivos = total - promotores - detratores;
  const score = Math.round(((promotores - detratores) / total) * 100);
  return { score, promotores, passivos, detratores, total };
}
