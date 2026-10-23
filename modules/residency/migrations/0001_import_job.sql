CREATE TABLE "residency"."import_job" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "pk_import_job" PRIMARY KEY("id"),
	CONSTRAINT "ck_import_job_kind" CHECK ("residency"."import_job"."kind" IN ('unit_owner')),
	CONSTRAINT "ck_import_job_status" CHECK ("residency"."import_job"."status" IN ('validated', 'failed', 'committed', 'expired')),
	CONSTRAINT "import_job_committed_at_iff_committed" CHECK (("residency"."import_job"."status" = 'committed') = ("residency"."import_job"."committed_at" IS NOT NULL)),
	CONSTRAINT "ck_import_job_expires_after_create" CHECK ("residency"."import_job"."expires_at" > "residency"."import_job"."created_at")
);
--> statement-breakpoint
CREATE INDEX "import_job_building_idx" ON "residency"."import_job" USING btree ("building_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "import_job_purge_idx" ON "residency"."import_job" USING btree ("created_at");