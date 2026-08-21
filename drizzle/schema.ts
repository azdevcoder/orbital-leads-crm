import {
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const PIPELINE_STATUSES = [
  "Novo",
  "Contatado",
  "Em Negociação",
  "Fechado",
  "Perdido",
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/**
 * Cada utilizador representa o seu próprio tenant. O openId permanece como o
 * identificador de sessão e permite a compatibilidade com o middleware da aplicação.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 160 }),
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }).default("email"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const leads = mysqlTable(
  "leads",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    placeId: varchar("placeId", { length: 255 }),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 64 }),
    fullAddress: text("fullAddress"),
    website: varchar("website", { length: 512 }),
    rating: decimal("rating", { precision: 3, scale: 1 }),
    businessStatus: varchar("businessStatus", { length: 32 }).default("Aberto").notNull(),
    status: mysqlEnum("status", PIPELINE_STATUSES).default("Novo").notNull(),
    segment: varchar("segment", { length: 160 }).notNull(),
    city: varchar("city", { length: 160 }).notNull(),
    state: varchar("state", { length: 8 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("leads_tenant_idx").on(table.tenantId),
    index("leads_tenant_status_idx").on(table.tenantId, table.status),
    index("leads_tenant_city_idx").on(table.tenantId, table.city),
    uniqueIndex("leads_tenant_place_unique").on(table.tenantId, table.placeId),
  ]
);

export const leadNotes = mysqlTable(
  "lead_notes",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    leadId: int("leadId").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("lead_notes_tenant_lead_idx").on(table.tenantId, table.leadId)]
);

export const contactLogs = mysqlTable(
  "contact_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    leadId: int("leadId").notNull(),
    channel: varchar("channel", { length: 48 }).notNull(),
    details: text("details"),
    contactedAt: timestamp("contactedAt").defaultNow().notNull(),
  },
  table => [index("contact_logs_tenant_lead_idx").on(table.tenantId, table.leadId)]
);

export const searches = mysqlTable(
  "searches",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    segment: varchar("segment", { length: 160 }).notNull(),
    city: varchar("city", { length: 160 }).notNull(),
    state: varchar("state", { length: 8 }).notNull(),
    resultCount: int("resultCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("searches_tenant_created_idx").on(table.tenantId, table.createdAt)]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type LeadNote = typeof leadNotes.$inferSelect;
export type ContactLog = typeof contactLogs.$inferSelect;
export type SearchHistory = typeof searches.$inferSelect;
