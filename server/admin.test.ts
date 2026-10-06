import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  listAllUsers: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByOpenId: vi.fn(),
  adminUpdateUser: vi.fn(),
  deleteUserAccount: vi.fn(),
  assertPhoneAvailable: vi.fn(),
}));

vi.mock("./db", () => dbMocks);

import { appRouter } from "./routers";
import { ROLE_LABELS, roleLabel } from "../shared/roles";

function adminContext(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-1", name: "Admin", email: "admin@empresa.pt",
      passwordHash: "hash", loginMethod: "email", role: "admin",
      plan: "scale", quotaDay: null, dailySearches: 0, dailyLeads: 0,
      totalSearches: 0, totalLeads: 0,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function userContext(): TrpcContext {
  const ctx = adminContext();
  ctx.user = { ...ctx.user, openId: "user-1", role: "user" };
  return ctx;
}

describe("telefone único normalizado", () => {
  it("normaliza formatos equivalentes e rejeita inválidos", async () => {
    const { normalizePhoneDigits } = await import("../shared/phone");
    expect(normalizePhoneDigits("+55 (19) 99999-0000")).toBe("5519999990000");
    expect(normalizePhoneDigits("551999990000")).toBe("5519999990000");
    expect(normalizePhoneDigits("01999990000")).toBe("1999990000");
    expect(normalizePhoneDigits("-")).toBeNull();
    expect(normalizePhoneDigits(null)).toBeNull();
  });

  it("admin não cria conta com telefone duplicado", async () => {
    dbMocks.getUserByEmail.mockResolvedValue(null);
    dbMocks.assertPhoneAvailable.mockRejectedValue(new Error("Este telefone já está em uso por outra conta."));
    await expect(
      appRouter.createCaller(adminContext()).admin.createUser({
        name: "Dup", email: "dup@empresa.pt", phone: "+55 19 99999-0000",
        password: "senha1234", plan: "free",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("papéis de usuário", () => {
  it("rotula Cliente, Vendedor e Administrador", () => {
    expect(ROLE_LABELS.user).toBe("Cliente");
    expect(ROLE_LABELS.vendedor).toBe("Vendedor");
    expect(ROLE_LABELS.admin).toBe("Administrador");
    expect(roleLabel("desconhecido")).toBe("Cliente");
  });
});

describe("painel admin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista todos os usuários apenas para admin", async () => {
    dbMocks.listAllUsers.mockResolvedValue([{ openId: "a" }, { openId: "b" }]);

    const result = await appRouter.createCaller(adminContext()).admin.listUsers();

    expect(dbMocks.listAllUsers).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    await expect(appRouter.createCaller(userContext()).admin.listUsers()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("atualiza perfil, plano e papel; conflito de email vira 409", async () => {
    dbMocks.adminUpdateUser.mockResolvedValue({ openId: "user-9", plan: "plus", role: "vendedor" });

    const result = await appRouter.createCaller(adminContext()).admin.updateUser({
      openId: "user-9", name: "Novo Nome", plan: "plus", role: "vendedor",
    });

    expect(dbMocks.adminUpdateUser).toHaveBeenCalledWith("user-9", { name: "Novo Nome", plan: "plus", role: "vendedor" });
    expect(result).toMatchObject({ plan: "plus", role: "vendedor" });

    dbMocks.adminUpdateUser.mockRejectedValueOnce(new Error("Este email já está associado a outra conta."));
    await expect(
      appRouter.createCaller(adminContext()).admin.updateUser({ openId: "user-9", email: "dup@empresa.pt" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("exclui usuário com dados do tenant, nunca a si mesmo", async () => {    dbMocks.getUserByOpenId.mockResolvedValue({ openId: "user-9" });

    const result = await appRouter.createCaller(adminContext()).admin.deleteUser({ openId: "user-9" });

    expect(result).toEqual({ success: true });
    expect(dbMocks.deleteUserAccount).toHaveBeenCalledWith("user-9");

    await expect(
      appRouter.createCaller(adminContext()).admin.deleteUser({ openId: "admin-1" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dbMocks.deleteUserAccount).toHaveBeenCalledTimes(1);
  });
});
