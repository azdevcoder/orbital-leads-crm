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
    expect(mapMocks.searchPlacesNew).toHaveBeenCalledWith("Restaurantes em Porto, PT", 20, undefined);
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

  it("pagina até o limite escolhido pelo usuário (Scale até 50)", async () => {
    const page = (from: number, count: number, next?: string) => ({
      places: Array.from({ length: count }, (_, i) => ({
        id: `place-${from + i}`,
        displayName: { text: `Empresa ${from + i}` },
        formattedAddress: "Rua X, Porto",
      })),
      ...(next ? { nextPageToken: next } : {}),
    });
    mapMocks.searchPlacesNew
      .mockResolvedValueOnce(page(1, 20, "tok-2"))
      .mockResolvedValueOnce(page(21, 10));
    dbMocks.upsertCapturedLeads.mockResolvedValue(30);
    const caller = appRouter.createCaller(protectedContext());

    const result = await caller.places.search({ segment: "Restaurantes", city: "Porto", state: "PT", limit: 30 });

    expect(result).toEqual({ saved: 30, query: "Restaurantes em Porto, PT" });
    expect(mapMocks.searchPlacesNew).toHaveBeenCalledTimes(2);
    expect(mapMocks.searchPlacesNew).toHaveBeenNthCalledWith(1, "Restaurantes em Porto, PT", 20, undefined);
    expect(mapMocks.searchPlacesNew).toHaveBeenNthCalledWith(2, "Restaurantes em Porto, PT", 10, "tok-2");
    expect(dbMocks.upsertCapturedLeads).toHaveBeenCalledWith("tenant-places", expect.arrayContaining([
      expect.objectContaining({ placeId: "place-1" }),
      expect.objectContaining({ placeId: "place-30" }),
    ]));
    expect(dbMocks.recordSearchUsage).toHaveBeenCalledWith("tenant-places", 30);
  });

  it("limita ao teto do plano mesmo pedindo mais", async () => {
    mapMocks.searchPlacesNew.mockResolvedValue({ places: [] });
    const caller = appRouter.createCaller({
      ...protectedContext(),
      user: { ...protectedContext().user, plan: "start" },
    });

    await caller.places.search({ segment: "Restaurantes", city: "Porto", state: "PT", limit: 50 });

    // Start: teto 20 por busca
    expect(mapMocks.searchPlacesNew).toHaveBeenCalledWith("Restaurantes em Porto, PT", 20, undefined);
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
