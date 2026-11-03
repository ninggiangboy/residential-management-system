CREATE SCHEMA "realtime";
--> statement-breakpoint
CREATE TABLE "realtime"."events" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"source_message_id" uuid NOT NULL,
	"type" text NOT NULL,
	"target_account_id" uuid,
	"target_roles" text[],
	"close_session_id" uuid,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_events" PRIMARY KEY("id"),
	CONSTRAINT "uq_events_source" UNIQUE("source_message_id"),
	CONSTRAINT "ck_events_id_v7" CHECK (uuid_extract_version("realtime"."events"."id") = 7),
	CONSTRAINT "ck_events_type" CHECK ("realtime"."events"."type" IN ('inbox.created', 'ticket.created', 'ticket.changed', 'money_log.opened', 'export.ready', 'session.revoked')),
	CONSTRAINT "ck_events_target" CHECK (("realtime"."events"."target_account_id" IS NULL) <> ("realtime"."events"."target_roles" IS NULL)),
	CONSTRAINT "ck_events_roles" CHECK ("realtime"."events"."target_roles" IS NULL OR (cardinality("realtime"."events"."target_roles") >= 1 AND "realtime"."events"."target_roles" <@ ARRAY['admin', 'manager', 'technician', 'guard'])),
	CONSTRAINT "ck_events_close" CHECK (("realtime"."events"."close_session_id" IS NOT NULL) = ("realtime"."events"."type" = 'session.revoked')),
	CONSTRAINT "ck_events_data" CHECK (jsonb_typeof("realtime"."events"."data") = 'object' AND octet_length("realtime"."events"."data"::text) <= 2048)
);
--> statement-breakpoint
CREATE INDEX "ix_events_building_created" ON "realtime"."events" USING btree ("building_id","created_at");