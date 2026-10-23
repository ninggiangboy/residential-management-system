CREATE TABLE "identity"."otp_challenge" (
	"id" uuid NOT NULL,
	"phone" text NOT NULL,
	"code_hmac" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resend_after" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_otp_challenge" PRIMARY KEY("id"),
	CONSTRAINT "ck_otp_challenge_attempts" CHECK ("identity"."otp_challenge"."attempts" BETWEEN 0 AND 5),
	CONSTRAINT "ck_otp_challenge_expiry" CHECK ("identity"."otp_challenge"."expires_at" > "identity"."otp_challenge"."created_at")
);
--> statement-breakpoint
CREATE TABLE "identity"."resident_account" (
	"id" uuid NOT NULL,
	"phone" text NOT NULL,
	"display_name" text,
	"avatar_key" text,
	"language" text DEFAULT 'vi' NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"last_app_open_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"deletion_approved_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_resident_account" PRIMARY KEY("id"),
	CONSTRAINT "ck_resident_account_phone" CHECK ("identity"."resident_account"."phone" ~ '^[+][1-9][0-9]{6,14}$' OR "identity"."resident_account"."phone" ~ '^deleted:[0-9a-f-]{36}$'),
	CONSTRAINT "ck_resident_account_language" CHECK ("identity"."resident_account"."language" IN ('vi', 'en')),
	CONSTRAINT "ck_resident_account_status" CHECK ("identity"."resident_account"."status" IN ('active', 'deletion_requested', 'deleted')),
	CONSTRAINT "ck_resident_account_name_unless_deleted" CHECK ("identity"."resident_account"."status" = 'deleted' OR "identity"."resident_account"."display_name" IS NOT NULL),
	CONSTRAINT "ck_resident_account_deletion_dates" CHECK (("identity"."resident_account"."status" = 'active' AND "identity"."resident_account"."deletion_requested_at" IS NULL AND "identity"."resident_account"."deletion_approved_at" IS NULL AND "identity"."resident_account"."deleted_at" IS NULL)
        OR ("identity"."resident_account"."status" = 'deletion_requested' AND "identity"."resident_account"."deletion_requested_at" IS NOT NULL AND "identity"."resident_account"."deleted_at" IS NULL)
        OR ("identity"."resident_account"."status" = 'deleted' AND "identity"."resident_account"."deleted_at" IS NOT NULL)),
	CONSTRAINT "ck_resident_account_deleted_phone" CHECK (("identity"."resident_account"."status" = 'deleted') = ("identity"."resident_account"."phone" LIKE 'deleted:%'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "otp_challenge_one_live_per_phone" ON "identity"."otp_challenge" USING btree ("phone") WHERE "identity"."otp_challenge"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "otp_challenge_created_idx" ON "identity"."otp_challenge" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resident_account_phone_key" ON "identity"."resident_account" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "resident_account_phone_suffix_idx" ON "identity"."resident_account" USING btree (reverse("phone") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "resident_account_deletion_idx" ON "identity"."resident_account" USING btree ("deletion_approved_at") WHERE "identity"."resident_account"."status" = 'deletion_requested' AND "identity"."resident_account"."deletion_approved_at" IS NOT NULL;