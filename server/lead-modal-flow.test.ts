import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  getLeadDetails: vi.fn(),
  addLeadNote: vi.fn(),
  addContactLog: vi.fn(),
}));

vi.mock("./db", () => dbMocks);

import { appRouter } from "./routers";

function tenantContext(): TrpcContext {
  return {
    user: { id: 8, openId: "tenant-modal", name: "Modal", email: "modal@empresa.pt", passwordHash: "hash", loginMethod: "email", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("detalhes do lead por tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getLeadDetails.mockResolvedValue({ lead: { id: 31, name: "Empresa Teste" }, notes: [], contacts: [] });
    dbMocks.addLeadNote.mockResolvedValue({ lead: { id: 31 }, notes: [], contacts: [] });
    dbMocks.addContactLog.mockResolvedValue({ lead: { id: 31 }, notes: [], contacts: [] });
  });

  it("carrega detalhes exclusivamente a partir do tenant da sessão", async () => {
    await appRouter.createCaller(tenantContext()).leads.details({ leadId: 31 });
    expect(dbMocks.getLeadDetails).toHaveBeenCalledWith("tenant-modal", 31);
  });

  it("adiciona notas e contactos através do tenant da sessão", async () => {
    const caller = appRouter.createCaller(tenantContext());
    await caller.leads.addNote({ leadId: 31, content: "Pedir proposta comercial." });
    await caller.leads.addContact({ leadId: 31, channel: "WhatsApp", details: "Mensagem inicial enviada." });

    expect(dbMocks.addLeadNote).toHaveBeenCalledWith("tenant-modal", 31, "Pedir proposta comercial.");
    expect(dbMocks.addContactLog).toHaveBeenCalledWith("tenant-modal", 31, "WhatsApp", "Mensagem inicial enviada.");
  });
});
