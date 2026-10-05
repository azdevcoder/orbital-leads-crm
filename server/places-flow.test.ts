import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  upsertCapturedLeads: vi.fn(),
  createSearchHistory: vi.fn(),
  recordSearchUsage: vi.fn(),
}));
const mapMocks = vi.hoisted(() => ({ searchPlacesNew: vi.fn() }));

vi.mock("./db", () => dbMocks);
vi.mock("./_core/map", () => mapMocks);

import { appRouter } from "./routers";

function protectedContext(): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "tenant-places",
      name: "Conta de teste",
      email: "conta@empresa.pt",
      phone: "+351 220 000 000",
      passwordHash: "hash",
      loginMethod: "email",
      role: "user",
      plan: "scale",
      quotaDay: null,
      dailySearches: 0,
      dailyLeads: 0,
      totalSearches: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("captura Google Places", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.upsertCapturedLeads.mockResolvedValue(1);
    dbMocks.createSearchHistory.mockResolvedValue(undefined);
  });

  it("consulta, normaliza e guarda resultados exclusivamente no tenant da sessão", async () => {
    mapMocks.searchPlacesNew.mockResolvedValue({
      places: [{
        id: "place-1",
        displayName: { text: "Estabelecimento de teste" },
        formattedAddress: "Rua de Teste, Porto",
        internationalPhoneNumber: "+351 220 000 000",
        websiteUri: "https://exemplo.test",
        rating: 4.5,
        businessStatus: "OPERATIONAL",
      }],
    });
    const caller = appRouter.createCaller(protectedContext());

    const result = await caller.places.search({ segment: "Restaurantes", city: "Porto", state: "PT" });

    expect(result).toEqual({ saved: 1, query: "Restaurantes em Porto, PT" });
    expect(mapMocks.searchPlacesNew).toHaveBeenCalledWith("Restaurantes em Porto, PT", 20);
    expect(dbMocks.upsertCapturedLeads).toHaveBeenCalledWith("tenant-places", [expect.objectContaining({
      placeId: "place-1",
      name: "Estabelecimento de teste",
      phone: "+351 220 000 000",
      fullAddress: "Rua de Teste, Porto",
      website: "https://exemplo.test",
      businessStatus: "Aberto",
      segment: "Restaurantes",
      city: "Porto",
      state: "PT",
    })]);
    expect(dbMocks.recordSearchUsage).toHaveBeenCalledWith("tenant-places", 1);
    expect(dbMocks.createSearchHistory).toHaveBeenCalledWith({
      tenantId: "tenant-places",
      segment: "Restaurantes",
      city: "Porto",
      state: "PT",
      resultCount: 1,
    });
  });

  it("bloqueia a busca quando a cota do plano esgota, sem chamar o Google", async () => {
    const caller = appRouter.createCaller({
      ...protectedContext(),
      user: { ...protectedContext().user, plan: "free", totalSearches: 4, totalLeads: 10 },
    });

    await expect(
      caller.places.search({ segment: "Restaurantes", city: "Porto", state: "PT" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mapMocks.searchPlacesNew).not.toHaveBeenCalled();
    expect(dbMocks.recordSearchUsage).not.toHaveBeenCalled();
  });
});
