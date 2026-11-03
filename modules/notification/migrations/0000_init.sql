-- The schema `notification` is created by ops/postgres/0000-bootstrap.sql before any module migration (DOC-14 §2.2).
CREATE TABLE "notification"."device_token" (
	"id" uuid NOT NULL,
	"account_kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"expo_push_token" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_device_token" PRIMARY KEY("id"),
	CONSTRAINT "uq_device_token_token" UNIQUE("expo_push_token"),
	CONSTRAINT "uq_device_token_session" UNIQUE("session_id"),
	CONSTRAINT "ck_device_token_account_kind" CHECK ("notification"."device_token"."account_kind" IN ('resident', 'staff')),
	CONSTRAINT "ck_device_token_token" CHECK (char_length("notification"."device_token"."expo_push_token") <= 200 AND "notification"."device_token"."expo_push_token" ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,180}\]$'),
	CONSTRAINT "ck_device_token_platform" CHECK ("notification"."device_token"."platform" IN ('ios', 'android')),
	CONSTRAINT "ck_device_token_version" CHECK ("notification"."device_token"."app_version" ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$')
);
--> statement-breakpoint
CREATE TABLE "notification"."inbox_entry" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"account_kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"unit_id" uuid,
	"template_key" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"dedupe_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "pk_inbox_entry" PRIMARY KEY("id"),
	CONSTRAINT "uq_inbox_entry_dedupe" UNIQUE NULLS NOT DISTINCT("building_id","account_kind","account_id","source_kind","dedupe_id","template_key","unit_id"),
	CONSTRAINT "ck_inbox_entry_account_kind" CHECK ("notification"."inbox_entry"."account_kind" IN ('resident', 'staff')),
	CONSTRAINT "ck_inbox_entry_staff_unit" CHECK ("notification"."inbox_entry"."account_kind" = 'resident' OR "notification"."inbox_entry"."unit_id" IS NULL),
	CONSTRAINT "ck_inbox_entry_template_key" CHECK ("notification"."inbox_entry"."template_key" ~ '^[a-z]+\.[a-z_]+$' AND char_length("notification"."inbox_entry"."template_key") <= 40),
	CONSTRAINT "ck_inbox_entry_params" CHECK (jsonb_typeof("notification"."inbox_entry"."params") = 'object' AND octet_length("notification"."inbox_entry"."params"::text) <= 2048),
	CONSTRAINT "ck_inbox_entry_source_kind" CHECK ("notification"."inbox_entry"."source_kind" IN ('batch', 'charge', 'debt_reminder', 'payment', 'gateway_event', 'statement_line', 'ticket', 'vehicle', 'notice', 'membership', 'unit', 'export', 'step_up')),
	CONSTRAINT "ck_inbox_entry_read_at" CHECK ("notification"."inbox_entry"."read_at" IS NULL OR "notification"."inbox_entry"."read_at" >= "notification"."inbox_entry"."created_at")
);
--> statement-breakpoint
CREATE TABLE "notification"."inbox" (
	"message_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_message_id_handler_pk" PRIMARY KEY("message_id","handler")
);
--> statement-breakpoint
CREATE TABLE "notification"."outbox_messages" (
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
CREATE TABLE "notification"."push_ticket" (
	"id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"device_token_id" uuid NOT NULL,
	"account_kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"receipt_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"next_check_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_push_ticket" PRIMARY KEY("id"),
	CONSTRAINT "uq_push_ticket_message_device" UNIQUE("message_id","device_token_id"),
	CONSTRAINT "ck_push_ticket_account_kind" CHECK ("notification"."push_ticket"."account_kind" IN ('resident', 'staff')),
	CONSTRAINT "ck_push_ticket_status" CHECK ("notification"."push_ticket"."status" IN ('pending', 'ok', 'failed', 'unknown')),
	CONSTRAINT "ck_push_ticket_receipt" CHECK ("notification"."push_ticket"."receipt_id" IS NULL OR char_length("notification"."push_ticket"."receipt_id") BETWEEN 1 AND 100),
	CONSTRAINT "ck_push_ticket_shape" CHECK (("notification"."push_ticket"."status" = 'pending' AND "notification"."push_ticket"."receipt_id" IS NOT NULL AND "notification"."push_ticket"."next_check_at" IS NOT NULL AND "notification"."push_ticket"."error" IS NULL AND "notification"."push_ticket"."checked_at" IS NULL) OR ("notification"."push_ticket"."status" = 'ok' AND "notification"."push_ticket"."receipt_id" IS NOT NULL AND "notification"."push_ticket"."error" IS NULL AND "notification"."push_ticket"."checked_at" IS NOT NULL) OR ("notification"."push_ticket"."status" = 'unknown' AND "notification"."push_ticket"."receipt_id" IS NOT NULL AND "notification"."push_ticket"."error" IS NULL AND "notification"."push_ticket"."checked_at" IS NOT NULL) OR ("notification"."push_ticket"."status" = 'failed' AND "notification"."push_ticket"."error" IS NOT NULL AND ("notification"."push_ticket"."receipt_id" IS NULL OR "notification"."push_ticket"."checked_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE INDEX "ix_device_token_account" ON "notification"."device_token" USING btree ("account_kind","account_id");--> statement-breakpoint
CREATE INDEX "ix_inbox_entry_building_account" ON "notification"."inbox_entry" USING btree ("building_id","account_kind","account_id","id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_inbox_entry_building_account_unread" ON "notification"."inbox_entry" USING btree ("building_id","account_kind","account_id") WHERE "notification"."inbox_entry"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ix_inbox_entry_building_created" ON "notification"."inbox_entry" USING btree ("building_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "notification"."outbox_messages" USING btree ("next_attempt_at") WHERE "notification"."outbox_messages"."published_at" is null and "notification"."outbox_messages"."dead_at" is null;--> statement-breakpoint
CREATE INDEX "ix_push_ticket_pending" ON "notification"."push_ticket" USING btree ("next_check_at") WHERE "notification"."push_ticket"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "ix_push_ticket_created" ON "notification"."push_ticket" USING btree ("created_at");