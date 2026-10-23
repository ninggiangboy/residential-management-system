-- The schema `residency` is created by ops/postgres/0000-bootstrap.sql before any module migration (DOC-14 §2.2).
CREATE TABLE "residency"."membership" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"member_type" text NOT NULL,
	"can_pay" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"locked_by" text,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"added_by_kind" text NOT NULL,
	"added_by" uuid NOT NULL,
	"invited_at" timestamp with time zone,
	"note" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_membership" PRIMARY KEY("id"),
	CONSTRAINT "ck_membership_type" CHECK ("residency"."membership"."member_type" IN ('owner', 'family', 'tenant', 'helper')),
	CONSTRAINT "ck_membership_status" CHECK ("residency"."membership"."status" IN ('active', 'locked', 'removed')),
	CONSTRAINT "ck_membership_locked_by" CHECK ("residency"."membership"."locked_by" IN ('owner', 'manager')),
	CONSTRAINT "ck_membership_credential_version" CHECK ("residency"."membership"."credential_version" >= 1),
	CONSTRAINT "ck_membership_added_by_kind" CHECK ("residency"."membership"."added_by_kind" IN ('staff', 'resident')),
	CONSTRAINT "membership_locked_by_iff_locked" CHECK (("residency"."membership"."status" = 'locked') = ("residency"."membership"."locked_by" IS NOT NULL)),
	CONSTRAINT "membership_removed_at_iff_removed" CHECK (("residency"."membership"."status" = 'removed') = ("residency"."membership"."removed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "residency"."inbox" (
	"message_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_message_id_handler_pk" PRIMARY KEY("message_id","handler")
);
--> statement-breakpoint
CREATE TABLE "residency"."outbox_messages" (
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
CREATE TABLE "residency"."resident_profile" (
	"building_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"full_name" text,
	"email" "citext",
	"cccd_enc" text,
	"cccd_last4" text,
	"date_of_birth" date,
	"note" text,
	"cleared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_resident_profile" PRIMARY KEY("building_id","account_id"),
	CONSTRAINT "ck_resident_profile_cccd_last4" CHECK ("residency"."resident_profile"."cccd_last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "ck_resident_profile_name_unless_cleared" CHECK ("residency"."resident_profile"."cleared_at" IS NOT NULL OR "residency"."resident_profile"."full_name" IS NOT NULL),
	CONSTRAINT "resident_profile_cccd_pair" CHECK (("residency"."resident_profile"."cccd_enc" IS NULL) = ("residency"."resident_profile"."cccd_last4" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "residency"."unit" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"code" text NOT NULL,
	"floor" smallint,
	"bedrooms" smallint,
	"area_m2" numeric(8, 2),
	"occupancy" text DEFAULT 'vacant' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_unit" PRIMARY KEY("id"),
	CONSTRAINT "ck_unit_bedrooms" CHECK ("residency"."unit"."bedrooms" >= 0),
	CONSTRAINT "ck_unit_area" CHECK ("residency"."unit"."area_m2" > 0),
	CONSTRAINT "ck_unit_occupancy" CHECK ("residency"."unit"."occupancy" IN ('occupied', 'rented', 'vacant'))
);
--> statement-breakpoint
CREATE TABLE "residency"."unit_history" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "pk_unit_history" PRIMARY KEY("id"),
	CONSTRAINT "ck_unit_history_kind" CHECK ("residency"."unit_history"."kind" IN ('owner_changed', 'moved_in', 'moved_out', 'member_added', 'member_removed')),
	CONSTRAINT "ck_unit_history_actor_kind" CHECK ("residency"."unit_history"."actor_kind" IN ('staff', 'resident', 'system')),
	CONSTRAINT "unit_history_actor_id" CHECK (("residency"."unit_history"."actor_kind" = 'system') = ("residency"."unit_history"."actor_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "residency"."membership" ADD CONSTRAINT "fk_membership_unit" FOREIGN KEY ("unit_id") REFERENCES "residency"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residency"."unit_history" ADD CONSTRAINT "fk_unit_history_unit" FOREIGN KEY ("unit_id") REFERENCES "residency"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_one_owner_per_unit" ON "residency"."membership" USING btree ("building_id","unit_id") WHERE "residency"."membership"."member_type" = 'owner' AND "residency"."membership"."status" <> 'removed';--> statement-breakpoint
CREATE UNIQUE INDEX "membership_one_per_account_unit" ON "residency"."membership" USING btree ("account_id","unit_id") WHERE "residency"."membership"."status" <> 'removed';--> statement-breakpoint
CREATE INDEX "membership_unit_idx" ON "residency"."membership" USING btree ("building_id","unit_id","status");--> statement-breakpoint
CREATE INDEX "membership_building_active_idx" ON "residency"."membership" USING btree ("building_id","id") WHERE "residency"."membership"."status" = 'active';--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "residency"."outbox_messages" USING btree ("next_attempt_at") WHERE "residency"."outbox_messages"."published_at" is null and "residency"."outbox_messages"."dead_at" is null;--> statement-breakpoint
CREATE INDEX "resident_profile_name_trgm_idx" ON "residency"."resident_profile" USING gin (lower(platform.immutable_unaccent("full_name")) gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "unit_code_key" ON "residency"."unit" USING btree ("building_id","code");--> statement-breakpoint
CREATE INDEX "unit_code_prefix_idx" ON "residency"."unit" USING btree ("building_id",lower("code") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "unit_history_unit_idx" ON "residency"."unit_history" USING btree ("building_id","unit_id","at" DESC);