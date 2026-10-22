-- The schema `identity` is created by ops/postgres/0000-bootstrap.sql before any module migration (DOC-14 §2.2).
CREATE TABLE "identity"."inbox" (
	"message_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_message_id_handler_pk" PRIMARY KEY("message_id","handler")
);
--> statement-breakpoint
CREATE TABLE "identity"."outbox_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"headers" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"published_at" timestamp with time zone,
	"dead_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "identity"."password_token" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"action" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_password_token" PRIMARY KEY("id"),
	CONSTRAINT "ck_password_token_kind" CHECK ("identity"."password_token"."kind" IN ('reset', 'invite', 'step_up')),
	CONSTRAINT "ck_password_token_action" CHECK ("identity"."password_token"."action" IS NULL OR "identity"."password_token"."action" IN ('gateway_config', 'admin_change', 'staff_email')),
	CONSTRAINT "ck_password_token_action_kind" CHECK (("identity"."password_token"."kind" = 'step_up') = ("identity"."password_token"."action" IS NOT NULL)),
	CONSTRAINT "ck_password_token_attempts" CHECK ("identity"."password_token"."attempts" BETWEEN 0 AND 5),
	CONSTRAINT "ck_password_token_expiry" CHECK ("identity"."password_token"."expires_at" > "identity"."password_token"."created_at")
);
--> statement-breakpoint
CREATE TABLE "identity"."rate_bucket" (
	"key" text NOT NULL,
	"tokens" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_rate_bucket" PRIMARY KEY("key")
);
--> statement-breakpoint
CREATE TABLE "identity"."refresh_family" (
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"building_id" uuid,
	"user_agent" text,
	"client" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "pk_refresh_family" PRIMARY KEY("id"),
	CONSTRAINT "ck_refresh_family_kind" CHECK ("identity"."refresh_family"."kind" IN ('staff', 'resident')),
	CONSTRAINT "ck_refresh_family_client" CHECK ("identity"."refresh_family"."client" IN ('web', 'app')),
	CONSTRAINT "ck_refresh_family_reason" CHECK ("identity"."refresh_family"."revoked_reason" IN ('sign_out', 'user_revoked', 'token_reuse', 'cap_exceeded', 'account_locked', 'account_disabled', 'role_changed', 'phone_changed', 'password_changed', 'deleted')),
	CONSTRAINT "ck_refresh_family_building" CHECK (("identity"."refresh_family"."kind" = 'staff') = ("identity"."refresh_family"."building_id" IS NOT NULL)),
	CONSTRAINT "ck_refresh_family_revocation" CHECK (("identity"."refresh_family"."revoked_at" IS NULL) = ("identity"."refresh_family"."revoked_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "identity"."refresh_token" (
	"id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	CONSTRAINT "pk_refresh_token" PRIMARY KEY("id"),
	CONSTRAINT "ck_refresh_token_replaced" CHECK ("identity"."refresh_token"."replaced_by_id" IS NULL OR "identity"."refresh_token"."revoked_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "identity"."staff_account" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"password_hash" text,
	"failed_attempts" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"language" text DEFAULT 'vi' NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"avatar_key" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_staff_account" PRIMARY KEY("id"),
	CONSTRAINT "ck_staff_account_role" CHECK ("identity"."staff_account"."role" IN ('admin', 'manager', 'technician', 'guard')),
	CONSTRAINT "ck_staff_account_status" CHECK ("identity"."staff_account"."status" IN ('invited', 'active', 'locked', 'disabled')),
	CONSTRAINT "ck_staff_account_attempts" CHECK ("identity"."staff_account"."failed_attempts" >= 0),
	CONSTRAINT "ck_staff_account_language" CHECK ("identity"."staff_account"."language" IN ('vi', 'en')),
	CONSTRAINT "ck_staff_account_password" CHECK ("identity"."staff_account"."status" = 'invited' OR "identity"."staff_account"."password_hash" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "identity"."password_token" ADD CONSTRAINT "fk_password_token_staff_account" FOREIGN KEY ("staff_id") REFERENCES "identity"."staff_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."refresh_token" ADD CONSTRAINT "fk_refresh_token_refresh_family" FOREIGN KEY ("family_id") REFERENCES "identity"."refresh_family"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "identity"."outbox_messages" USING btree ("next_attempt_at") WHERE "identity"."outbox_messages"."published_at" is null and "identity"."outbox_messages"."dead_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_password_token_link_hash" ON "identity"."password_token" USING btree ("token_hash") WHERE "identity"."password_token"."kind" IN ('reset', 'invite');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_password_token_one_live" ON "identity"."password_token" USING btree ("staff_id","kind",(COALESCE("action", ''))) WHERE "identity"."password_token"."consumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_password_token_created" ON "identity"."password_token" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_rate_bucket_updated" ON "identity"."rate_bucket" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "ix_refresh_family_account" ON "identity"."refresh_family" USING btree ("kind","account_id") WHERE "identity"."refresh_family"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_refresh_family_expiry" ON "identity"."refresh_family" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_refresh_token_hash" ON "identity"."refresh_token" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_refresh_token_family" ON "identity"."refresh_token" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_staff_account_email" ON "identity"."staff_account" USING btree ("email");--> statement-breakpoint
CREATE INDEX "ix_staff_account_building_role" ON "identity"."staff_account" USING btree ("building_id","role","status");