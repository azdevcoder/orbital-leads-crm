import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const PIPELINE_STATUSES = [
  "Novo",
  "Contatado",
  "Em Negociação",
  "Fechado",
  "Perdido",
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];
export const pipelineStatusEnum = pgEnum("pipeline_status", PIPELINE_STATUSES);
export const userRoleEnum = pgEnum("user_role", ["user", "vendedor", "admin"]);

/** Cada utilizador é um tenant independente da aplicação. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 160 }),
  email: varchar("email", { length: 320 }).unique(),
  phone: varchar("phone", { length: 32 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  signupIp: varchar("signupIp", { length: 45 }),
  loginMethod: varchar("loginMethod", { length: 64 }).default("email"),
  role: userRoleEnum("role").default("user").notNull(),
  plan: varchar("plan", { length: 16 }).default("free").notNull(),
  quotaDay: varchar("quotaDay", { length: 10 }),
  dailySearches: integer("dailySearches").default(0).notNull(),
  dailyLeads: integer("dailyLeads").default(0).notNull(),
  totalSearches: integer("totalSearches").default(0).notNull(),
  totalLeads: integer("totalLeads").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    placeId: varchar("placeId", { length: 255 }),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 64 }),
    email: varchar("email", { length: 320 }),
    fullAddress: text("fullAddress"),
    website: varchar("website", { length: 512 }),
    rating: numeric("rating", { precision: 3, scale: 1 }),
    businessStatus: varchar("businessStatus", { length: 32 }).default("Aberto").notNull(),
    status: pipelineStatusEnum("status").default("Novo").notNull(),
    segment: varchar("segment", { length: 160 }).notNull(),
    city: varchar("city", { length: 160 }).notNull(),
    state: varchar("state", { length: 8 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [
    index("leads_tenant_idx").on(table.tenantId),
    index("leads_tenant_status_idx").on(table.tenantId, table.status),
    index("leads_tenant_city_idx").on(table.tenantId, table.city),
    uniqueIndex("leads_tenant_place_unique").on(table.tenantId, table.placeId),
  ]
);

export const leadNotes = pgTable(
  "lead_notes",
  {
    id: serial("id").primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    leadId: integer("leadId").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [index("lead_notes_tenant_lead_idx").on(table.tenantId, table.leadId)]
);

export const contactLogs = pgTable(
  "contact_logs",
  {
    id: serial("id").primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    leadId: integer("leadId").notNull(),
    channel: varchar("channel", { length: 48 }).notNull(),
    details: text("details"),
    contactedAt: timestamp("contactedAt").defaultNow().notNull(),
  },
  table => [index("contact_logs_tenant_lead_idx").on(table.tenantId, table.leadId)]
);

export const searches = pgTable(
  "searches",
  {
    id: serial("id").primaryKey(),
    tenantId: varchar("tenantId", { length: 128 }).notNull(),
    segment: varchar("segment", { length: 160 }).notNull(),
    city: varchar("city", { length: 160 }).notNull(),
    state: varchar("state", { length: 8 }).notNull(),
    resultCount: integer("resultCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("searches_tenant_created_idx").on(table.tenantId, table.createdAt)]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Pagamentos Cakto: liga o token de callback ao pedido e ao plano liberado. */
export const caktoPayments = pgTable(
  "cakto_payments",
  {
    id: serial("id").primaryKey(),
    /** token opaco gerado no checkout (?callback=) ou no pedido */
    token: varchar("token", { length: 64 }).notNull().unique(),
    plan: varchar("plan", { length: 16 }).default("free").notNull(),
    email: varchar("email", { length: 320 }),
    customerName: varchar("customerName", { length: 160 }),
    customerPhone: varchar("customerPhone", { length: 32 }),
    orderId: varchar("orderId", { length: 128 }).unique(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    claimedAt: timestamp("claimedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("cakto_payments_email_idx").on(table.email)]
);

export type CaktoPayment = typeof caktoPayments.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type LeadNote = typeof leadNotes.$inferSelect;
export type ContactLog = typeof contactLogs.$inferSelect;
export type SearchHistory = typeof searches.$inferSelect;
