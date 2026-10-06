import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  setUserPlan: vi.fn(),
  createLocalUser: vi.fn(),
  setUserPasswordByEmail: vi.fn(),
  markCaktoPaymentClaimed: vi.fn(),
  getCaktoPaymentByToken: vi.fn(),
  getCaktoPaymentByOrderId: vi.fn(),
  confirmCaktoPayment: vi.fn(),
  getUserByPhoneDigits: vi.fn(),
  ensurePlanExpiry: vi.fn(),
}));
const sdkMocks = vi.hoisted(() => ({ createSessionToken: vi.fn() }));
const bcryptMocks = vi.hoisted(() => ({ hash: vi.fn() }));

vi.mock("./db", () => dbMocks);
vi.mock("./_core/sdk", () => ({ sdk: sdkMocks }));
vi.mock("bcryptjs", () => ({ default: bcryptMocks }));

import {
  handleCaktoWebhook,
  isValidCaktoSecret,
  planForOffer,
} from "./cakto";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";

function authedContext() {
  const cookies: Array<{ name: string; value: string }> = [];
  return {
    ctx: {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {
        cookie: (name: string, value: string) => cookies.push({ name, value }),
      } as unknown as TrpcContext["res"],
    },
    cookies,
  };
}

const paidOrder = (overrides = {}) => ({
  id: "order-1",
  status: "paid",
  callback: "tok-claim-123",
  customer: { name: "Compradora", email: "buyer@example.com", phone: "+55 19 99999-0000" },
  offer: { id: "offer-start-1", price: 29.9 },
  ...overrides,
});

describe("webhook Cakto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CAKTO_WEBHOOK_SECRET = "segredo-webhook";
    process.env.CAKTO_OFFER_START = "offer-start-1";
    process.env.CAKTO_OFFER_PLUS = "offer-plus-1";
    process.env.CAKTO_OFFER_SCALE = "offer-scale-1";
    dbMocks.getCaktoPaymentByOrderId.mockResolvedValue(undefined);
    dbMocks.confirmCaktoPayment.mockResolvedValue({ token: "tok-claim-123" });
  });

  it("valida o secret com comparação segura", () => {
    expect(isValidCaktoSecret("segredo-webhook")).toBe(true);
    expect(isValidCaktoSecret("outro")).toBe(false);
    expect(isValidCaktoSecret(undefined)).toBe(false);
  });

  it("mapeia oferta ao plano por id e por preço", () => {
    expect(planForOffer({ id: "offer-plus-1", price: 0 })?.valueOf()).toBe("plus");
    expect(planForOffer({ id: "desconhecida", price: 99.99 })).toBe("scale");
    process.env.CAKTO_OFFER_LIFETIME = "offer-life-1";
    expect(planForOffer({ id: "offer-life-1", price: 0 })).toBe("lifetime");
    expect(planForOffer({ id: "desconhecida", price: 1999 })).toBe("lifetime");
    expect(planForOffer({ id: "desconhecida", price: 499.9 })).toBe("plus_annual");
    expect(planForOffer({ id: "desconhecida", price: 1 })).toBeNull();
    expect(planForOffer(null)).toBeNull();
  });

  it("purchase_approved cria conta e libera o plano do email da compra", async () => {
    dbMocks.getUserByEmail.mockResolvedValue(null);
    dbMocks.createLocalUser.mockResolvedValue({ openId: "local-new", email: "buyer@example.com", plan: "start" });

    await handleCaktoWebhook("purchase_approved", paidOrder());

    expect(dbMocks.confirmCaktoPayment).toHaveBeenCalledWith(expect.objectContaining({
      orderId: "order-1",
      email: "buyer@example.com",
      plan: "start",
      status: "paid",
    }));
    expect(dbMocks.createLocalUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "buyer@example.com",
      phone: "+55 19 99999-0000",
      plan: "start",
    }));
  });

  it("entrega repetida do mesmo pedido é idempotente", async () => {
    dbMocks.getUserByEmail.mockResolvedValue({ openId: "local-x", email: "buyer@example.com", plan: "start" });

    await handleCaktoWebhook("purchase_approved", paidOrder());
    await handleCaktoWebhook("purchase_approved", paidOrder());

    expect(dbMocks.confirmCaktoPayment).toHaveBeenCalledTimes(2);
    expect(dbMocks.createLocalUser).not.toHaveBeenCalled();
    expect(dbMocks.setUserPlan).not.toHaveBeenCalled();
  });

  it("aceita data em lista (webhook V2)", async () => {
    dbMocks.getUserByEmail.mockResolvedValue({ openId: "local-x", email: "buyer@example.com", plan: "free" });

    await handleCaktoWebhook("purchase_approved", [paidOrder()]);

    expect(dbMocks.setUserPlan).toHaveBeenCalledWith("local-x", "start");
  });

  it("refund rebaixa para o Grátis sem tocar no admin", async () => {
    dbMocks.getUserByEmail
      .mockResolvedValueOnce({ openId: "local-x", email: "buyer@example.com", plan: "plus", role: "user" })
      .mockResolvedValueOnce({ openId: "local-a", email: "admin@example.com", plan: "scale", role: "admin" });

    await handleCaktoWebhook("refund", paidOrder({ id: "order-2" }));
    await handleCaktoWebhook("chargeback", paidOrder({ id: "order-3", customer: { email: "admin@example.com" } }));

    expect(dbMocks.setUserPlan).toHaveBeenCalledWith("local-x", "free");
    expect(dbMocks.setUserPlan).toHaveBeenCalledTimes(1);
  });

  it("ignora abandono de checkout e eventos sem pedido", async () => {
    await handleCaktoWebhook("checkout_abandonment", { offer: { id: "x" } });
    await handleCaktoWebhook("pix_gerado", { status: "waiting_payment" });

    expect(dbMocks.confirmCaktoPayment).not.toHaveBeenCalled();
    expect(dbMocks.getUserByEmail).not.toHaveBeenCalled();
  });

  it("ignora oferta não mapeada sem criar acesso", async () => {
    await handleCaktoWebhook("purchase_approved", paidOrder({ offer: { id: "outra", price: 7 } }));

    expect(dbMocks.createLocalUser).not.toHaveBeenCalled();
    expect(dbMocks.confirmCaktoPayment).not.toHaveBeenCalled();
  });
});

describe("resgate de acesso (claim)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bcryptMocks.hash.mockResolvedValue("hash-nova");
  });

  it("define a senha, marca uso único e autentica", async () => {
    dbMocks.getCaktoPaymentByToken.mockResolvedValue({
      token: "tok-claim-123",
      status: "paid",
      claimedAt: null,
      email: "buyer@example.com",
      plan: "plus",
      customerName: "Compradora",
      customerPhone: "+55 19 99999-0000",
    });
    dbMocks.getUserByEmail.mockResolvedValueOnce({
      id: 21, openId: "local-21", name: "Compradora", email: "buyer@example.com",
      phone: null, role: "user", plan: "free",
    }).mockResolvedValue({
      id: 21, openId: "local-21", name: "Compradora", email: "buyer@example.com",
      phone: null, role: "user", plan: "plus",
    });
    sdkMocks.createSessionToken.mockResolvedValue("jwt-claim");
    const { ctx, cookies } = authedContext();

    const result = await appRouter.createCaller(ctx).auth.claimAccess({ token: "tok-claim-123", password: "novasenha123" });

    expect(result).toEqual(expect.objectContaining({ email: "buyer@example.com", plan: "plus" }));
    expect(dbMocks.setUserPasswordByEmail).toHaveBeenCalledWith("buyer@example.com", "hash-nova");
    expect(dbMocks.setUserPlan).toHaveBeenCalledWith("local-21", "plus");
    expect(dbMocks.markCaktoPaymentClaimed).toHaveBeenCalledWith("tok-claim-123");
    expect(cookies).toEqual([{ name: COOKIE_NAME, value: "jwt-claim" }]);
  });

  it("rejeita token reutilizado", async () => {
    dbMocks.getCaktoPaymentByToken.mockResolvedValue({
      token: "tok-usado", status: "paid", claimedAt: new Date(), email: "buyer@example.com", plan: "start",
    });
    const { ctx } = authedContext();

    await expect(
      appRouter.createCaller(ctx).auth.claimAccess({ token: "tok-usado", password: "novasenha123" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
