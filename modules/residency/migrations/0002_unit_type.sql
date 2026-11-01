CREATE TABLE "residency"."unit_type" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"default_bedrooms" smallint,
	"default_area_m2" numeric(8, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pk_unit_type" PRIMARY KEY("id"),
	CONSTRAINT "unit_type_code_format" CHECK ("residency"."unit_type"."code" ~ '^[a-z][a-z0-9_]{1,29}$'),
	CONSTRAINT "unit_type_name_bilingual" CHECK (platform.is_bilingual("residency"."unit_type"."name")),
	CONSTRAINT "unit_type_default_bedrooms_range" CHECK ("residency"."unit_type"."default_bedrooms" BETWEEN 0 AND 20),
	CONSTRAINT "unit_type_default_area_range" CHECK ("residency"."unit_type"."default_area_m2" > 0 AND "residency"."unit_type"."default_area_m2" <= 2000),
	CONSTRAINT "unit_type_status_check" CHECK ("residency"."unit_type"."status" IN ('active', 'archived')),
	CONSTRAINT "unit_type_archived_check" CHECK (("residency"."unit_type"."status" = 'archived') = ("residency"."unit_type"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "residency"."unit" ADD COLUMN "unit_type_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "unit_type_code_key" ON "residency"."unit_type" USING btree ("building_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_type_name_key" ON "residency"."unit_type" USING btree ("building_id",lower("name" ->> 'vi'));--> statement-breakpoint
CREATE UNIQUE INDEX "unit_type_building_id_key" ON "residency"."unit_type" USING btree ("building_id","id");--> statement-breakpoint
ALTER TABLE "residency"."unit" ADD CONSTRAINT "unit_unit_type_fk" FOREIGN KEY ("building_id","unit_type_id") REFERENCES "residency"."unit_type"("building_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_type_idx" ON "residency"."unit" USING btree ("building_id","unit_type_id");