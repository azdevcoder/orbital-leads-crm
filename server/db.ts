import { and, desc, eq, inArray, isNotNull, like, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  caktoPayments,
  contactLogs,
  leads,
  leadNotes,
  type InsertUser,
  type PipelineStatus,
  searches,
  users,
} from "../drizzle/schema";
import { planOf, todayKey, type PlanId } from "../shared/plans";
import { normalizePhoneDigits } from "../shared/phone";
import type { RoleId } from "../shared/roles";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

export const LEAD_SORT_COLUMNS = ["name", "segment", "location", "rating", "status"] as const;
export type LeadSortColumn = (typeof LEAD_SORT_COLUMNS)[number];

export type LeadFilters = {
  status?: PipelineStatus;
  segment?: string;
  city?: string;
  query?: string;
  selectedIds?: number[];
  /** Só leads com telefone preenchido. */
  hasPhone?: boolean;
  sortBy?: LeadSortColumn;
  sortDir?: "asc" | "desc";
};

export type CapturedLead = {
  placeId: string;
  name: string;
  phone?: string | null;
  fullAddress?: string | null;
  website?: string | null;
  rating?: number | null;
  businessStatus: string;
  segment: string;
  city: string;
  state: string;
};

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const url = process.env.DATABASE_URL;
      // Render Postgres (e externas) exige SSL; local (docker-compose/produção local) usa plaintext.
      // Só ativa SSL quando a URL indica (render.com ou sslmode=require) e nunca com sslmode=disable.
      const needsSSL =
        (url.includes("render.com") || url.includes("sslmode=require")) &&
        !url.includes("sslmode=disable");
      _pool = new Pool({
        connectionString: url,
        ...(needsSSL ? { ssl: { rejectUnauthorized: false } } : {}),
      });
      _db = drizzle(_pool);
    } catch (error) {
      console.warn("[Database] Failed to initialize:", error);
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("A base de dados não está disponível.");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("O identificador do utilizador é obrigatório.");
  const db = await requireDb();
  const now = new Date();
  const existing = await getUserByOpenId(user.openId);

  if (!existing) {
    await db.insert(users).values({ ...user, lastSignedIn: user.lastSignedIn ?? now });
    return;
  }

  const values: {
    name?: string | null;
    email?: string | null;
    loginMethod?: string | null;
    role?: "user" | "vendedor" | "admin";
    lastSignedIn: Date;
    updatedAt: Date;
  } = { lastSignedIn: user.lastSignedIn ?? now, updatedAt: now };
  if (user.name !== undefined) values.name = user.name;
  if (user.email !== undefined) values.email = user.email;
  if (user.loginMethod !== undefined) values.loginMethod = user.loginMethod;
  if (user.role !== undefined) values.role = user.role;
  await db.update(users).set(values).where(eq(users.openId, user.openId));
}

export async function createLocalUser(input: {
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  plan?: PlanId;
  signupIp?: string | null;
  loginMethod?: string;
  /** Quando definido (inclusive null), ignora a normalização automática. */
  phoneDigitsOverride?: string | null;
}) {
  const db = await requireDb();
  const email = input.email.trim().toLowerCase();
  const openId = `local_${randomUUID()}`;
  await db.insert(users).values({
    openId,
    name: input.name.trim(),
    email,
    phone: input.phone.trim(),
    passwordHash: input.passwordHash,
    loginMethod: input.loginMethod ?? "email",
    plan: planOf(input.plan).id,
    signupIp: input.signupIp?.trim().slice(0, 45) ?? null,
    phoneDigits: "phoneDigitsOverride" in input ? input.phoneDigitsOverride : normalizePhoneDigits(input.phone),
    lastSignedIn: new Date(),
  });
  return getUserByOpenId(openId);
}

/** Conta não-admin dona destes dígitos de telefone (para unicidade). */
export async function getUserByPhoneDigits(digits: string, excludeOpenId?: string) {
  const db = await requireDb();
  const conditions = [eq(users.phoneDigits, digits)];
  if (excludeOpenId) conditions.push(ne(users.openId, excludeOpenId));
  const result = await db.select().from(users).where(and(...conditions)).limit(1);
  return result[0];
}

/** Garante telefone único (ignora quando não normalizável). */
export async function assertPhoneAvailable(phone: string | null | undefined, excludeOpenId?: string) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  const owner = await getUserByPhoneDigits(digits, excludeOpenId);
  if (owner) throw new Error("Este telefone já está em uso por outra conta.");
  return digits;
}

/** Quantas contas (não-admin) já nasceram deste IP — trava anti-abuso do Grátis. */
export async function countAccountsByIp(ip: string): Promise<number> {
  const db = await requireDb();
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.signupIp, ip), ne(users.role, "admin")));
  return result[0]?.count ?? 0;
}

export function freeAccountsPerIpLimit(): number {
  const raw = Number(process.env.FREE_PER_IP_LIMIT ?? 2);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
}

/** Regista uma busca concluída nos contadores de cota do tenant. */
export async function recordSearchUsage(openId: string, saved: number) {
  const db = await requireDb();
  const user = await getUserByOpenId(openId);
  if (!user) return;
  const today = todayKey();
  const sameDay = user.quotaDay === today;
  await db
    .update(users)
    .set({
      quotaDay: today,
      dailySearches: (sameDay ? user.dailySearches : 0) + 1,
      dailyLeads: (sameDay ? user.dailyLeads : 0) + saved,
      totalSearches: user.totalSearches + 1,
      totalLeads: user.totalLeads + saved,
      updatedAt: new Date(),
    })
    .where(eq(users.openId, openId));
}

export async function listAllUsers() {
  const db = await requireDb();
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function setUserPlan(openId: string, plan: PlanId, expiresAt?: Date | null) {
  const db = await requireDb();
  const values: { plan: string; updatedAt: Date; planExpiresAt?: Date | null } = {
    plan: planOf(plan).id,
    updatedAt: new Date(),
  };
  if (expiresAt !== undefined) values.planExpiresAt = expiresAt;
  await db.update(users).set(values).where(eq(users.openId, openId));
  return getUserByOpenId(openId);
}

/** Garante +30 dias de plano (renova a partir do vencimento atual ou de hoje). */
export async function ensurePlanExpiry(openId: string, plan: PlanId, days = 30) {
  const user = await getUserByOpenId(openId);
  if (!user) return user;
  const current = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : 0;
  const base = Math.max(current, Date.now());
  return setUserPlan(openId, plan, new Date(base + days * 24 * 60 * 60 * 1000));
}

/** Edição completa pelo admin: perfil + plano + papel. */
export async function adminUpdateUser(
  openId: string,
  input: { name?: string; email?: string; phone?: string; plan?: PlanId; role?: RoleId }
) {
  const db = await requireDb();
  const current = await getUserByOpenId(openId);
  if (!current) return undefined;
  if (input.email !== undefined) {
    const normalized = input.email.trim().toLowerCase();
    const owner = await getUserByEmail(normalized);
    if (owner && owner.openId !== openId) {
      throw new Error("Este email já está associado a outra conta.");
    }
  }
  const values: {
    name?: string; email?: string; phone?: string; phoneDigits?: string | null;
    plan?: string; role?: RoleId; updatedAt: Date;
  } = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name.trim();
  if (input.email !== undefined) values.email = input.email.trim().toLowerCase();
  if (input.phone !== undefined) {
    const digits = normalizePhoneDigits(input.phone);
    if (digits) {
      const owner = await getUserByPhoneDigits(digits, openId);
      if (owner) throw new Error("Este telefone já está em uso por outra conta.");
    }
    values.phone = input.phone.trim();
    values.phoneDigits = digits;
  }
  if (input.plan !== undefined) values.plan = planOf(input.plan).id;
  if (input.role !== undefined) values.role = input.role;
  await db.update(users).set(values).where(eq(users.openId, openId));
  return getUserByOpenId(openId);
}

/** Exclui a conta e todos os dados do tenant (leads, notas, contactos, buscas). */
export async function deleteUserAccount(openId: string) {
  const db = await requireDb();
  await db.delete(leadNotes).where(eq(leadNotes.tenantId, openId));
  await db.delete(contactLogs).where(eq(contactLogs.tenantId, openId));
  await db.delete(leads).where(eq(leads.tenantId, openId));
  await db.delete(searches).where(eq(searches.tenantId, openId));
  await db.delete(users).where(eq(users.openId, openId));
}

/** Garante a conta administradora no arranque (via ADMIN_EMAIL/ADMIN_PASSWORD). */
export async function ensureAdminUser(email: string, password: string, name = "Administrador") {
  const db = await requireDb();
  const normalized = email.trim().toLowerCase();
  const existing = await getUserByEmail(normalized);
  if (existing) {
    if (existing.role !== "admin" || existing.plan !== "scale") {
      await db
        .update(users)
        .set({ role: "admin", plan: "scale", updatedAt: new Date() })
        .where(eq(users.id, existing.id));
    }
    return getUserByEmail(normalized);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await db.insert(users).values({
    openId: `local_${randomUUID()}`,
    name,
    email: normalized,
    passwordHash,
    loginMethod: "email",
    role: "admin",
    plan: "scale",
    lastSignedIn: new Date(),
  });
  return getUserByEmail(normalized);
}

export async function setUserPasswordByEmail(email: string, passwordHash: string) {
  const db = await requireDb();
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.email, email.trim().toLowerCase()));
  return getUserByEmail(email);
}

/** Pagamentos Cakto (webhook + resgate de acesso). */

export async function createCaktoPayment(input: {
  token: string;
  plan: PlanId;
  email?: string | null;
}) {
  const db = await requireDb();
  await db.insert(caktoPayments).values({
    token: input.token,
    plan: planOf(input.plan).id,
    email: input.email?.trim().toLowerCase() ?? null,
  });
  const result = await db.select().from(caktoPayments).where(eq(caktoPayments.token, input.token)).limit(1);
  return result[0];
}

export async function getCaktoPaymentByToken(token: string) {
  const db = await requireDb();
  const result = await db.select().from(caktoPayments).where(eq(caktoPayments.token, token)).limit(1);
  return result[0];
}

export async function getCaktoPaymentByOrderId(orderId: string) {
  const db = await requireDb();
  const result = await db.select().from(caktoPayments).where(eq(caktoPayments.orderId, orderId)).limit(1);
  return result[0];
}

/** Regista/atualiza o pedido (idempotente por orderId). */
export async function confirmCaktoPayment(input: {
  token: string;
  email: string | null;
  customerName: string | null;
  customerPhone: string | null;
  orderId: string;
  plan: PlanId;
  status: string;
}) {
  const db = await requireDb();
  const existing = await getCaktoPaymentByOrderId(input.orderId);
  if (existing) {
    await db
      .update(caktoPayments)
      .set({
        email: input.email?.trim().toLowerCase() ?? existing.email,
        customerName: input.customerName ?? existing.customerName,
        customerPhone: input.customerPhone ?? existing.customerPhone,
        plan: planOf(input.plan).id,
        status: input.status,
      })
      .where(eq(caktoPayments.orderId, input.orderId));
    return getCaktoPaymentByOrderId(input.orderId);
  }
  // Reaproveita linha criada no checkout quando o token coincide.
  const byToken = await getCaktoPaymentByToken(input.token);
  if (byToken && !byToken.orderId) {
    await db
      .update(caktoPayments)
      .set({
        email: input.email?.trim().toLowerCase() ?? null,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        orderId: input.orderId,
        plan: planOf(input.plan).id,
        status: input.status,
      })
      .where(eq(caktoPayments.token, input.token));
    return getCaktoPaymentByToken(input.token);
  }
  await db.insert(caktoPayments).values({
    token: input.token,
    email: input.email?.trim().toLowerCase() ?? null,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    orderId: input.orderId,
    plan: planOf(input.plan).id,
    status: input.status,
  });
  return getCaktoPaymentByOrderId(input.orderId);
}

export async function markCaktoPaymentClaimed(token: string) {
  const db = await requireDb();
  await db
    .update(caktoPayments)
    .set({ claimedAt: new Date() })
    .where(eq(caktoPayments.token, token));
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserByEmail(email: string) {
  const db = await requireDb();
  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return result[0];
}

export async function updateUserProfile(
  userId: number,
  input: { name?: string; email?: string; phone?: string }
) {
  const db = await requireDb();
  const values: { name?: string; email?: string; phone?: string; phoneDigits?: string | null; updatedAt: Date } = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name.trim();
  if (input.email !== undefined) values.email = input.email.trim().toLowerCase();
  if (input.phone !== undefined) {
    values.phone = input.phone.trim();
    values.phoneDigits = normalizePhoneDigits(input.phone);
  }
  await db.update(users).set(values).where(eq(users.id, userId));
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result[0];
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await requireDb();
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

function leadConditions(tenantId: string, filters: LeadFilters) {
  const conditions = [eq(leads.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(leads.status, filters.status));
  if (filters.segment) conditions.push(eq(leads.segment, filters.segment));
  if (filters.city) conditions.push(eq(leads.city, filters.city));
  if (filters.selectedIds?.length) conditions.push(inArray(leads.id, filters.selectedIds));
  if (filters.hasPhone) {
    conditions.push(and(isNotNull(leads.phone), ne(leads.phone, ""))!);
  }
  if (filters.query?.trim()) {
    const term = `%${filters.query.trim()}%`;
    conditions.push(
      or(
        like(leads.name, term),
        like(leads.phone, term),
        like(leads.email, term),
        like(leads.fullAddress, term),
        like(leads.website, term)
      )!
    );
  }
  return and(...conditions);
}

/** Ordenação da lista (colunas fixas — sem SQL dinâmico). */
export function leadOrderBy(filters: LeadFilters) {
  const dir = filters.sortDir === "desc" ? "desc" : "asc";
  const nullsLast = (column: AnyPgColumn) => sql`${column} ${sql.raw(dir)} nulls last`;
  switch (filters.sortBy) {
    case "name":
      return [nullsLast(leads.name)];
    case "segment":
      return [nullsLast(leads.segment)];
    case "location":
      return [nullsLast(leads.city), nullsLast(leads.state)];
    case "rating":
      return [nullsLast(leads.rating)];
    case "status":
      return [nullsLast(leads.status)];
    default:
      return [desc(leads.updatedAt)];
  }
}

export async function listLeads(tenantId: string, filters: LeadFilters = {}) {
  const db = await requireDb();
  return db
    .select()
    .from(leads)
    .where(leadConditions(tenantId, filters))
    .orderBy(...leadOrderBy(filters));
}

export async function getLeadById(tenantId: string, leadId: number) {
  const db = await requireDb();
  const result = await db
    .select()
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)))
    .limit(1);
  return result[0];
}

export async function getLeadDetails(tenantId: string, leadId: number) {
  const db = await requireDb();
  const lead = await getLeadById(tenantId, leadId);
  if (!lead) return undefined;
  const [notes, contacts] = await Promise.all([
    db
      .select()
      .from(leadNotes)
      .where(and(eq(leadNotes.tenantId, tenantId), eq(leadNotes.leadId, leadId)))
      .orderBy(desc(leadNotes.updatedAt)),
    db
      .select()
      .from(contactLogs)
      .where(and(eq(contactLogs.tenantId, tenantId), eq(contactLogs.leadId, leadId)))
      .orderBy(desc(contactLogs.contactedAt)),
  ]);
  return { lead, notes, contacts };
}

export async function upsertCapturedLeads(tenantId: string, captured: CapturedLead[]) {
  const db = await requireDb();
  const now = new Date();
  for (const item of captured) {
    await db
      .insert(leads)
      .values({
        tenantId,
        placeId: item.placeId,
        name: item.name,
        phone: item.phone ?? null,
        fullAddress: item.fullAddress ?? null,
        website: item.website ?? null,
        rating: item.rating?.toFixed(1) ?? null,
        businessStatus: item.businessStatus,
        status: "Novo",
        segment: item.segment,
        city: item.city,
        state: item.state,
      })
      .onConflictDoUpdate({
        target: [leads.tenantId, leads.placeId],
        set: {
          name: item.name,
          phone: item.phone ?? null,
          fullAddress: item.fullAddress ?? null,
          website: item.website ?? null,
          rating: item.rating?.toFixed(1) ?? null,
          businessStatus: item.businessStatus,
          segment: item.segment,
          city: item.city,
          state: item.state,
          updatedAt: now,
        },
      });
  }
  return captured.length;
}

export async function updateLeadStatus(
  tenantId: string,
  leadId: number,
  status: PipelineStatus
) {
  const db = await requireDb();
  await db
    .update(leads)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  return getLeadById(tenantId, leadId);
}

export async function updateLeadDetails(
  tenantId: string,
  leadId: number,
  input: { phone?: string | null; email?: string | null; website?: string | null; fullAddress?: string | null }
) {
  const db = await requireDb();
  await db
    .update(leads)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  return getLeadById(tenantId, leadId);
}

export async function addLeadNote(tenantId: string, leadId: number, content: string) {
  const db = await requireDb();
  const lead = await getLeadById(tenantId, leadId);
  if (!lead) return undefined;
  await db.insert(leadNotes).values({ tenantId, leadId, content: content.trim() });
  return getLeadDetails(tenantId, leadId);
}

export async function updateLeadNote(tenantId: string, noteId: number, content: string) {
  const db = await requireDb();
  const current = await db
    .select()
    .from(leadNotes)
    .where(and(eq(leadNotes.tenantId, tenantId), eq(leadNotes.id, noteId)))
    .limit(1);
  const note = current[0];
  if (!note) return undefined;
  await db
    .update(leadNotes)
    .set({ content: content.trim(), updatedAt: new Date() })
    .where(and(eq(leadNotes.tenantId, tenantId), eq(leadNotes.id, noteId)));
  return getLeadDetails(tenantId, note.leadId);
}

export async function addContactLog(
  tenantId: string,
  leadId: number,
  channel: string,
  details?: string
) {
  const db = await requireDb();
  const lead = await getLeadById(tenantId, leadId);
  if (!lead) return undefined;
  await db.insert(contactLogs).values({
    tenantId,
    leadId,
    channel: channel.trim(),
    details: details?.trim() || null,
  });
  return getLeadDetails(tenantId, leadId);
}

export async function createSearchHistory(input: {
  tenantId: string;
  segment: string;
  city: string;
  state: string;
  resultCount: number;
}) {
  const db = await requireDb();
  await db.insert(searches).values(input);
}

export async function listSearchHistory(tenantId: string) {
  const db = await requireDb();
  return db
    .select()
    .from(searches)
    .where(eq(searches.tenantId, tenantId))
    .orderBy(desc(searches.createdAt))
    .limit(12);
}

export async function getSearchById(tenantId: string, searchId: number) {
  const db = await requireDb();
  const result = await db
    .select()
    .from(searches)
    .where(and(eq(searches.tenantId, tenantId), eq(searches.id, searchId)))
    .limit(1);
  return result[0];
}

export async function getLeadMetrics(tenantId: string) {
  const db = await requireDb();
  const [total] = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(eq(leads.tenantId, tenantId));
  const byStatus = await db
    .select({ status: leads.status, count: sql<number>`count(*)` })
    .from(leads)
    .where(eq(leads.tenantId, tenantId))
    .groupBy(leads.status);
  return { total: Number(total?.count ?? 0), byStatus: byStatus.map(row => ({ ...row, count: Number(row.count) })) };
}

export function isProjectOwner(openId: string) {
  return openId === ENV.ownerOpenId;
}
