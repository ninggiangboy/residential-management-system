-- The schema `building` is created by ops/postgres/0000-bootstrap.sql before any module migration (DOC-14 §2.2).
CREATE TABLE "building"."inbox" (
	"message_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_message_id_handler_pk" PRIMARY KEY("message_id","handler")
);
--> statement-breakpoint
CREATE TABLE "building"."outbox_messages" (
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
CREATE TABLE "building"."building_setting" (
	"building_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_building_setting" PRIMARY KEY("building_id"),
	CONSTRAINT "ck_building_setting_data" CHECK (jsonb_typeof("building"."building_setting"."data") = 'object'),
	CONSTRAINT "ck_building_setting_version" CHECK ("building"."building_setting"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "building"."building" (
	"id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"company" jsonb NOT NULL,
	"address" text NOT NULL,
	"hotline" text,
	"working_hours" jsonb,
	"email" "citext",
	"logo_file" uuid,
	"time_zone" text DEFAULT 'Asia/Ho_Chi_Minh' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_building" PRIMARY KEY("id"),
	CONSTRAINT "uq_building_code" UNIQUE("code"),
	CONSTRAINT "ck_building_code" CHECK ("building"."building"."code" ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
	CONSTRAINT "ck_building_name" CHECK (platform.is_bilingual("building"."building"."name")),
	CONSTRAINT "ck_building_company" CHECK (jsonb_typeof("building"."building"."company") = 'object'),
	CONSTRAINT "ck_building_working_hours" CHECK ("building"."building"."working_hours" IS NULL OR platform.is_bilingual("building"."building"."working_hours")),
	CONSTRAINT "ck_building_time_zone" CHECK (btrim("building"."building"."time_zone") <> ''),
	CONSTRAINT "ck_building_version" CHECK ("building"."building"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "building"."file_object" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"module" text NOT NULL,
	"purpose" text NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"checksum" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"owner_ref" text,
	"account_kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"attached_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pk_file_object" PRIMARY KEY("id"),
	CONSTRAINT "uq_file_object_building_key" UNIQUE("building_id","object_key"),
	CONSTRAINT "ck_file_object_module" CHECK ("building"."file_object"."module" IN ('identity', 'building', 'residency', 'finance', 'tickets', 'vehicles', 'notices', 'wiki', 'reporting')),
	CONSTRAINT "ck_file_object_purpose" CHECK ("building"."file_object"."purpose" IN ('avatar', 'logo', 'import', 'statement', 'fee_notice_pdf', 'receipt_pdf', 'bulk_zip', 'ticket_media', 'vehicle_plate_photo', 'vehicle_paper', 'notice_attachment', 'notice_image', 'wiki_attachment', 'wiki_image', 'export', 'thumbnail')),
	CONSTRAINT "ck_file_object_key" CHECK ("building"."file_object"."object_key" ~ '^[a-z]+/[0-9a-f-]{36}/[a-z]+/[0-9]{4}/(0[1-9]|1[0-2])/[0-9a-f-]{36}\.[a-z0-9]{1,8}$'),
	CONSTRAINT "ck_file_object_size" CHECK ("building"."file_object"."size" >= 0),
	CONSTRAINT "ck_file_object_status" CHECK ("building"."file_object"."status" IN ('pending', 'verified', 'attached', 'deleted')),
	CONSTRAINT "ck_file_object_account" CHECK ("building"."file_object"."account_kind" IN ('staff', 'resident', 'system')),
	CONSTRAINT "ck_file_object_stamps" CHECK (("building"."file_object"."status" = 'pending' AND "building"."file_object"."verified_at" IS NULL AND "building"."file_object"."attached_at" IS NULL AND "building"."file_object"."deleted_at" IS NULL)
        OR ("building"."file_object"."status" = 'verified' AND "building"."file_object"."verified_at" IS NOT NULL AND "building"."file_object"."attached_at" IS NULL AND "building"."file_object"."deleted_at" IS NULL)
        OR ("building"."file_object"."status" = 'attached' AND "building"."file_object"."verified_at" IS NOT NULL AND "building"."file_object"."attached_at" IS NOT NULL AND "building"."file_object"."deleted_at" IS NULL)
        OR ("building"."file_object"."status" = 'deleted' AND "building"."file_object"."deleted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "building"."gateway_config" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"driver" text NOT NULL,
	"secrets_enc" text NOT NULL,
	"receiving_account" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_check_ok" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_gateway_config" PRIMARY KEY("id"),
	CONSTRAINT "ck_gateway_config_provider" CHECK ("building"."gateway_config"."provider" IN ('payos', 'vietqr')),
	CONSTRAINT "ck_gateway_config_driver" CHECK ("building"."gateway_config"."driver" IN ('payos', 'vietqr', 'fake')),
	CONSTRAINT "ck_gateway_config_status" CHECK ("building"."gateway_config"."status" IN ('active', 'disabled')),
	CONSTRAINT "ck_gateway_config_secrets" CHECK ("building"."gateway_config"."secrets_enc" ~ '^v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
	CONSTRAINT "ck_gateway_config_account" CHECK (jsonb_typeof("building"."gateway_config"."receiving_account") = 'object'),
	CONSTRAINT "ck_gateway_config_check" CHECK (("building"."gateway_config"."last_check_at" IS NULL) = ("building"."gateway_config"."last_check_ok" IS NULL)),
	CONSTRAINT "ck_gateway_config_version" CHECK ("building"."gateway_config"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "building"."job_run" (
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "pk_job_run" PRIMARY KEY("id"),
	CONSTRAINT "ck_job_run_name" CHECK ("building"."job_run"."name" ~ '^[a-z][a-z0-9_]{2,40}$'),
	CONSTRAINT "ck_job_run_status" CHECK ("building"."job_run"."status" IN ('succeeded', 'failed')),
	CONSTRAINT "ck_job_run_times" CHECK ("building"."job_run"."finished_at" >= "building"."job_run"."started_at"),
	CONSTRAINT "ck_job_run_details" CHECK (jsonb_typeof("building"."job_run"."details") = 'object')
);
--> statement-breakpoint
CREATE TABLE "building"."terms_acceptance" (
	"building_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"app_version" text,
	CONSTRAINT "pk_terms_acceptance" PRIMARY KEY("account_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "building"."terms_version" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"text" jsonb NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_terms_version" PRIMARY KEY("id"),
	CONSTRAINT "uq_terms_version_building_kind_version" UNIQUE("building_id","kind","version"),
	CONSTRAINT "ck_terms_version_kind" CHECK ("building"."terms_version"."kind" IN ('terms', 'privacy')),
	CONSTRAINT "ck_terms_version_version" CHECK ("building"."terms_version"."version" >= 1),
	CONSTRAINT "ck_terms_version_text" CHECK (platform.is_bilingual("building"."terms_version"."text"))
);
--> statement-breakpoint
ALTER TABLE "building"."building" ADD CONSTRAINT "fk_building_logo_file" FOREIGN KEY ("logo_file") REFERENCES "building"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building"."terms_acceptance" ADD CONSTRAINT "fk_terms_acceptance_version" FOREIGN KEY ("version_id") REFERENCES "building"."terms_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "building"."outbox_messages" USING btree ("next_attempt_at") WHERE "building"."outbox_messages"."published_at" is null and "building"."outbox_messages"."dead_at" is null;--> statement-breakpoint
CREATE INDEX "ix_file_object_building_unattached" ON "building"."file_object" USING btree ("building_id","created_at") WHERE "building"."file_object"."status" IN ('pending', 'verified');--> statement-breakpoint
CREATE INDEX "ix_file_object_building_owner" ON "building"."file_object" USING btree ("building_id","owner_ref") WHERE "building"."file_object"."owner_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_file_object_building_deleted" ON "building"."file_object" USING btree ("building_id","deleted_at") WHERE "building"."file_object"."status" = 'deleted';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gateway_config_building_provider_active" ON "building"."gateway_config" USING btree ("building_id","provider") WHERE "building"."gateway_config"."status" = 'active';--> statement-breakpoint
CREATE INDEX "ix_job_run_started" ON "building"."job_run" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ix_job_run_name_success" ON "building"."job_run" USING btree ("name","finished_at" DESC NULLS FIRST) WHERE "building"."job_run"."status" = 'succeeded';--> statement-breakpoint
CREATE INDEX "ix_terms_acceptance_building_version" ON "building"."terms_acceptance" USING btree ("building_id","version_id");