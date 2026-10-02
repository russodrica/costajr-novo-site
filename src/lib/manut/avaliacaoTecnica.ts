// Banco de perguntas da AVALIAÇÃO TÉCNICA do prestador, por especialidade.
// A correção é 100% no servidor — `sortearProva()` devolve as perguntas SEM o
// gabarito; `corrigir()` compara contra o `correta` que nunca sai daqui.
//
// IMPORTANTE: este banco foi redigido a partir de normas (NBR 5410, NBR 8160/5626,
// NR-10/NR-35, Lei 13.589/2018 do PMOC) e boas práticas — DEVE ser revisado por um
// responsável técnico da Costa Júnior e ampliado com o tempo. Corte de aprovação 70%.

export type Pergunta = { id: string; q: string; alt: string[]; correta: number };

export const CORTE = 70; // % mínimo para APROVAR na especialidade
export const QTD_PROVA = 8; // nº de perguntas sorteadas por prova

const BANCO: Record<string, Pergunta[]> = {
  eletrica: [
    { id: "ele1", q: "Qual a cor padrão (NBR 5410) do condutor de proteção (fio terra)?", alt: ["Azul-claro", "Vermelho", "Verde ou verde-amarelo", "Preto"], correta: 2 },
    { id: "ele2", q: "O disjuntor DR (diferencial-residual) protege principalmente contra:", alt: ["Sobrecarga", "Choque elétrico / correntes de fuga à terra", "Surto atmosférico", "Apenas curto-circuito"], correta: 1 },
    { id: "ele3", q: "Seção mínima de condutor para um circuito de tomadas de uso geral (NBR 5410):", alt: ["1,0 mm²", "1,5 mm²", "2,5 mm²", "4,0 mm²"], correta: 2 },
    { id: "ele4", q: "Corrente aproximada de um chuveiro de 7500 W ligado em 220 V (I = P/V):", alt: ["15 A", "~34 A", "68 A", "110 A"], correta: 1 },
    { id: "ele5", q: "Antes de intervir em um circuito, a NR-10 exige:", alt: ["Só desligar a chave geral", "Desenergizar e testar a ausência de tensão", "Usar luva de pano", "Apenas avisar o cliente"], correta: 1 },
    { id: "ele6", q: "O disjuntor termomagnético protege o circuito contra:", alt: ["Apenas choque", "Sobrecarga e curto-circuito", "Apenas surto", "Apenas fuga à terra"], correta: 1 },
    { id: "ele7", q: "O terceiro pino (terra) de uma tomada 2P+T serve para:", alt: ["Aumentar a potência", "Escoar corrente de fuga e proteger contra choque", "Ligar o neutro", "Nada, é decorativo"], correta: 1 },
    { id: "ele8", q: "Para medir a tensão de uma tomada, o multímetro deve estar na posição:", alt: ["Resistência (Ω)", "Corrente (A)", "Tensão alternada (Vca)", "Tensão contínua (Vcc)"], correta: 2 },
  ],
  hidraulica: [
    { id: "hid1", q: "Tubulação adequada para conduzir água QUENTE:", alt: ["PVC soldável comum", "CPVC ou PPR", "PVC de esgoto", "Mangueira de PE"], correta: 1 },
    { id: "hid2", q: "A função do sifão (sob a pia) é:", alt: ["Aumentar a pressão", "Reter água e barrar gases/odores do esgoto", "Filtrar resíduos", "Apenas reduzir ruído"], correta: 1 },
    { id: "hid3", q: "Declividade mínima de um ramal de esgoto horizontal DN100 (NBR 8160):", alt: ["0,5%", "1%", "5%", "Não precisa"], correta: 1 },
    { id: "hid4", q: "Como detectar um vazamento interno (embutido) sem abrir a parede?", alt: ["Olhar a conta de água", "Fechar todos os pontos e observar o hidrômetro girando", "Trocar o registro", "Aumentar a pressão"], correta: 1 },
    { id: "hid5", q: "Vedação correta de uma conexão de rosca metálica para água:", alt: ["Cola de PVC", "Fita veda-rosca ou pasta vedante", "Silicone comum", "Nada"], correta: 1 },
    { id: "hid6", q: "Para unir corretamente tubos de PVC soldável, deve-se:", alt: ["Só encaixar", "Lixar, aplicar adesivo (cola) e encaixar", "Aquecer e dobrar", "Parafusar"], correta: 1 },
    { id: "hid7", q: "A caixa d'água fica ACIMA dos pontos de consumo para garantir:", alt: ["Economia de material", "Pressão por gravidade", "Água mais quente", "Menos ruído"], correta: 1 },
    { id: "hid8", q: "Antes de trocar um registro de gaveta, a primeira providência é:", alt: ["Abrir todas as torneiras", "Fechar o registro geral / cavalete", "Ligar a bomba", "Esvaziar a caixa d'água"], correta: 1 },
  ],
  pintura: [
    { id: "pin1", q: "A função do fundo selador em reboco/gesso novo é:", alt: ["Dar cor", "Uniformizar a absorção e selar a superfície para aderência", "Impermeabilizar laje", "Substituir a massa"], correta: 1 },
    { id: "pin2", q: "A massa corrida PVA pode ser usada em área externa/úmida?", alt: ["Não — usar massa acrílica", "Sim, sempre", "Só com verniz por cima", "Só depois de lixar"], correta: 0 },
    { id: "pin3", q: "Parede com mofo/bolor, antes de pintar, deve ser:", alt: ["Receber massa direto", "Tratada com solução fungicida/água sanitária e seca", "Apenas lixada", "Pintada com 3 demãos"], correta: 1 },
    { id: "pin4", q: "Número mínimo usual de demãos de tinta acrílica:", alt: ["1", "2 (com intervalo de secagem)", "4", "Indiferente"], correta: 1 },
    { id: "pin5", q: "Lixar entre demãos de verniz serve para:", alt: ["Remover a cor", "Melhorar a aderência e eliminar imperfeições", "Secar mais rápido", "Economizar produto"], correta: 1 },
    { id: "pin6", q: "Reboco novo deve curar (~28 dias) antes de pintar para evitar:", alt: ["Cheiro forte", "Manchas e descascamento por alcalinidade/umidade", "Gasto de tinta", "Nada muda"], correta: 1 },
    { id: "pin7", q: "Para proteger rodapés, vidros e tomadas durante a pintura usa-se:", alt: ["Jornal molhado", "Fita crepe (de pintor)", "Cola branca", "Verniz"], correta: 1 },
    { id: "pin8", q: "A tinta esmalte sintético é mais indicada para:", alt: ["Só alvenaria", "Madeiras e metais", "Só gesso", "Laje exposta"], correta: 1 },
  ],
  alvenaria: [
    { id: "alv1", q: "Tempo de cura do concreto para atingir a resistência nominal de projeto:", alt: ["7 dias", "14 dias", "28 dias", "60 dias"], correta: 2 },
    { id: "alv2", q: "Verga e contraverga sobre vãos de portas/janelas servem para:", alt: ["Estética", "Distribuir cargas e evitar trincas nos cantos do vão", "Nivelar o piso", "Fixar a esquadria"], correta: 1 },
    { id: "alv3", q: "A amarração (juntas desencontradas) dos tijolos, comparada à junta a prumo:", alt: ["É mais fraca", "Aumenta a resistência/estabilidade da parede", "É só decorativa", "Gasta mais sem ganho"], correta: 1 },
    { id: "alv4", q: "Traço típico de argamassa de assentamento (cimento : cal : areia):", alt: ["1 : 2 : 9 (ou 1 : 1 : 6)", "3 : 1 : 1", "Só cimento e água", "1 : 10 de cal, sem cimento"], correta: 0 },
    { id: "alv5", q: "Instrumentos para verificar verticalidade e horizontalidade de uma parede:", alt: ["Trena e esquadro", "Prumo e nível", "Desempenadeira", "Colher de pedreiro"], correta: 1 },
    { id: "alv6", q: "Para o reboco aderir melhor à alvenaria, aplica-se antes o:", alt: ["Selador", "Chapisco", "Gesso", "Verniz"], correta: 1 },
    { id: "alv7", q: "Antes de assentar, o tijolo cerâmico comum deve ser:", alt: ["Mantido seco", "Umedecido/molhado", "Aquecido", "Pintado"], correta: 1 },
    { id: "alv8", q: "A impermeabilização da primeira fiada / baldrame serve para:", alt: ["Nivelar", "Impedir a umidade de subir por capilaridade", "Dar cor", "Economizar tijolo"], correta: 1 },
  ],
  ar_condicionado: [
    { id: "arc1", q: "Fluido refrigerante que substituiu o R-22 (proibido por danos à camada de ozônio):", alt: ["R-12", "R-410A (ou R-32)", "R-22 reciclado", "CO₂ comum"], correta: 1 },
    { id: "arc2", q: "Fazer vácuo na instalação de um split serve para:", alt: ["Testar o compressor", "Remover ar e umidade das tubulações", "Carregar o gás", "Limpar o filtro"], correta: 1 },
    { id: "arc3", q: "A formação de gelo na serpentina da evaporadora costuma indicar:", alt: ["Excesso de gás", "Baixa carga de gás, filtro sujo ou baixo fluxo de ar", "Tensão alta", "Dreno novo"], correta: 1 },
    { id: "arc4", q: "Periodicidade recomendada de limpeza do filtro do ar-condicionado:", alt: ["Anual", "Mensal (a cada 15–30 dias)", "Nunca", "A cada 2 anos"], correta: 1 },
    { id: "arc5", q: "O PMOC (Lei 13.589/2018) é obrigatório em:", alt: ["Residência comum", "Ambientes de uso coletivo / climatização de grande porte", "Todo split", "Só em obra"], correta: 1 },
    { id: "arc6", q: "A distância máxima e o desnível entre as unidades interna e externa são definidos:", alt: ["Por norma única fixa", "Pelo fabricante / manual do equipamento", "Pelo instalador, livremente", "Pela cor do aparelho"], correta: 1 },
    { id: "arc7", q: "A unidade condensadora (externa) deve ser instalada em local:", alt: ["Fechado e abafado", "Ventilado, sem obstruir a saída de ar", "Dentro do ambiente", "Sob o sol forte, sem ventilação"], correta: 1 },
    { id: "arc8", q: "Água pingando da evaporadora para dentro do ambiente costuma indicar:", alt: ["Excesso de gás", "Dreno entupido ou mal caído", "Tensão baixa", "Filtro novo"], correta: 1 },
  ],
  serralheria: [
    { id: "ser1", q: "Processo de solda que usa gás de proteção e arame contínuo:", alt: ["Eletrodo revestido", "MIG/MAG", "Oxicorte", "Solda fria"], correta: 1 },
    { id: "ser2", q: "EPI indispensável ao usar esmerilhadeira/lixadeira:", alt: ["Só luva de pano", "Óculos de proteção (+ protetor auricular e luvas)", "Nenhum", "Boné"], correta: 1 },
    { id: "ser3", q: "Para embutir uma dobradiça de caneco (35 mm) em porta de MDF usa-se:", alt: ["Broca chata comum", "Broca Forstner (ou caneco)", "Serra tico-tico", "Formão"], correta: 1 },
    { id: "ser4", q: "Em área úmida, o MDF comum:", alt: ["É o ideal", "Incha — usar MDF resistente à umidade ou compensado naval", "É igual ao compensado", "Basta pintar"], correta: 1 },
    { id: "ser5", q: "O esquadro, na montagem de um móvel/esquadria, serve para:", alt: ["Medir comprimento", "Garantir o ângulo de 90°", "Nivelar", "Furar"], correta: 1 },
    { id: "ser6", q: "Disco adequado para CORTAR metal na esmerilhadeira:", alt: ["Disco de desbaste", "Disco de corte fino para metal", "Disco de madeira", "Lixa"], correta: 1 },
    { id: "ser7", q: "Antes de soldar uma peça pintada ou galvanizada, deve-se:", alt: ["Soldar por cima da tinta", "Remover a tinta/zinco da região (solda melhor e evita fumos tóxicos)", "Molhar a peça", "Aquecer o eletrodo"], correta: 1 },
    { id: "ser8", q: "Para fixar um portão em parede de concreto, o correto é furar com:", alt: ["Furadeira comum e broca de madeira", "Furadeira de impacto/martelete com broca para concreto", "Parafusadeira", "Prego e martelo"], correta: 1 },
  ],
  limpeza_pos_obra: [
    { id: "lim1", q: "A ordem correta de limpeza de um ambiente é:", alt: ["Do chão para o teto", "De cima para baixo e do fundo para a porta", "Aleatória", "Só o chão"], correta: 1 },
    { id: "lim2", q: "Misturar água sanitária com ácido ou amoníaco:", alt: ["Limpa mais", "NUNCA — libera gás tóxico (cloro)", "É recomendado", "Só com luva"], correta: 1 },
    { id: "lim3", q: "Para remover respingo de cimento de um piso cerâmico comum:", alt: ["Ácido muriático diluído, com EPI e ventilação (jamais em porcelanato polido)", "Água sanitária pura", "Palha de aço no porcelanato", "Lixa grossa"], correta: 0 },
    { id: "lim4", q: "EPI básico para trabalhar com produtos ácidos:", alt: ["Só avental", "Luvas, óculos, máscara e botas", "Nenhum", "Chinelo"], correta: 1 },
    { id: "lim5", q: "A primeira etapa da limpeza pós-obra é:", alt: ["Passar cera", "Remover entulho e detritos grossos", "Lavar vidros", "Aspirar o sofá"], correta: 1 },
    { id: "lim6", q: "Para remover respingo de tinta/gesso de um vidro, o correto é:", alt: ["Esfregar com palha de aço", "Usar espátula/lâmina e produto apropriado, sem riscar", "Jato de areia", "Lixa d'água"], correta: 1 },
    { id: "lim7", q: "O porcelanato POLIDO NÃO deve ser limpo com:", alt: ["Pano úmido", "Ácido ou abrasivo (palha de aço)", "Água e detergente neutro", "Rodo"], correta: 1 },
    { id: "lim8", q: "Piso de madeira/laminado deve ser limpo:", alt: ["Encharcando com água", "Com pano quase seco, sem encharcar", "Com ácido", "Com jato de água"], correta: 1 },
  ],
};

export function especialidadesComProva(): string[] {
  return Object.keys(BANCO);
}
export function temProva(esp: string): boolean {
  return Array.isArray(BANCO[esp]) && BANCO[esp].length > 0;
}

// Sorteia N perguntas (sem o gabarito) para o navegador.
export function sortearProva(esp: string, n: number = QTD_PROVA): { id: string; q: string; alt: string[] }[] {
  const banco = BANCO[esp] || [];
  const emb = [...banco].sort(() => Math.random() - 0.5).slice(0, Math.min(n, banco.length));
  return emb.map((p) => ({ id: p.id, q: p.q, alt: p.alt }));
}

export function nivelPorNota(nota: number): string {
  if (nota >= 85) return "avancado";
  if (nota >= CORTE) return "intermediario";
  return "reprovado";
}
export const NIVEL_LABEL: Record<string, string> = {
  avancado: "Avançado",
  intermediario: "Intermediário",
  reprovado: "Reprovado",
  nao_avaliado: "Não avaliado",
};

// Corrige um conjunto de respostas { idPergunta: indiceEscolhido }.
export function corrigir(esp: string, respostas: Record<string, number>): {
  total: number; acertos: number; nota: number; aprovado: boolean; nivel: string;
  detalhe: { id: string; escolhida: number | null; correta: number; acertou: boolean }[];
} {
  const banco = BANCO[esp] || [];
  // só considera as perguntas que foram enviadas (as sorteadas na prova)
  const feitas = banco.filter((p) => Object.prototype.hasOwnProperty.call(respostas, p.id));
  const total = feitas.length;
  const detalhe = feitas.map((p) => {
    const escolhida = Number.isInteger(respostas[p.id]) ? respostas[p.id] : null;
    return { id: p.id, escolhida, correta: p.correta, acertou: escolhida === p.correta };
  });
  const acertos = detalhe.filter((d) => d.acertou).length;
  const nota = total > 0 ? Math.round((acertos / total) * 100) : 0;
  const aprovado = nota >= CORTE;
  return { total, acertos, nota, aprovado, nivel: aprovado ? nivelPorNota(nota) : "reprovado", detalhe };
}
