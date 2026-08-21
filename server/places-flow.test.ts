import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  upsertCapturedLeads: vi.fn(),
  createSearchHistory: vi.fn(),
}));
const mapMocks = vi.hoisted(() => ({ makeRequest: vi.fn() }));

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
      passwordHash: "hash",
      loginMethod: "email",
      role: "user",
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
    mapMocks.makeRequest
      .mockResolvedValueOnce({
        status: "OK",
        results: [{
          place_id: "place-1",
          name: "Estabelecimento de teste",
          formatted_address: "Rua de Teste, Porto",
          business_status: "OPERATIONAL",
          types: ["restaurant"],
          geometry: { location: { lat: 0, lng: 0 } },
        }],
      })
      .mockResolvedValueOnce({
        status: "OK",
        result: {
          place_id: "place-1",
          name: "Estabelecimento de teste",
          formatted_address: "Rua de Teste, Porto",
          formatted_phone_number: "+351 220 000 000",
          website: "https://exemplo.test",
          geometry: { location: { lat: 0, lng: 0 } },
          opening_hours: { open_now: true, weekday_text: [] },
        },
      });
    const caller = appRouter.createCaller(protectedContext());

    const result = await caller.places.search({ segment: "Restaurantes", city: "Porto", state: "PT" });

    expect(result).toEqual({ saved: 1, query: "Restaurantes em Porto, PT" });
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
    expect(dbMocks.createSearchHistory).toHaveBeenCalledWith({
      tenantId: "tenant-places",
      segment: "Restaurantes",
      city: "Porto",
      state: "PT",
      resultCount: 1,
    });
  });
});
