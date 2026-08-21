import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  createLocalUser: vi.fn(),
  upsertUser: vi.fn(),
}));
const bcryptMocks = vi.hoisted(() => ({ compare: vi.fn(), hash: vi.fn() }));
const sdkMocks = vi.hoisted(() => ({ createSessionToken: vi.fn() }));

vi.mock("./db", () => dbMocks);
vi.mock("bcryptjs", () => ({ default: bcryptMocks }));
vi.mock("./_core/sdk", () => ({ sdk: sdkMocks }));

import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";

function publicContext(): { ctx: TrpcContext; cookies: Array<{ name: string; value: string }> } {
  const cookies: Array<{ name: string; value: string }> = [];
  return {
    ctx: {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        cookie: (name: string, value: string) => cookies.push({ name, value }),
        clearCookie: vi.fn(),
      } as unknown as TrpcContext["res"],
    },
    cookies,
  };
}

describe("auth local", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emite uma sessão JWT segura para credenciais válidas", async () => {
    dbMocks.getUserByEmail.mockResolvedValue({
      id: 9,
      openId: "local-tenant-9",
      name: "Utilizador de Teste",
      email: "teste@empresa.pt",
      passwordHash: "stored-hash",
      role: "user",
    });
    bcryptMocks.compare.mockResolvedValue(true);
    sdkMocks.createSessionToken.mockResolvedValue("jwt-local-token");
    const { ctx, cookies } = publicContext();

    const result = await appRouter.createCaller(ctx).auth.login({
      email: "teste@empresa.pt",
      password: "palavra-passe-segura",
    });

    expect(result).toEqual({ id: 9, name: "Utilizador de Teste", email: "teste@empresa.pt", role: "user" });
    expect(bcryptMocks.compare).toHaveBeenCalledWith("palavra-passe-segura", "stored-hash");
    expect(sdkMocks.createSessionToken).toHaveBeenCalledWith("local-tenant-9", { name: "Utilizador de Teste" });
    expect(cookies).toEqual([{ name: COOKIE_NAME, value: "jwt-local-token" }]);
  });

  it("rejeita palavras-passe inválidas sem emitir cookie", async () => {
    dbMocks.getUserByEmail.mockResolvedValue({ passwordHash: "stored-hash" });
    bcryptMocks.compare.mockResolvedValue(false);
    const { ctx, cookies } = publicContext();

    await expect(
      appRouter.createCaller(ctx).auth.login({ email: "teste@empresa.pt", password: "errada" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(cookies).toEqual([]);
  });
});
