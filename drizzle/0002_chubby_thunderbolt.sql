CREATE TABLE "cakto_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" varchar(64) NOT NULL,
	"plan" varchar(16) DEFAULT 'free' NOT NULL,
	"email" varchar(320),
	"customerName" varchar(160),
	"customerPhone" varchar(32),
	"orderId" varchar(128),
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"claimedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cakto_payments_token_unique" UNIQUE("token"),
	CONSTRAINT "cakto_payments_orderId_unique" UNIQUE("orderId")
);
--> statement-breakpoint
CREATE INDEX "cakto_payments_email_idx" ON "cakto_payments" USING btree ("email");