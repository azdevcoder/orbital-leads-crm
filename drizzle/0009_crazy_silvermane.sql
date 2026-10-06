ALTER TABLE "users" ADD COLUMN "planExpiresAt" timestamp;--> statement-breakpoint
ALTER TABLE "cakto_payments" DROP COLUMN "planExpiresAt";