-- The schema `analytics` is created by ops/postgres/0000-bootstrap.sql before any module migration (DOC-14 §2.2).
CREATE TABLE "analytics"."usage_daily" (
	"building_id" uuid NOT NULL,
	"day" date NOT NULL,
	"app" text NOT NULL,
	"platform" text NOT NULL,
	"audience" text NOT NULL,
	"event" text NOT NULL,
	"name" text NOT NULL,
	"events" integer NOT NULL,
	"sessions" integer NOT NULL,
	"seconds" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "pk_usage_daily" PRIMARY KEY("building_id","day","app","platform","audience","event","name"),
	CONSTRAINT "ck_usage_daily_app" CHECK ("analytics"."usage_daily"."app" IN ('resident', 'staff', 'web')),
	CONSTRAINT "ck_usage_daily_platform" CHECK ("analytics"."usage_daily"."platform" IN ('ios', 'android', 'web')),
	CONSTRAINT "ck_usage_daily_audience" CHECK ("analytics"."usage_daily"."audience" IN ('resident', 'staff')),
	CONSTRAINT "ck_usage_daily_event" CHECK ("analytics"."usage_daily"."event" IN ('screen_view', 'tap', 'app_open', 'app_close')),
	CONSTRAINT "ck_usage_daily_counts" CHECK ("analytics"."usage_daily"."events" >= 1 AND "analytics"."usage_daily"."sessions" BETWEEN 1 AND "analytics"."usage_daily"."events"),
	CONSTRAINT "ck_usage_daily_seconds" CHECK ("analytics"."usage_daily"."event" = 'app_close' OR "analytics"."usage_daily"."seconds" = 0)
);
--> statement-breakpoint
CREATE TABLE "analytics"."usage_event" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"app" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text NOT NULL,
	"audience" text NOT NULL,
	"session_id" uuid NOT NULL,
	"event" text NOT NULL,
	"name" text NOT NULL,
	"duration_s" integer,
	CONSTRAINT "pk_usage_event" PRIMARY KEY("id"),
	CONSTRAINT "ck_usage_event_app" CHECK ("analytics"."usage_event"."app" IN ('resident', 'staff', 'web')),
	CONSTRAINT "ck_usage_event_platform" CHECK ("analytics"."usage_event"."platform" IN ('ios', 'android', 'web')),
	CONSTRAINT "ck_usage_event_version" CHECK ("analytics"."usage_event"."app_version" ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
	CONSTRAINT "ck_usage_event_audience" CHECK ("analytics"."usage_event"."audience" IN ('resident', 'staff')),
	CONSTRAINT "ck_usage_event_event" CHECK ("analytics"."usage_event"."event" IN ('screen_view', 'tap', 'app_open', 'app_close')),
	CONSTRAINT "ck_usage_event_name" CHECK (char_length("analytics"."usage_event"."name") <= 60 AND "analytics"."usage_event"."name" ~ '^[A-Z][A-Za-z0-9-]*(\.[a-z][a-z0-9_]*)?$'),
	CONSTRAINT "ck_usage_event_name_form" CHECK (("analytics"."usage_event"."event" = 'tap') = (position('.' IN "analytics"."usage_event"."name") > 0)),
	CONSTRAINT "ck_usage_event_lifecycle" CHECK (("analytics"."usage_event"."event" = 'app_open' AND "analytics"."usage_event"."name" IN ('Launch', 'Resume')) OR ("analytics"."usage_event"."event" = 'app_close' AND "analytics"."usage_event"."name" = 'Background') OR "analytics"."usage_event"."event" IN ('screen_view', 'tap')),
	CONSTRAINT "ck_usage_event_duration" CHECK (("analytics"."usage_event"."event" = 'app_close') = ("analytics"."usage_event"."duration_s" IS NOT NULL) AND ("analytics"."usage_event"."duration_s" IS NULL OR "analytics"."usage_event"."duration_s" BETWEEN 0 AND 86400))
);
--> statement-breakpoint
CREATE INDEX "ix_usage_event_building_at" ON "analytics"."usage_event" USING btree ("building_id","occurred_at");