import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { Parser } from "json2csv";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { PIPELINE_STATUSES, type PipelineStatus } from "../drizzle/schema";
import * as db from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { makeRequest, type PlaceDetailsResult, type PlacesSearchResult } from "./_core/map";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

const statusSchema = z.enum(PIPELINE_STATUSES);
const leadFiltersSchema = z.object({
  status: statusSchema.optional(),
  segment: z.string().trim().max(160).optional(),
  city: z.string().trim().max(160).optional(),
  query: z.string().trim().max(160).optional(),
  selectedIds: z.array(z.number().int().positive()).max(500).optional(),
});

function safeUser(user: { id: number; name: string | null; email: string | null; role: "user" | "admin" }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
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
}) {
  const query = `${input.segment} em ${input.city}, ${input.state}`;
  const search = await makeRequest<PlacesSearchResult>(
    "/maps/api/place/textsearch/json",
    { query }
  );
  const candidates = search.results.slice(0, 20);
  const details = await Promise.all(
    candidates.map(async place => {
      try {
        const response = await makeRequest<PlaceDetailsResult>(
          "/maps/api/place/details/json",
          {
            place_id: place.place_id,
            fields: "place_id,name,formatted_address,formatted_phone_number,international_phone_number,website,rating,opening_hours",
          }
        );
        const result = response.result;
        return {
          placeId: result.place_id || place.place_id,
          name: result.name || place.name,
          phone: result.international_phone_number ?? result.formatted_phone_number ?? null,
          fullAddress: result.formatted_address ?? place.formatted_address ?? null,
          website: result.website ?? null,
          rating: result.rating ?? place.rating ?? null,
          businessStatus: translateBusinessStatus(result.opening_hours?.open_now, place.business_status),
          segment: input.segment,
          city: input.city,
          state: input.state,
        };
      } catch {
        return {
          placeId: place.place_id,
          name: place.name,
          phone: null,
          fullAddress: place.formatted_address ?? null,
          website: null,
          rating: place.rating ?? null,
          businessStatus: translateBusinessStatus(undefined, place.business_status),
          segment: input.segment,
          city: input.city,
          state: input.state,
        };
      }
    })
  );

  const saved = await db.upsertCapturedLeads(input.tenantId, details);
  await db.createSearchHistory({ ...input, resultCount: saved });
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
          password: z.string().min(8, "A palavra-passe deve ter pelo menos 8 caracteres.").max(128),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await db.getUserByEmail(input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "Já existe uma conta com este email." });
        }
        const passwordHash = await bcrypt.hash(input.password, 12);
        const user = await db.createLocalUser({ name: input.name, email: input.email, passwordHash });
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
        try {
          return await searchAndCapture({ ...input, tenantId: ctx.user.openId });
        } catch (error) {
          console.error("[Places] Lead capture failed", error);
          throw new TRPCError({ code: "BAD_GATEWAY", message: "Não foi possível consultar o Google Places neste momento." });
        }
      }),
    history: protectedProcedure.query(({ ctx }) => db.listSearchHistory(ctx.user.openId)),
    rerun: protectedProcedure
      .input(z.object({ searchId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const history = await db.getSearchById(ctx.user.openId, input.searchId);
        if (!history) throw new TRPCError({ code: "NOT_FOUND", message: "Busca não encontrada." });
        return searchAndCapture({
          tenantId: ctx.user.openId,
          segment: history.segment,
          city: history.city,
          state: history.state,
        });
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
});

export type AppRouter = typeof appRouter;
