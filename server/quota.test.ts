import { describe, expect, it } from "vitest";
import { checkSearchQuota, planOf, todayKey, type QuotaUser } from "../shared/plans";

function user(overrides: Partial<QuotaUser> = {}): QuotaUser {
  return {
    plan: "free",
    quotaDay: null,
    dailySearches: 0,
    dailyLeads: 0,
    totalSearches: 0,
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
    expect(PLANS.start.price).toBe(29.9);
    expect(PLANS.growth.price).toBe(49.9);
    expect(PLANS.scale.price).toBe(99.9);
    expect(PLANS.start.searchesPerDay).toBe(50);
    expect(PLANS.start.leadsPerDay).toBe(1000);
  });
});

describe("cota de buscas", () => {
  it("Grátis: permite a primeira busca limitada a 10 leads", () => {
    const check = checkSearchQuota(user());
    expect(check.allowed).toBe(true);
    expect(check.maxResults).toBe(10);
  });

  it("Grátis: bloqueia a segunda busca vitalícia", () => {
    const check = checkSearchQuota(user({ totalSearches: 1 }));
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/grátis/i);
  });

  it("Start: permite dentro do limite e bloqueia na 51ª busca do dia", () => {
    const today = todayKey();
    expect(checkSearchQuota(user({ plan: "start", quotaDay: today, dailySearches: 49 })).allowed).toBe(true);
    const blocked = checkSearchQuota(user({ plan: "start", quotaDay: today, dailySearches: 50 }));
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/50 buscas/);
  });

  it("Start: bloqueia ao atingir 1000 leads no dia", () => {
    const today = todayKey();
    const check = checkSearchQuota(user({ plan: "start", quotaDay: today, dailySearches: 3, dailyLeads: 1000 }));
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/leads por dia/);
  });

  it("vira o dia e zera os contadores diários", () => {
    const check = checkSearchQuota(user({ plan: "start", quotaDay: "2000-01-01", dailySearches: 50, dailyLeads: 1000 }));
    expect(check.allowed).toBe(true);
    expect(check.searchesLeft).toBe(50);
  });

  it("Scale: ilimitado com 20 resultados por busca", () => {
    const check = checkSearchQuota(user({ plan: "scale", quotaDay: todayKey(), dailySearches: 500, dailyLeads: 9000 }));
    expect(check.allowed).toBe(true);
    expect(check.maxResults).toBe(20);
    expect(check.searchesLeft).toBeNull();
    expect(check.leadsLeft).toBeNull();
  });
});
