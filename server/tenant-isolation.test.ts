import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  listLeads: vi.fn(),
  updateLeadStatus: vi.fn(),
  updateLeadNote: vi.fn(),
}));

vi.mock("./db", () => dbMocks);

import { appRouter } from "./routers";

function tenantContext(openId: string): TrpcContext {
  return {
    user: {
      id: 1,
      openId,
      name: "Tenant de teste",
      email: "tenant@empresa.pt",
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

describe("isolamento por tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.listLeads.mockResolvedValue([]);
    dbMocks.updateLeadStatus.mockResolvedValue({ id: 42, status: "Fechado" });
    dbMocks.updateLeadNote.mockResolvedValue({ lead: { id: 42 }, notes: [], contacts: [] });
  });

  it("filtra a listagem de leads pelo tenant da sessão", async () => {
    const caller = appRouter.createCaller(tenantContext("tenant-alfa"));
    await caller.leads.list({ city: "Lisboa" });

    expect(dbMocks.listLeads).toHaveBeenCalledWith("tenant-alfa", { city: "Lisboa" });
  });

  it("altera o status usando o tenant autenticado e nunca um tenant enviado pelo cliente", async () => {
    const caller = appRouter.createCaller(tenantContext("tenant-beta"));
    await caller.leads.updateStatus({ leadId: 42, status: "Fechado" });

    expect(dbMocks.updateLeadStatus).toHaveBeenCalledWith("tenant-beta", 42, "Fechado");
  });

  it("edita uma nota apenas no tenant autenticado", async () => {
    const caller = appRouter.createCaller(tenantContext("tenant-gama"));
    await caller.leads.updateNote({ noteId: 71, content: "Retomar contacto na próxima semana." });

    expect(dbMocks.updateLeadNote).toHaveBeenCalledWith("tenant-gama", 71, "Retomar contacto na próxima semana.");
  });

  it("exporta apenas a seleção filtrada pelo tenant autenticado", async () => {
    const caller = appRouter.createCaller(tenantContext("tenant-delta"));
    const result = await caller.leads.export({
      format: "csv",
      filters: { status: "Novo", city: "Porto", selectedIds: [19, 20] },
    });

    expect(dbMocks.listLeads).toHaveBeenCalledWith("tenant-delta", {
      status: "Novo",
      city: "Porto",
      selectedIds: [19, 20],
    });
    expect(result.filename).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.mimeType).toBe("text/csv;charset=utf-8");
  });
});
