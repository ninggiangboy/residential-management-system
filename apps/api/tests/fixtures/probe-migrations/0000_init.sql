CREATE TABLE "finance"."probe_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ix_probe_item_note" ON "finance"."probe_item" ("note");
