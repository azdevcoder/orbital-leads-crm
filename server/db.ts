import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  contactLogs,
  leads,
  leadNotes,
  type InsertUser,
  type PipelineStatus,
  searches,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

export type LeadFilters = {
  status?: PipelineStatus;
  segment?: string;
  city?: string;
  query?: string;
  selectedIds?: number[];
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
      _pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
    role?: "user" | "admin";
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
  passwordHash: string;
}) {
  const db = await requireDb();
  const email = input.email.trim().toLowerCase();
  const openId = `local_${randomUUID()}`;
  await db.insert(users).values({
    openId,
    name: input.name.trim(),
    email,
    passwordHash: input.passwordHash,
    loginMethod: "email",
    lastSignedIn: new Date(),
  });
  return getUserByOpenId(openId);
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
  input: { name?: string; email?: string }
) {
  const db = await requireDb();
  const values: { name?: string; email?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name.trim();
  if (input.email !== undefined) values.email = input.email.trim().toLowerCase();
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
  if (filters.query?.trim()) {
    const term = `%${filters.query.trim()}%`;
    conditions.push(
      or(
        like(leads.name, term),
        like(leads.phone, term),
        like(leads.fullAddress, term),
        like(leads.website, term)
      )!
    );
  }
  return and(...conditions);
}

export async function listLeads(tenantId: string, filters: LeadFilters = {}) {
  const db = await requireDb();
  return db
    .select()
    .from(leads)
    .where(leadConditions(tenantId, filters))
    .orderBy(desc(leads.updatedAt));
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
  input: { phone?: string | null; website?: string | null; fullAddress?: string | null }
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
