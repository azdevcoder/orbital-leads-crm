import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { Parser } from "json2csv";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { checkSearchQuota, PLAN_IDS, planOf, type PlanId } from "@shared/plans";
import { PIPELINE_STATUSES, type PipelineStatus } from "../drizzle/schema";
import * as db from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { searchPlacesNew } from "./_core/map";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";

const statusSchema = z.enum(PIPELINE_STATUSES);
const leadFiltersSchema = z.object({
  status: statusSchema.optional(),
  segment: z.string().trim().max(160).optional(),
  city: z.string().trim().max(160).optional(),
  query: z.string().trim().max(160).optional(),
  selectedIds: z.array(z.number().int().positive()).max(500).optional(),
});

function safeUser(user: { id: number; name: string | null; email: string | null; phone?: string | null; role: "user" | "admin"; plan?: string | null }) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone ?? null, role: user.role, plan: planOf(user.plan).id };
}

function safeAdminUser(user: {
  id: number; openId: string; name: string | null; email: string | null; phone: string | null;
  role: "user" | "admin"; plan: string | null; quotaDay: string | null;
  dailySearches: number; dailyLeads: number; totalSearches: number;
  createdAt: Date; lastSignedIn: Date;
}) {
  return {
    id: user.id, openId: user.openId, name: user.name, email: user.email, phone: user.phone,
    role: user.role, plan: planOf(user.plan).id,
    quotaDay: user.quotaDay, dailySearches: user.dailySearches, dailyLeads: user.dailyLeads,
    totalSearches: user.totalSearches, createdAt: user.createdAt, lastSignedIn: user.lastSignedIn,
  };
}

function setLocalSession(
  res: Parameters<typeof getSessionCookieOptions> extends never ? never : any,
  req: any,
  token: string
) {
  res.cookie(COOKIE_NAME, token, {
    ...getSessionCookieOptions(req),
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

function translateBusinessStatus(openNow?: boolean, rawStatus?: string) {
  if (openNow === false || rawStatus === "CLOSED_TEMPORARILY" || rawStatus === "CLOSED_PERMANENTLY") {
    return "Fechado";
  }
  return "Aberto";
}

async function searchAndCapture(input: {
  tenantId: string;
  segment: string;
  city: string;
  state: string;
  maxResults: number;
}) {
  const query = `${input.segment} em ${input.city}, ${input.state}`;
  // Places API (New): o searchText já devolve telefone/website na field mask.
  const search = await searchPlacesNew(query, input.maxResults);
  const details = (search.places ?? []).map(place => ({
    placeId: place.id,
    name: place.displayName?.text || "Sem nome",
    phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
    fullAddress: place.formattedAddress ?? null,
    website: place.websiteUri ?? null,
    rating: place.rating ?? null,
    businessStatus: translateBusinessStatus(undefined, place.businessStatus),
    segment: input.segment,
    city: input.city,
    state: input.state,
  }));

  const saved = await db.upsertCapturedLeads(input.tenantId, details);
  await db.createSearchHistory({
    tenantId: input.tenantId,
    segment: input.segment,
    city: input.city,
    state: input.state,
    resultCount: saved,
  });
  return { saved, query };
}

function makeExportRows(leads: Awaited<ReturnType<typeof db.listLeads>>) {
  return leads.map(lead => ({
    Nome: lead.name,
    Telefone: lead.phone ?? "",
    "Endereço completo": lead.fullAddress ?? "",
    Website: lead.website ?? "",
    Avaliação: lead.rating ?? "",
    Status: lead.status,
    "Status Google": lead.businessStatus,
    Segmento: lead.segment,
    Cidade: lead.city,
    UF: lead.state,
  }));
}

const exportColumns = [
  { label: "Nome", value: "Nome" },
  { label: "Telefone", value: "Telefone" },
  { label: "Endereço completo", value: "Endereço completo" },
  { label: "Website", value: "Website" },
  { label: "Avaliação", value: "Avaliação" },
  { label: "Status", value: "Status" },
  { label: "Status Google", value: "Status Google" },
  { label: "Segmento", value: "Segmento" },
  { label: "Cidade", value: "Cidade" },
  { label: "UF", value: "UF" },
] as const;

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => (opts.ctx.user ? safeUser(opts.ctx.user) : null)),
    register: publicProcedure
      .input(
        z.object({
          name: z.string().trim().min(2, "Indique o seu nome.").max(160),
          email: z.string().trim().email("Indique um email válido.").max(320),
          phone: z.string().trim().min(8, "Indique um telefone válido.").max(32),
          password: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres.").max(128),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await db.getUserByEmail(input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "Já existe uma conta com este email." });
        }
        const passwordHash = await bcrypt.hash(input.password, 12);
        const user = await db.createLocalUser({ name: input.name, email: input.email, phone: input.phone, passwordHash });
        if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar a conta." });
        const token = await sdk.createSessionToken(user.openId, { name: user.name || input.name });
        setLocalSession(ctx.res, ctx.req, token);
        return safeUser(user);
      }),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().trim().email(),
          password: z.string().min(1).max(128),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await db.getUserByEmail(input.email);
        if (!user?.passwordHash || !(await bcrypt.compare(input.password, user.passwordHash))) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Email ou palavra-passe inválidos." });
        }
        await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
        const token = await sdk.createSessionToken(user.openId, { name: user.name || user.email || "Utilizador" });
        setLocalSession(ctx.res, ctx.req, token);
        return safeUser(user);
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    updateProfile: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(160),
          email: z.string().trim().email().max(320),
          phone: z.string().trim().min(8).max(32).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const emailOwner = await db.getUserByEmail(input.email);
        if (emailOwner && emailOwner.id !== ctx.user.id) {
          throw new TRPCError({ code: "CONFLICT", message: "Este email já está associado a outra conta." });
        }
        const user = await db.updateUserProfile(ctx.user.id, input);
        if (!user) throw new TRPCError({ code: "NOT_FOUND" });
        return safeUser(user);
      }),
    changePassword: protectedProcedure
      .input(
        z.object({
          currentPassword: z.string().min(1).max(128),
          newPassword: z.string().min(8).max(128),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user.passwordHash || !(await bcrypt.compare(input.currentPassword, ctx.user.passwordHash))) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "A palavra-passe atual está incorreta." });
        }
        await db.updateUserPassword(ctx.user.id, await bcrypt.hash(input.newPassword, 12));
        return { success: true } as const;
      }),
  }),
  places: router({
    search: protectedProcedure
      .input(
        z.object({
          segment: z.string().trim().min(2).max(160),
          city: z.string().trim().min(2).max(160),
          state: z.string().trim().min(2).max(8).transform(value => value.toUpperCase()),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const quota = checkSearchQuota(ctx.user);
        if (!quota.allowed) {
          throw new TRPCError({ code: "FORBIDDEN", message: quota.reason });
        }
        try {
          const result = await searchAndCapture({ ...input, tenantId: ctx.user.openId, maxResults: quota.maxResults });
          await db.recordSearchUsage(ctx.user.openId, result.saved);
          return result;
        } catch (error) {
          console.error("[Places] Lead capture failed", error);
          throw new TRPCError({ code: "BAD_GATEWAY", message: "Não foi possível consultar o Google Places neste momento." });
        }
      }),
    history: protectedProcedure.query(({ ctx }) => db.listSearchHistory(ctx.user.openId)),
    quota: protectedProcedure.query(({ ctx }) => {
      const check = checkSearchQuota(ctx.user);
      return {
        plan: check.plan,
        allowed: check.allowed,
        reason: check.reason ?? null,
        maxResults: check.maxResults,
        searchesLeft: check.searchesLeft,
        leadsLeft: check.leadsLeft,
      };
    }),
    rerun: protectedProcedure
      .input(z.object({ searchId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const history = await db.getSearchById(ctx.user.openId, input.searchId);
        if (!history) throw new TRPCError({ code: "NOT_FOUND", message: "Busca não encontrada." });
        const quota = checkSearchQuota(ctx.user);
        if (!quota.allowed) {
          throw new TRPCError({ code: "FORBIDDEN", message: quota.reason });
        }
        try {
          const result = await searchAndCapture({
            tenantId: ctx.user.openId,
            segment: history.segment,
            city: history.city,
            state: history.state,
            maxResults: quota.maxResults,
          });
          await db.recordSearchUsage(ctx.user.openId, result.saved);
          return result;
        } catch (error) {
          console.error("[Places] Lead capture failed", error);
          throw new TRPCError({ code: "BAD_GATEWAY", message: "Não foi possível consultar o Google Places neste momento." });
        }
      }),
  }),
  leads: router({
    list: protectedProcedure.input(leadFiltersSchema).query(({ ctx, input }) => db.listLeads(ctx.user.openId, input)),
    details: protectedProcedure
      .input(z.object({ leadId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const details = await db.getLeadDetails(ctx.user.openId, input.leadId);
        if (!details) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
        return details;
      }),
    updateStatus: protectedProcedure
      .input(z.object({ leadId: z.number().int().positive(), status: statusSchema }))
      .mutation(async ({ ctx, input }) => {
        const lead = await db.updateLeadStatus(ctx.user.openId, input.leadId, input.status as PipelineStatus);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
        return lead;
      }),
    updateDetails: protectedProcedure
      .input(
        z.object({
          leadId: z.number().int().positive(),
          phone: z.string().trim().max(64).nullable().optional(),
          website: z.string().trim().url().max(512).nullable().optional(),
          fullAddress: z.string().trim().max(1000).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { leadId, ...values } = input;
        const lead = await db.updateLeadDetails(ctx.user.openId, leadId, values);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
        return lead;
      }),
    addNote: protectedProcedure
      .input(z.object({ leadId: z.number().int().positive(), content: z.string().trim().min(1).max(5000) }))
      .mutation(async ({ ctx, input }) => {
        const details = await db.addLeadNote(ctx.user.openId, input.leadId, input.content);
        if (!details) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
        return details;
      }),
    updateNote: protectedProcedure
      .input(z.object({ noteId: z.number().int().positive(), content: z.string().trim().min(1).max(5000) }))
      .mutation(async ({ ctx, input }) => {
        const details = await db.updateLeadNote(ctx.user.openId, input.noteId, input.content);
        if (!details) throw new TRPCError({ code: "NOT_FOUND", message: "Nota não encontrada." });
        return details;
      }),
    addContact: protectedProcedure
      .input(
        z.object({
          leadId: z.number().int().positive(),
          channel: z.string().trim().min(2).max(48),
          details: z.string().trim().max(2000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const details = await db.addContactLog(ctx.user.openId, input.leadId, input.channel, input.details);
        if (!details) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
        return details;
      }),
    metrics: protectedProcedure.query(({ ctx }) => db.getLeadMetrics(ctx.user.openId)),
    export: protectedProcedure
      .input(z.object({ format: z.enum(["csv", "xlsx"]), filters: leadFiltersSchema }))
      .mutation(async ({ ctx, input }) => {
        const result = await db.listLeads(ctx.user.openId, input.filters);
        const rows = makeExportRows(result);
        const stamp = new Date().toISOString().slice(0, 10);
        if (input.format === "csv") {
          const parser = new Parser({ withBOM: true, fields: [...exportColumns] });
          const csv = parser.parse(rows);
          return {
            filename: `leads-${stamp}.csv`,
            mimeType: "text/csv;charset=utf-8",
            base64: Buffer.from(csv, "utf-8").toString("base64"),
          };
        }
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Leads");
        sheet.columns = exportColumns.map(column => ({ header: column.label, key: column.value, width: 24 }));
        sheet.addRows(rows);
        sheet.getRow(1).font = { bold: true };
        const buffer = await workbook.xlsx.writeBuffer();
        return {
          filename: `leads-${stamp}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          base64: Buffer.from(buffer).toString("base64"),
        };
      }),
  }),
  admin: router({
    listUsers: adminProcedure.query(async () => {
      const users = await db.listAllUsers();
      return users.map(safeAdminUser);
    }),
    createUser: adminProcedure
      .input(
        z.object({
          name: z.string().trim().min(2, "Indique o nome.").max(160),
          email: z.string().trim().email("Indique um email válido.").max(320),
          phone: z.string().trim().min(8, "Indique um telefone válido.").max(32),
          password: z.string().min(8, "Mínimo 8 caracteres.").max(128),
          plan: z.enum(PLAN_IDS).default("free"),
        })
      )
      .mutation(async ({ input }) => {
        const existing = await db.getUserByEmail(input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "Já existe uma conta com este email." });
        }
        const passwordHash = await bcrypt.hash(input.password, 12);
        const user = await db.createLocalUser({
          name: input.name,
          email: input.email,
          phone: input.phone,
          passwordHash,
          plan: input.plan as PlanId,
        });
        if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar a conta." });
        return safeAdminUser(user);
      }),
    setPlan: adminProcedure
      .input(z.object({ openId: z.string().min(1), plan: z.enum(PLAN_IDS) }))
      .mutation(async ({ input }) => {
        const user = await db.setUserPlan(input.openId, input.plan as PlanId);
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Utilizador não encontrado." });
        return safeAdminUser(user);
      }),
  }),
});

export type AppRouter = typeof appRouter;
