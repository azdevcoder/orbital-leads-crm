import { describe, expect, it } from "vitest";
import { checkSearchQuota, planOf, todayKey, type QuotaUser } from "../shared/plans";

function user(overrides: Partial<QuotaUser> = {}): QuotaUser {
  return {
    plan: "free",
    quotaDay: null,
    dailySearches: 0,
    dailyLeads: 0,
    totalSearches: 0,
    totalLeads: 0,
    ...overrides,
  };
}

describe("catálogo de planos", () => {
  it("resolve plano desconhecido para o Grátis", () => {
    expect(planOf("inexistente").id).toBe("free");
    expect(planOf(null).id).toBe("free");
  });

  it("expõe os quatro planos com preços esperados", async () => {
    const { PLANS } = await import("../shared/plans");
    expect(PLANS.start.price).toBe(29.99);
    expect(PLANS.plus.price).toBe(49.99);
    expect(PLANS.scale.price).toBe(99.99);
    expect(PLANS.start.searchesPerDay).toBeNull();
    expect(PLANS.start.leadsPerDay).toBe(50);
  });
});

describe("recursos por plano", () => {
  it("Start tem só busca e lista; WhatsApp é Plus/Scale", async () => {
    const { planHasCrm, planHasExport, planHasWhatsapp } = await import("../shared/plans");
    expect(planHasCrm("start")).toBe(false);
    expect(planHasExport("start")).toBe(false);
    expect(planHasWhatsapp("start")).toBe(false);
    expect(planHasCrm("free")).toBe(true);
    expect(planHasExport("free")).toBe(true);
    expect(planHasWhatsapp("free")).toBe(true);
    expect(planHasWhatsapp("start")).toBe(false);
    expect(planHasWhatsapp("plus")).toBe(true);
    expect(planHasCrm("scale")).toBe(true);
  });
});

describe("cota de buscas", () => {
  it("Grátis: permite capturar até 10 leads no total", () => {
    expect(checkSearchQuota(user()).allowed).toBe(true);
    expect(checkSearchQuota(user({ totalLeads: 9 }))).toEqual(
      expect.objectContaining({ allowed: true, maxResults: 10 })
    );
  });

  it("Grátis: bloqueia ao somar 10 leads vitalícios", () => {
    const check = checkSearchQuota(user({ totalLeads: 10, totalSearches: 3 }));
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/10 leads no total/);
  });

  it("Start: buscas ilimitadas até 50 leads no dia", () => {
    const today = todayKey();
    expect(
      checkSearchQuota(user({ plan: "start", quotaDay: today, dailySearches: 500, dailyLeads: 49 })).allowed
    ).toBe(true);
    const blocked = checkSearchQuota(user({ plan: "start", quotaDay: today, dailySearches: 500, dailyLeads: 50 }));
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/50.*leads por dia/);
  });

  it("Plus: 100 leads por dia", () => {
    const today = todayKey();
    expect(checkSearchQuota(user({ plan: "plus", quotaDay: today, dailyLeads: 99 })).allowed).toBe(true);
    expect(checkSearchQuota(user({ plan: "plus", quotaDay: today, dailyLeads: 100 })).allowed).toBe(false);
  });

  it("vira o dia e zera os contadores diários", () => {
    const check = checkSearchQuota(user({ plan: "start", quotaDay: "2000-01-01", dailySearches: 500, dailyLeads: 50 }));
    expect(check.allowed).toBe(true);
    expect(check.leadsLeft).toBe(50);
  });

  it("conta da padaria: custo por lead truncado em 3 casas", async () => {
    const { planEconomics, PLANS } = await import("../shared/plans");
    expect(planEconomics(PLANS.start)).toContain("1.500 leads/mês");
    expect(planEconomics(PLANS.start)).toContain("R$ 0,019 por lead");
    expect(planEconomics(PLANS.plus)).toContain("3.000 leads/mês");
    expect(planEconomics(PLANS.plus)).toContain("R$ 0,016 por lead");
    expect(planEconomics(PLANS.free)).toBeNull();
    expect(planEconomics(PLANS.scale)).toBeNull();
  });

  it("Scale: ilimitado com 20 resultados por busca", () => {
    const check = checkSearchQuota(user({ plan: "scale", quotaDay: todayKey(), dailySearches: 500, dailyLeads: 9000 }));
    expect(check.allowed).toBe(true);
    expect(check.maxResults).toBe(20);
    expect(check.searchesLeft).toBeNull();
    expect(check.leadsLeft).toBeNull();
  });
});
