// Catálogo de especialidades e tipos de cliente do marketplace de manutenção.
// Fonte ÚNICA — usada no cadastro do prestador, na avaliação técnica, no ranking
// e (futuramente) no matching com o chamado do cliente.

export type Especialidade = {
  key: string;
  label: string;
  icon: string;
  nr?: string; // NR/habilitação recomendada para o selo (ex.: elétrica → NR-10)
};

export const ESPECIALIDADES: Especialidade[] = [
  { key: "eletrica", label: "Elétrica", icon: "⚡", nr: "NR-10" },
  { key: "hidraulica", label: "Hidráulica", icon: "🚰" },
  { key: "pintura", label: "Pintura", icon: "🎨" },
  { key: "alvenaria", label: "Alvenaria / Pedreiro", icon: "🧱" },
  { key: "ar_condicionado", label: "Ar-condicionado / Refrigeração", icon: "❄️" },
  { key: "serralheria", label: "Serralheria / Marcenaria", icon: "🪚" },
  { key: "limpeza_pos_obra", label: "Limpeza pós-obra", icon: "🧽" },
];

export const TIPOS_CLIENTE = [
  { key: "residencia", label: "Residências" },
  { key: "condominio", label: "Condomínios" },
  { key: "comercial", label: "Edifícios comerciais" },
];

export const ESP_KEYS = ESPECIALIDADES.map((e) => e.key);
export const TIPO_CLIENTE_KEYS = TIPOS_CLIENTE.map((t) => t.key);

export const espLabel = (k: string) => ESPECIALIDADES.find((e) => e.key === k)?.label || k;
export const espIcon = (k: string) => ESPECIALIDADES.find((e) => e.key === k)?.icon || "🛠️";
export const espValida = (k: string) => ESP_KEYS.includes(k);
export const tipoClienteLabel = (k: string) => TIPOS_CLIENTE.find((t) => t.key === k)?.label || k;
