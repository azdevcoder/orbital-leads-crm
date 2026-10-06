import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  createLocalUser: vi.fn(),
  upsertUser: vi.fn(),
  countAccountsByIp: vi.fn(),
  freeAccountsPerIpLimit: vi.fn(),
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

    expect(result).toEqual({ id: 9, name: "Utilizador de Teste", email: "teste@empresa.pt", phone: null, role: "user", plan: "free" });
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

  it("regista com IP e bloqueia a 4ª conta gratuita do mesmo IP", async () => {
    dbMocks.getUserByEmail.mockResolvedValue(null);
    dbMocks.countAccountsByIp.mockResolvedValue(2);
    dbMocks.freeAccountsPerIpLimit.mockReturnValue(3);
    bcryptMocks.hash.mockResolvedValue("hash-nova");
    dbMocks.createLocalUser.mockResolvedValue({
      id: 10, openId: "local-10", name: "Nova Conta", email: "nova@empresa.pt",
      phone: "+55 19 99999-0000", role: "user", plan: "free",
    });
    sdkMocks.createSessionToken.mockResolvedValue("jwt-nova");
    const { ctx } = publicContext();
    (ctx.req as { ip?: string }).ip = "203.0.113.9";

    const result = await appRouter.createCaller(ctx).auth.register({
      name: "Nova Conta", email: "nova@empresa.pt", phone: "+55 19 99999-0000", password: "senha1234",
    });

    expect(result).toEqual(expect.objectContaining({ email: "nova@empresa.pt", plan: "free" }));
    expect(dbMocks.countAccountsByIp).toHaveBeenCalledWith("203.0.113.9");
    expect(dbMocks.createLocalUser).toHaveBeenCalledWith(expect.objectContaining({ signupIp: "203.0.113.9" }));

    dbMocks.countAccountsByIp.mockResolvedValue(3);
    await expect(
      appRouter.createCaller(ctx).auth.register({
        name: "Outra", email: "outra@empresa.pt", phone: "+55 19 99999-0001", password: "senha1234",
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(dbMocks.createLocalUser).toHaveBeenCalledTimes(1);
  });
});
