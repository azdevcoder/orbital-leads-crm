ALTER TABLE "users" ADD COLUMN "phoneDigits" varchar(20);--> statement-breakpoint
UPDATE "users" SET "phoneDigits" = regexp_replace("phone", '\D', '', 'g') WHERE "phone" IS NOT NULL;--> statement-breakpoint
UPDATE "users" SET "phoneDigits" = substring("phoneDigits", 1, 4) || '9' || substring("phoneDigits", 5) WHERE "phoneDigits" ~ '^55[0-9]{10}$';--> statement-breakpoint
UPDATE "users" SET "phoneDigits" = NULL WHERE "phoneDigits" IS NULL OR length("phoneDigits") < 8;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phoneDigits_unique" UNIQUE("phoneDigits");