/**
 * Catálogo de planos e regras de cota do Orbital Leads CRM.
 * Partilhado entre servidor (fiscalização) e cliente (página de vendas, banners).
 */

export const PLAN_IDS = ["free", "start", "plus", "scale", "plus_annual", "scale_annual", "lifetime"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanInfo = {
  id: PlanId;
  name: string;
  price: number; // R$ por ciclo de cobrança
  /** Meses pagos no ciclo (1 = mensal, 12 = anual, null = vitalício). */
  billingMonths: number | null;
  tagline: string;
  /** Dias de validade por compra (null = nunca expira). */
  validDays: number | null;
  /** Buscas por dia (null = ilimitado). */
  searchesPerDay: number | null;
  /** Leads capturados por dia (null = ilimitado). */
  leadsPerDay: number | null;
  /** Máximo de resultados por busca. */
  maxPerSearch: number;
  /** Total de leads na vida da conta (só o free usa; null = sem teto vitalício). */
  lifetimeLeads: number | null;
  features: string[];
};

export const PLANS: Record<PlanId, PlanInfo> = {
  free: {
    id: "free",
    name: "Grátis",
    price: 0,
    billingMonths: null,
    tagline: "Para experimentar a órbita",
    searchesPerDay: null,
    leadsPerDay: null,
    maxPerSearch: 10,
    lifetimeLeads: 10,
    validDays: null,
    features: [
      "10 leads grátis no total",
      "CRM completo com Kanban",
      "Ação direta no WhatsApp",
      "Exportação CSV e XLSX",
    ],
  },
  start: {
    id: "start",
    name: "Start",
    price: 29.99,
    billingMonths: 1,
    tagline: "Para quem prospecta todo dia",
    searchesPerDay: null,
    leadsPerDay: 50,
    maxPerSearch: 20,
    lifetimeLeads: null,
    validDays: 30,
    features: [
      "Até 50 leads por dia",
      "Lista de leads com filtros",
    ],
  },
  plus: {
    id: "plus",
    name: "Plus",
    price: 49.99,
    billingMonths: 1,
    tagline: "Para operações em escala",
    searchesPerDay: null,
    leadsPerDay: 100,
    maxPerSearch: 20,
    lifetimeLeads: null,
    validDays: 30,
    features: [
      "Até 100 leads por dia",
      "CRM completo com Kanban",
      "Ação direta no WhatsApp",
      "Exportação CSV e XLSX",
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    price: 99.99,
    billingMonths: 1,
    tagline: "Prospecção sem teto",
    searchesPerDay: null,
    leadsPerDay: null,
    maxPerSearch: 50,
    lifetimeLeads: null,
    validDays: 30,
    features: [
      "Buscas ilimitadas",
      "Leads ilimitados",
      "CRM completo com Kanban",
      "Ação direta no WhatsApp",
      "Exportação CSV e XLSX",
      "Suporte prioritário",
    ],
  },
  plus_annual: {
    id: "plus_annual",
    name: "Plus Anual",
    price: 499.9,
    billingMonths: 12,
    tagline: "Um ano de operação em escala",
    searchesPerDay: null,
    leadsPerDay: 100,
    maxPerSearch: 20,
    lifetimeLeads: null,
    validDays: 365,
    features: [
      "Até 100 leads por dia, por 12 meses",
      "CRM completo com Kanban",
      "Ação direta no WhatsApp",
      "Exportação CSV e XLSX",
      "2 meses de desconto no ano",
    ],
  },
  scale_annual: {
    id: "scale_annual",
    name: "Scale Anual",
    price: 999.9,
    billingMonths: 12,
    tagline: "Um ano sem teto",
    searchesPerDay: null,
    leadsPerDay: null,
    maxPerSearch: 50,
    lifetimeLeads: null,
    validDays: 365,
    features: [
      "Buscas ilimitadas por 12 meses",
      "Leads ilimitados por 12 meses",
      "CRM completo com Kanban",
      "Ação direta no WhatsApp",
      "Exportação CSV e XLSX",
      "Suporte prioritário",
    ],
  },
  lifetime: {
    id: "lifetime",
    name: "Vitalício",
    price: 1999,
    billingMonths: null,
    tagline: "Acesso para sempre, pagamento único",
    searchesPerDay: null,
    leadsPerDay: null,
    maxPerSearch: 50,
    lifetimeLeads: null,
    validDays: null,
    features: [
      "Buscas ilimitadas para sempre",
      "Leads ilimitados para sempre",
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

export const PLAN_DURATION_DAYS = 30;

export type QuotaUser = {
  plan: string | null;
  planExpiresAt: Date | string | null;
  quotaDay: string | null;
  dailySearches: number | null;
  dailyLeads: number | null;
  totalSearches: number | null;
  totalLeads: number | null;
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
  /** leads restantes no total (só planos vitalícios como o Grátis) */
  totalLeadsLeft: number | null;
  /** true quando o plano pago venceu */
  expired: boolean;
  planExpiresAt: Date | string | null;
};

export function checkSearchQuota(user: QuotaUser, now: Date = new Date()): QuotaCheck {
  const plan = planOf(user.plan);
  const sameDay = (user.quotaDay ?? "") === todayKey(now);
  const dailySearches = sameDay ? (user.dailySearches ?? 0) : 0;
  const dailyLeads = sameDay ? (user.dailyLeads ?? 0) : 0;
  const totalLeads = user.totalLeads ?? 0;

  // Plano pago vencido volta a valer como Grátis (sem cron: calculado a cada chamada).
  const expiry = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : null;
  if (plan.id !== "free" && expiry !== null && expiry <= now.getTime()) {
    return {
      allowed: totalLeads < (PLANS.free.lifetimeLeads ?? 10),
      reason: `Seu plano ${plan.name} venceu em ${new Date(expiry).toLocaleDateString("pt-BR")}. Renove para continuar capturando sem limites.`,
      maxResults: PLANS.free.maxPerSearch,
      plan,
      expired: true,
      planExpiresAt: user.planExpiresAt,
      searchesLeft: null,
      leadsLeft: null,
      totalLeadsLeft: Math.max(0, (PLANS.free.lifetimeLeads ?? 10) - totalLeads),
    };
  }

  if (plan.lifetimeLeads !== null && totalLeads >= plan.lifetimeLeads) {
    return {
      allowed: false,
      reason: `O plano Grátis inclui ${plan.lifetimeLeads} leads no total. Fale com o time Orbital para ativar um plano pago.`,
      maxResults: plan.maxPerSearch,
      plan,
      searchesLeft: null,
      leadsLeft: 0,
      totalLeadsLeft: 0,
      expired: false,
      planExpiresAt: null,
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
      totalLeadsLeft: null,
      expired: false,
      planExpiresAt: null,
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
      totalLeadsLeft: null,
      expired: false,
      planExpiresAt: null,
    };
  }
  return {
    allowed: true,
    maxResults: plan.maxPerSearch,
    plan,
    searchesLeft: plan.searchesPerDay !== null ? plan.searchesPerDay - dailySearches : null,
    leadsLeft: plan.leadsPerDay !== null ? plan.leadsPerDay - dailyLeads : null,
    totalLeadsLeft: plan.lifetimeLeads !== null ? Math.max(0, plan.lifetimeLeads - totalLeads) : null,
    expired: false,
    planExpiresAt: user.planExpiresAt ?? null,
  };
}

export function formatPrice(value: number): string {
  return value === 0 ? "Grátis" : `R$ ${value.toFixed(2).replace(".", ",")}`;
}

/** Conta da padaria: leads/dia × dias pagos = leads no período e custo por lead. */
export function planEconomics(plan: PlanInfo): string | null {
  if (plan.leadsPerDay === null || plan.price <= 0 || plan.billingMonths === null) return null;
  const days = 30 * plan.billingMonths;
  const total = plan.leadsPerDay * days;
  const perLead = Math.floor((plan.price / total) * 1000) / 1000;
  const period = plan.billingMonths === 1 ? "mês" : "ano";
  return (
    `${plan.leadsPerDay} leads/dia × ${days} dias = ${total.toLocaleString("pt-BR")} leads/${period === "mês" ? "mês" : "ano"} · ` +
    `R$ ${plan.price.toFixed(2).replace(".", ",")} / ${total.toLocaleString("pt-BR")} = ` +
    `R$ ${perLead.toFixed(3).replace(".", ",")} por lead`
  );
}

/** Sufixo do preço: /mês, /ano ou pagamento único. */
export function priceSuffix(plan: PlanInfo): string {
  if (plan.price <= 0) return "";
  if (plan.billingMonths === null) return "pagamento único";
  return plan.billingMonths === 1 ? "/mês" : "/ano";
}

/** Recursos por plano: Start tem só busca + lista. */
export function planHasCrm(plan: string | null | undefined): boolean {
  return planOf(plan).id !== "start";
}

export function planHasExport(plan: string | null | undefined): boolean {
  return planOf(plan).id !== "start";
}

export function planHasWhatsapp(plan: string | null | undefined): boolean {
  return planOf(plan).id !== "start";
}
