/**
 * Catálogo de planos e regras de cota do Orbital Leads CRM.
 * Partilhado entre servidor (fiscalização) e cliente (página de vendas, banners).
 */

export const PLAN_IDS = ["free", "start", "plus", "scale"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanInfo = {
  id: PlanId;
  name: string;
  price: number; // R$/mês
  tagline: string;
  /** Buscas por dia (null = ilimitado, exceto free que usa lifetimeSearches). */
  searchesPerDay: number | null;
  /** Leads capturados por dia (null = ilimitado). */
  leadsPerDay: number | null;
  /** Máximo de resultados por busca. */
  maxPerSearch: number;
  /** Total de buscas na vida da conta (só o free usa; null = sem teto vitalício). */
  lifetimeSearches: number | null;
  features: string[];
};

export const PLANS: Record<PlanId, PlanInfo> = {
  free: {
    id: "free",
    name: "Grátis",
    price: 0,
    tagline: "Para experimentar a órbita",
    searchesPerDay: null,
    leadsPerDay: null,
    maxPerSearch: 10,
    lifetimeSearches: 1,
    features: [
      "1 busca com até 10 leads",
      "CRM completo com Kanban",
      "Exportação CSV e XLSX",
    ],
  },
  start: {
    id: "start",
    name: "Start",
    price: 29.9,
    tagline: "Para quem prospecta todo dia",
    searchesPerDay: 50,
    leadsPerDay: 1000,
    maxPerSearch: 20,
    lifetimeSearches: null,
    features: [
      "Até 50 buscas por dia",
      "Até 1.000 leads por dia",
      "Lista de leads com filtros",
    ],
  },
  plus: {
    id: "plus",
    name: "Plus",
    price: 49.9,
    tagline: "Para operações em escala",
    searchesPerDay: 100,
    leadsPerDay: 2000,
    maxPerSearch: 20,
    lifetimeSearches: null,
    features: [
      "Até 100 buscas por dia",
      "Até 2.000 leads por dia",
      "CRM completo com Kanban",
      "Ação direta no WhatsApp",
      "Exportação CSV e XLSX",
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    price: 99.9,
    tagline: "Prospecção sem teto",
    searchesPerDay: null,
    leadsPerDay: null,
    maxPerSearch: 20,
    lifetimeSearches: null,
    features: [
      "Buscas ilimitadas",
      "Leads ilimitados",
      "CRM completo com Kanban",
      "Ação direta no WhatsApp",
      "Exportação CSV e XLSX",
      "Suporte prioritário",
    ],
  },
};

export function planOf(id: string | null | undefined): PlanInfo {
  if (id && (PLAN_IDS as readonly string[]).includes(id)) return PLANS[id as PlanId];
  return PLANS.free;
}

export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type QuotaUser = {
  plan: string | null;
  quotaDay: string | null;
  dailySearches: number | null;
  dailyLeads: number | null;
  totalSearches: number | null;
};

export type QuotaCheck = {
  allowed: boolean;
  reason?: string;
  maxResults: number;
  plan: PlanInfo;
  /** null = ilimitado */
  searchesLeft: number | null;
  /** null = ilimitado */
  leadsLeft: number | null;
};

export function checkSearchQuota(user: QuotaUser, now: Date = new Date()): QuotaCheck {
  const plan = planOf(user.plan);
  const sameDay = (user.quotaDay ?? "") === todayKey(now);
  const dailySearches = sameDay ? (user.dailySearches ?? 0) : 0;
  const dailyLeads = sameDay ? (user.dailyLeads ?? 0) : 0;
  const totalSearches = user.totalSearches ?? 0;

  if (plan.lifetimeSearches !== null && totalSearches >= plan.lifetimeSearches) {
    return {
      allowed: false,
      reason: "O plano Grátis permite apenas 1 busca de até 10 leads. Fale com o time Orbital para ativar um plano pago.",
      maxResults: plan.maxPerSearch,
      plan,
      searchesLeft: 0,
      leadsLeft: 0,
    };
  }
  if (plan.searchesPerDay !== null && dailySearches >= plan.searchesPerDay) {
    return {
      allowed: false,
      reason: `Limite do plano ${plan.name} atingido (${plan.searchesPerDay} buscas por dia). Tente amanhã ou peça um upgrade.`,
      maxResults: plan.maxPerSearch,
      plan,
      searchesLeft: 0,
      leadsLeft:
        plan.leadsPerDay !== null ? Math.max(0, plan.leadsPerDay - dailyLeads) : null,
    };
  }
  if (plan.leadsPerDay !== null && dailyLeads >= plan.leadsPerDay) {
    return {
      allowed: false,
      reason: `Limite do plano ${plan.name} atingido (${plan.leadsPerDay.toLocaleString("pt-BR")} leads por dia). Tente amanhã ou peça um upgrade.`,
      maxResults: plan.maxPerSearch,
      plan,
      searchesLeft:
        plan.searchesPerDay !== null ? Math.max(0, plan.searchesPerDay - dailySearches) : null,
      leadsLeft: 0,
    };
  }
  return {
    allowed: true,
    maxResults: plan.maxPerSearch,
    plan,
    searchesLeft: plan.searchesPerDay !== null ? plan.searchesPerDay - dailySearches : null,
    leadsLeft: plan.leadsPerDay !== null ? plan.leadsPerDay - dailyLeads : null,
  };
}

export function formatPrice(value: number): string {
  return value === 0 ? "Grátis" : `R$ ${value.toFixed(2).replace(".", ",")}`;
}

/** Recursos por plano: Start tem só busca + lista. */
export function planHasCrm(plan: string | null | undefined): boolean {
  return planOf(plan).id !== "start";
}

export function planHasExport(plan: string | null | undefined): boolean {
  return planOf(plan).id !== "start";
}

export function planHasWhatsapp(plan: string | null | undefined): boolean {
  const id = planOf(plan).id;
  return id === "plus" || id === "scale";
}
