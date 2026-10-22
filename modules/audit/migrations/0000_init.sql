-- The schema `audit` is created by ops/postgres/0000-bootstrap.sql before any module migration (DOC-14 §2.2).
CREATE TABLE "audit"."audit_log" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"ip" "inet",
	"user_agent" text,
	"request_id" text,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_class" text GENERATED ALWAYS AS (CASE WHEN action LIKE 'finance.%' THEN 'finance' ELSE 'standard' END) STORED,
	CONSTRAINT "pk_audit_log" PRIMARY KEY("id"),
	CONSTRAINT "ck_audit_log_actor_kind" CHECK ("audit"."audit_log"."actor_kind" IN ('staff', 'system')),
	CONSTRAINT "ck_audit_log_actor" CHECK (("audit"."audit_log"."actor_kind" = 'system') = ("audit"."audit_log"."actor_id" IS NULL)),
	CONSTRAINT "ck_audit_log_role" CHECK (("audit"."audit_log"."actor_kind" = 'staff') = ("audit"."audit_log"."actor_role" IS NOT NULL)),
	CONSTRAINT "ck_audit_log_action" CHECK ("audit"."audit_log"."action" ~ '^[a-z_]+(\.[a-z_]+)+$'),
	CONSTRAINT "ck_audit_log_changes" CHECK (jsonb_typeof("audit"."audit_log"."changes") = 'array'),
	CONSTRAINT "ck_audit_log_details" CHECK (jsonb_typeof("audit"."audit_log"."details") = 'object')
);
--> statement-breakpoint
CREATE INDEX "ix_audit_log_building_at" ON "audit"."audit_log" USING btree ("building_id","at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_audit_log_building_object" ON "audit"."audit_log" USING btree ("building_id","object_type","object_id","at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_audit_log_building_actor" ON "audit"."audit_log" USING btree ("building_id","actor_id","at" DESC NULLS FIRST) WHERE "audit"."audit_log"."actor_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_audit_log_purge" ON "audit"."audit_log" USING btree ("retention_class","at");