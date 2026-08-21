CREATE TYPE "public"."pipeline_status" AS ENUM('Novo', 'Contatado', 'Em Negociação', 'Fechado', 'Perdido');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "contact_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" varchar(128) NOT NULL,
	"leadId" integer NOT NULL,
	"channel" varchar(48) NOT NULL,
	"details" text,
	"contactedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" varchar(128) NOT NULL,
	"leadId" integer NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" varchar(128) NOT NULL,
	"placeId" varchar(255),
	"name" varchar(255) NOT NULL,
	"phone" varchar(64),
	"fullAddress" text,
	"website" varchar(512),
	"rating" numeric(3, 1),
	"businessStatus" varchar(32) DEFAULT 'Aberto' NOT NULL,
	"status" "pipeline_status" DEFAULT 'Novo' NOT NULL,
	"segment" varchar(160) NOT NULL,
	"city" varchar(160) NOT NULL,
	"state" varchar(8) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" varchar(128) NOT NULL,
	"segment" varchar(160) NOT NULL,
	"city" varchar(160) NOT NULL,
	"state" varchar(8) NOT NULL,
	"resultCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(128) NOT NULL,
	"name" varchar(160),
	"email" varchar(320),
	"passwordHash" varchar(255),
	"loginMethod" varchar(64) DEFAULT 'email',
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "contact_logs_tenant_lead_idx" ON "contact_logs" USING btree ("tenantId","leadId");--> statement-breakpoint
CREATE INDEX "lead_notes_tenant_lead_idx" ON "lead_notes" USING btree ("tenantId","leadId");--> statement-breakpoint
CREATE INDEX "leads_tenant_idx" ON "leads" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "leads_tenant_status_idx" ON "leads" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "leads_tenant_city_idx" ON "leads" USING btree ("tenantId","city");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_tenant_place_unique" ON "leads" USING btree ("tenantId","placeId");--> statement-breakpoint
CREATE INDEX "searches_tenant_created_idx" ON "searches" USING btree ("tenantId","createdAt");