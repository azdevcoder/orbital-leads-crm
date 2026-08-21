import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  listSearchHistory: vi.fn(),
  getSearchById: vi.fn(),
  upsertCapturedLeads: vi.fn(),
  createSearchHistory: vi.fn(),
}));
const mapMocks = vi.hoisted(() => ({ makeRequest: vi.fn() }));

vi.mock("./db", () => dbMocks);
vi.mock("./_core/map", () => mapMocks);

import { appRouter } from "./routers";

function tenantContext(): TrpcContext {
  return {
    user: { id: 3, openId: "tenant-history", name: "Histórico", email: "h@empresa.pt", passwordHash: "hash", loginMethod: "email", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("histórico de buscas por tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.upsertCapturedLeads.mockResolvedValue(1);
    dbMocks.createSearchHistory.mockResolvedValue(undefined);
  });

  it("lista apenas o histórico do tenant autenticado", async () => {
    dbMocks.listSearchHistory.mockResolvedValue([{ id: 11, segment: "Clínicas", city: "Braga", state: "PT", resultCount: 4 }]);
    const result = await appRouter.createCaller(tenantContext()).places.history();

    expect(dbMocks.listSearchHistory).toHaveBeenCalledWith("tenant-history");
    expect(result).toHaveLength(1);
  });

  it("repete uma busca pertencente ao tenant autenticado", async () => {
    dbMocks.getSearchById.mockResolvedValue({ id: 12, segment: "Clínicas", city: "Braga", state: "PT" });
    mapMocks.makeRequest
      .mockResolvedValueOnce({ status: "OK", results: [{ place_id: "repeat-place", name: "Clínica Teste", formatted_address: "Braga", types: [], geometry: { location: { lat: 0, lng: 0 } } }] })
      .mockResolvedValueOnce({ status: "OK", result: { place_id: "repeat-place", name: "Clínica Teste", formatted_address: "Braga", geometry: { location: { lat: 0, lng: 0 } } } });

    const result = await appRouter.createCaller(tenantContext()).places.rerun({ searchId: 12 });

    expect(result.saved).toBe(1);
    expect(dbMocks.getSearchById).toHaveBeenCalledWith("tenant-history", 12);
    expect(dbMocks.upsertCapturedLeads).toHaveBeenCalledWith("tenant-history", expect.any(Array));
    expect(dbMocks.createSearchHistory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-history", segment: "Clínicas" }));
  });
});
