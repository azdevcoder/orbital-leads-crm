/**
 * Integração Cakto: webhooks de pagamento e liberação de acesso.
 * Docs: https://docs.cakto.com.br/introduction
 *
 * Fluxo:
 * 1. `cakto.checkout` gera token opaco e devolve a URL do checkout com ?callback=token.
 * 2. Webhook `purchase_approved` (servidor-servidor) confirma e libera o plano no email da compra.
 * 3. Redirect pós-pagamento traz o comprador a /?ativar=token; `auth.claimAccess` define a
 *    senha (uso único) e autentica. Sem SMTP: o acesso nasce no email cadastrado na compra.
 * 4. `refund`/`chargeback`/`subscription_canceled` rebaixam para o Grátis.
 */
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import * as db from "./db";
import { planOf, type PlanId } from "../shared/plans";

export type CaktoOrderData = {
  id: string;
  status?: string | null;
  callback?: string | null;
  customer?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  offer?: { id?: string | null; price?: number | null } | null;
};

function webhookSecret(): string {
  return process.env.CAKTO_WEBHOOK_SECRET ?? "";
}

/** Valida o `secret` do corpo com comparação em tempo constante. */
export function isValidCaktoSecret(received: unknown): boolean {
  const expected = webhookSecret();
  if (typeof received !== "string" || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Mapeia a oferta Cakto ao plano (por id configurado, com fallback por preço). */
export function planForOffer(offer: CaktoOrderData["offer"]): PlanId | null {
  const byId: Record<string, PlanId> = {};
  if (process.env.CAKTO_OFFER_START) byId[process.env.CAKTO_OFFER_START] = "start";
  if (process.env.CAKTO_OFFER_PLUS) byId[process.env.CAKTO_OFFER_PLUS] = "plus";
  if (process.env.CAKTO_OFFER_SCALE) byId[process.env.CAKTO_OFFER_SCALE] = "scale";
  if (process.env.CAKTO_OFFER_PLUS_ANNUAL) byId[process.env.CAKTO_OFFER_PLUS_ANNUAL] = "plus_annual";
  if (process.env.CAKTO_OFFER_SCALE_ANNUAL) byId[process.env.CAKTO_OFFER_SCALE_ANNUAL] = "scale_annual";
  if (process.env.CAKTO_OFFER_LIFETIME) byId[process.env.CAKTO_OFFER_LIFETIME] = "lifetime";
  if (offer?.id && byId[offer.id]) return byId[offer.id];
  if (offer?.price === 29.99) return "start";
  if (offer?.price === 49.99) return "plus";
  if (offer?.price === 99.99) return "scale";
  if (offer?.price === 499.9) return "plus_annual";
  if (offer?.price === 999.9) return "scale_annual";
  if (offer?.price === 1999) return "lifetime";
  return null;
}

function tokenFor(data: CaktoOrderData): string {
  const raw = (data.callback ?? "").trim();
  // charset aceito pela Cakto: letras, números e . _ ~ -
  if (/^[A-Za-z0-9._~-]{8,255}$/.test(raw)) return raw;
  return `order_${data.id}`;
}

/** Garante conta com o plano liberado para o email da compra. */
export async function grantPlanAccess(input: {
  email: string;
  name?: string | null;
  phone?: string | null;
  plan: PlanId;
}) {
  const email = input.email.trim().toLowerCase();
  const existing = await db.getUserByEmail(email);
  if (existing) {
    if (existing.plan !== input.plan) await db.setUserPlan(existing.openId, input.plan);
    return existing;
  }
  const passwordHash = await bcryptHash(nanoid(24));
  // Fluxo pago não pode quebrar por telefone duplicado: sem unicidade, sem dígitos.
  const digits = await safePhoneDigits(input.phone);
  return db.createLocalUser({
    name: (input.name ?? "").trim() || email.split("@")[0],
    email,
    phone: (input.phone ?? "").trim() || "-",
    phoneDigitsOverride: digits,
    passwordHash,
    plan: input.plan,
  });
}

async function safePhoneDigits(phone: string | null | undefined): Promise<string | null> {
  const { normalizePhoneDigits } = await import("../shared/phone");
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  const owner = await db.getUserByPhoneDigits(digits);
  return owner ? null : digits;
}

async function bcryptHash(value: string): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return (bcrypt.default ?? bcrypt).hash(value, 12);
}

/** Rebaixa a conta do email para o Grátis (reembolso/chargeback/cancelamento). */
export async function revokePlanAccess(email: string) {
  const user = await db.getUserByEmail(email.trim().toLowerCase());
  if (!user || user.role === "admin") return user;
  if (user.plan !== "free") await db.setUserPlan(user.openId, "free");
  return user;
}

async function handlePaidOrder(data: CaktoOrderData) {
  const plan = planForOffer(data.offer ?? null);
  const email = data.customer?.email?.trim().toLowerCase();
  if (!plan || !email) {
    console.warn("[Cakto] pedido pago sem plano/email mapeável, ignorado:", data.id);
    return;
  }
  const known = await db.getCaktoPaymentByOrderId(data.id);
  await db.confirmCaktoPayment({
    token: tokenFor(data),
    email,
    customerName: data.customer?.name ?? null,
    customerPhone: data.customer?.phone ?? null,
    orderId: data.id,
    plan,
    status: "paid",
  });
  // Idempotência: reaplicar o plano é seguro (mesmo email + plano), com +30 dias.
  const granted = await grantPlanAccess({
    email,
    name: data.customer?.name,
    phone: data.customer?.phone,
    plan,
  });
  if (granted) await db.ensurePlanExpiry(granted.openId, plan);
  if (!known) console.log(`[Cakto] acesso liberado: ${email} -> ${plan} (pedido ${data.id})`);
}

async function handleRevokedOrder(data: CaktoOrderData, status: string) {
  const email = data.customer?.email?.trim().toLowerCase();
  const known = await db.getCaktoPaymentByOrderId(data.id);
  await db.confirmCaktoPayment({
    token: tokenFor(data),
    email: email ?? null,
    customerName: data.customer?.name ?? null,
    customerPhone: data.customer?.phone ?? null,
    orderId: data.id,
    plan: planOf(null).id,
    status,
  });
  if (email) {
    await revokePlanAccess(email);
    if (!known) console.log(`[Cakto] acesso rebaixado: ${email} (pedido ${data.id}, ${status})`);
  }
}

/**
 * Processa um evento de webhook (aceita `data` objeto da V1 ou lista da V2).
 * Responda 2xx antes de chamar: o processamento é assíncrono.
 */
export async function handleCaktoWebhook(event: unknown, data: unknown): Promise<void> {
  const orders = Array.isArray(data) ? data : [data];
  for (const item of orders) {
    const order = (item ?? {}) as CaktoOrderData;
    if (!order.id) continue; // ex.: checkout_abandonment: sem pedido, nada a liberar
    switch (event) {
      case "purchase_approved":
        if ((order.status ?? "paid") === "paid") await handlePaidOrder(order);
        break;
      case "subscription_renewed":
        await handlePaidOrder(order);
        break;
      case "refund":
      case "chargeback":
      case "subscription_canceled":
        await handleRevokedOrder(order, String(event));
        break;
      default:
        break; // pix_gerado, refused, paused...: sem mudança de acesso
    }
  }
}
