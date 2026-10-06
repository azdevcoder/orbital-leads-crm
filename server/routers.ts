import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { Parser } from "json2csv";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { checkSearchQuota, PLAN_IDS, planHasCrm, planHasExport, planOf, type PlanId } from "@shared/plans";
import { ROLE_IDS, type RoleId } from "@shared/roles";
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
  hasPhone: z.boolean().optional(),
  sortBy: z.enum(["name", "segment", "location", "rating", "status"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

function safeUser(user: { id: number; name: string | null; email: string | null; phone?: string | null; role: RoleId; plan?: string | null }) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone ?? null, role: user.role, plan: planOf(user.plan).id };
}

function safeAdminUser(user: {
  id: number; openId: string; name: string | null; email: string | null; phone: string | null;
  role: RoleId; plan: string | null; quotaDay: string | null;
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
    Email: lead.email ?? "",
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
  { label: "Email", value: "Email" },
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
        // Anti-abuso: limite de contas gratuitas por IP (família/escritório ok, fazendas não).
        const signupIp =
          (typeof ctx.req.ip === "string" && ctx.req.ip) ||
          ctx.req.socket?.remoteAddress ||
          null;
        if (signupIp) {
          const used = await db.countAccountsByIp(signupIp);
          if (used >= db.freeAccountsPerIpLimit()) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "Limite de contas gratuitas atingido nesta conexão. Fale com o time Orbital para liberar mais acessos.",
            });
          }
        }
        const passwordHash = await bcrypt.hash(input.password, 12);
        const user = await db.createLocalUser({ name: input.name, email: input.email, phone: input.phone, passwordHash, signupIp });
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
    claimAccess: publicProcedure
      .input(
        z.object({
          token: z.string().trim().min(8).max(64),
          password: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres.").max(128),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Resgate do acesso comprado na Cakto (link de uso único).
        const payment = await db.getCaktoPaymentByToken(input.token);
        if (!payment || payment.status !== "paid" || payment.claimedAt || !payment.email) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Link de ativação inválido ou já utilizado." });
        }
        const plan = planOf(payment.plan).id;
        const email = payment.email;
        const passwordHash = await bcrypt.hash(input.password, 12);
        let user = await db.getUserByEmail(email);
        if (!user) {
          user = await db.createLocalUser({
            name: (payment.customerName ?? "").trim() || email.split("@")[0],
            email,
            phone: (payment.customerPhone ?? "").trim() || "-",
            passwordHash,
            plan,
          });
        } else {
          await db.setUserPasswordByEmail(email, passwordHash);
          if (user.plan !== plan) await db.setUserPlan(user.openId, plan);
          user = await db.getUserByEmail(email);
        }
        if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível ativar o acesso." });
        await db.markCaktoPaymentClaimed(input.token);
        const token = await sdk.createSessionToken(user.openId, { name: user.name || user.email || "Utilizador" });
        setLocalSession(ctx.res, ctx.req, token);
        return safeUser(user);
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
        totalLeadsLeft: check.totalLeadsLeft,
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
        if (!planHasCrm(ctx.user.plan)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "O Kanban está disponível a partir do plano Plus." });
        }
        const lead = await db.updateLeadStatus(ctx.user.openId, input.leadId, input.status as PipelineStatus);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
        return lead;
      }),
    updateDetails: protectedProcedure
      .input(
        z.object({
          leadId: z.number().int().positive(),
          phone: z.string().trim().max(64).nullable().optional(),
          email: z.string().trim().email("Indique um email válido.").max(320).nullable().optional(),
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
        if (!planHasExport(ctx.user.plan)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "A exportação está disponível a partir do plano Plus." });
        }
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
    resetPassword: adminProcedure
      .input(z.object({ openId: z.string().min(1) }))
      .mutation(async ({ input }) => {
        // Apoio a vendas Cakto: gera senha temporária de uso único para repassar ao cliente.
        const user = await db.getUserByOpenId(input.openId);
        if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Utilizador não encontrado." });
        const tempPassword = nanoid(12);
        await db.updateUserPassword(user.id, await bcrypt.hash(tempPassword, 12));
        return { tempPassword };
      }),
    updateUser: adminProcedure
      .input(
        z.object({
          openId: z.string().min(1),
          name: z.string().trim().min(2).max(160).optional(),
          email: z.string().trim().email("Indique um email válido.").max(320).optional(),
          phone: z.string().trim().min(8).max(32).optional(),
          plan: z.enum(PLAN_IDS).optional(),
          role: z.enum(ROLE_IDS).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { openId, ...values } = input;
        try {
          const user = await db.adminUpdateUser(openId, values as { name?: string; email?: string; phone?: string; plan?: PlanId; role?: RoleId });
          if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Utilizador não encontrado." });
          return safeAdminUser(user);
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          throw new TRPCError({ code: "CONFLICT", message: error instanceof Error ? error.message : "Não foi possível atualizar." });
        }
      }),
    deleteUser: adminProcedure
      .input(z.object({ openId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        if (input.openId === ctx.user.openId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Não é possível excluir a própria conta de administrador." });
        }
        const target = await db.getUserByOpenId(input.openId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Utilizador não encontrado." });
        await db.deleteUserAccount(input.openId);
        return { success: true as const };
      }),
  }),
  cakto: router({
    checkout: publicProcedure
      .input(z.object({ plan: z.enum(["start", "plus", "scale"]) }))
      .mutation(async ({ input }) => {
        // Gera token opaco, regista a intenção e devolve o checkout com ?callback=token.
        const base = {
          start: process.env.CAKTO_CHECKOUT_START ?? "",
          plus: process.env.CAKTO_CHECKOUT_PLUS ?? "",
          scale: process.env.CAKTO_CHECKOUT_SCALE ?? "",
        }[input.plan];
        if (!base) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Checkout deste plano ainda não configurado. Fale com o time Orbital." });
        }
        const token = nanoid(24);
        await db.createCaktoPayment({ token, plan: input.plan });
        const sep = base.includes("?") ? "&" : "?";
        return { url: `${base}${sep}callback=${token}` };
      }),
    claimInfo: publicProcedure
      .input(z.object({ token: z.string().trim().min(8).max(64) }))
      .query(async ({ input }) => {
        const payment = await db.getCaktoPaymentByToken(input.token);
        if (!payment || payment.status !== "paid" || payment.claimedAt || !payment.email) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Link de ativação inválido ou já utilizado." });
        }
        return { email: payment.email, plan: planOf(payment.plan) };
      }),
  }),
});

export type AppRouter = typeof appRouter;
