-- The schema `finance` is created by ops/postgres/0000-bootstrap.sql before any module migration (DOC-14 §2.2).
CREATE SEQUENCE "finance"."order_code_seq" INCREMENT BY 1 MINVALUE 1000000 MAXVALUE 34359738367 START WITH 1000000 CACHE 1;--> statement-breakpoint
CREATE TABLE "finance"."allocation" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_allocation" PRIMARY KEY("id"),
	CONSTRAINT "uq_allocation_payment_charge" UNIQUE("building_id","payment_id","charge_id"),
	CONSTRAINT "ck_allocation_amount" CHECK (amount > 0),
	CONSTRAINT "ck_allocation_status" CHECK (status = ANY (ARRAY['live'::text, 'void'::text])),
	CONSTRAINT "ck_allocation_void" CHECK ((status = 'void'::text) = (voided_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "finance"."charge" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"unit_code" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"void_kind" text,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_charge" PRIMARY KEY("id"),
	CONSTRAINT "uq_charge_batch_unit" UNIQUE("building_id","batch_id","unit_id"),
	CONSTRAINT "ck_charge_amount" CHECK (amount > 0),
	CONSTRAINT "ck_charge_status" CHECK (status = ANY (ARRAY['draft'::text, 'open'::text, 'paid'::text, 'void'::text])),
	CONSTRAINT "ck_charge_version" CHECK (version >= 1),
	CONSTRAINT "ck_charge_void" CHECK (((status = 'void'::text) = (void_kind IS NOT NULL)) AND ((status = 'void'::text) = (voided_at IS NOT NULL)) AND ((status = 'void'::text) = (voided_by IS NOT NULL))),
	CONSTRAINT "ck_charge_void_kind" CHECK (void_kind = ANY (ARRAY['recall'::text, 'single'::text])),
	CONSTRAINT "ck_charge_void_reason" CHECK (((NOT (void_kind IS DISTINCT FROM 'single'::text)) = (void_reason IS NOT NULL)) AND ((void_reason IS NULL) OR ((char_length(btrim(void_reason)) >= 5) AND (char_length(btrim(void_reason)) <= 500))))
);
--> statement-breakpoint
CREATE TABLE "finance"."charge_line" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"kind" text DEFAULT 'fee' NOT NULL,
	"item_name" jsonb NOT NULL,
	"quantity" numeric(12, 3) DEFAULT 1 NOT NULL,
	"unit_price" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_charge_line" PRIMARY KEY("id"),
	CONSTRAINT "uq_charge_line_charge_position" UNIQUE("charge_id","position"),
	CONSTRAINT "ck_charge_line_amount" CHECK ((kind = 'adjustment'::text) OR (amount = (((((quantity * (1000)::numeric))::bigint * unit_price) + 500) / 1000))),
	CONSTRAINT "ck_charge_line_item_name" CHECK (platform.is_bilingual(item_name)),
	CONSTRAINT "ck_charge_line_kind" CHECK (kind = ANY (ARRAY['fee'::text, 'adjustment'::text])),
	CONSTRAINT "ck_charge_line_note" CHECK (((kind = 'fee'::text) OR ((note IS NOT NULL) AND (btrim(note) <> ''::text))) AND ((note IS NULL) OR (char_length(note) <= 500))),
	CONSTRAINT "ck_charge_line_position" CHECK ("position" >= 1),
	CONSTRAINT "ck_charge_line_quantity" CHECK (quantity >= (0)::numeric),
	CONSTRAINT "ck_charge_line_sign" CHECK (((kind = 'fee'::text) AND (amount > 0)) OR ((kind = 'adjustment'::text) AND (amount <> 0))),
	CONSTRAINT "ck_charge_line_unit_price" CHECK (unit_price >= 0)
);
--> statement-breakpoint
CREATE TABLE "finance"."debt_reminder" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"reminder_day" date NOT NULL,
	"sent_by" uuid NOT NULL,
	"charge_count" integer NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_debt_reminder" PRIMARY KEY("id"),
	CONSTRAINT "uq_debt_reminder_unit_day" UNIQUE("building_id","unit_id","reminder_day"),
	CONSTRAINT "ck_debt_reminder_amounts" CHECK ((charge_count >= 1) AND (amount > 0))
);
--> statement-breakpoint
CREATE TABLE "finance"."document_counter" (
	"building_id" uuid NOT NULL,
	"series" text NOT NULL,
	"period" text NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_document_counter" PRIMARY KEY("building_id","series","period"),
	CONSTRAINT "ck_document_counter_last" CHECK (last >= 0),
	CONSTRAINT "ck_document_counter_period" CHECK (period ~ '^[0-9]{4}([0-9]{2})?$'::text),
	CONSTRAINT "ck_document_counter_series" CHECK (series = ANY (ARRAY['receipt'::text, 'batch'::text, 'intent'::text]))
);
--> statement-breakpoint
CREATE TABLE "finance"."fake_gateway_link" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"gateway_config_id" uuid NOT NULL,
	"order_code" bigint NOT NULL,
	"link_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_reference" text,
	"paid_amount" bigint,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_fake_gateway_link" PRIMARY KEY("id"),
	CONSTRAINT "uq_fake_gateway_link_config_order" UNIQUE("building_id","gateway_config_id","order_code"),
	CONSTRAINT "uq_fake_gateway_link_link_id" UNIQUE("building_id","link_id"),
	CONSTRAINT "ck_fake_gateway_link_amount" CHECK ((amount > 0) AND ((paid_amount IS NULL) OR (paid_amount > 0))),
	CONSTRAINT "ck_fake_gateway_link_paid" CHECK ((status = 'paid'::text) <= ((paid_reference IS NOT NULL) AND (paid_at IS NOT NULL))),
	CONSTRAINT "ck_fake_gateway_link_status" CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text, 'expired'::text]))
);
--> statement-breakpoint
CREATE TABLE "finance"."fee_batch" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" jsonb NOT NULL,
	"fee_month" date NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"replaces_batch_id" uuid,
	"created_by" uuid NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"recalled_at" timestamp with time zone,
	"recalled_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_fee_batch" PRIMARY KEY("id"),
	CONSTRAINT "uq_fee_batch_building_code" UNIQUE("building_id","code"),
	CONSTRAINT "ck_fee_batch_closed" CHECK (((status = 'closed'::text) = (closed_at IS NOT NULL)) AND ((closed_at IS NULL) = (closed_by IS NULL))),
	CONSTRAINT "ck_fee_batch_code" CHECK (code ~ '^PH-[0-9]{4}-[0-9]{2,}$'::text),
	CONSTRAINT "ck_fee_batch_fee_month" CHECK (fee_month = (date_trunc('month'::text, (fee_month)::timestamp with time zone))::date),
	CONSTRAINT "ck_fee_batch_name" CHECK (platform.is_bilingual(name)),
	CONSTRAINT "ck_fee_batch_not_self" CHECK (replaces_batch_id IS DISTINCT FROM id),
	CONSTRAINT "ck_fee_batch_published" CHECK (((status = 'draft'::text) = (published_at IS NULL)) AND ((published_at IS NULL) = (published_by IS NULL))),
	CONSTRAINT "ck_fee_batch_recalled" CHECK (((status = 'recalled'::text) = (recalled_at IS NOT NULL)) AND ((recalled_at IS NULL) = (recalled_by IS NULL))),
	CONSTRAINT "ck_fee_batch_status" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'recalled'::text, 'closed'::text])),
	CONSTRAINT "ck_fee_batch_version" CHECK (version >= 1)
);
--> statement-breakpoint
CREATE TABLE "finance"."fee_notice_job" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"language" text NOT NULL,
	"unit_total" integer NOT NULL,
	"unit_done" integer DEFAULT 0 NOT NULL,
	"cursor_charge" uuid,
	"zip_file" uuid,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"error" jsonb,
	"requested_by" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_fee_notice_job" PRIMARY KEY("id"),
	CONSTRAINT "ck_fee_notice_job_failed" CHECK ((status = 'failed'::text) = (error IS NOT NULL)),
	CONSTRAINT "ck_fee_notice_job_finished" CHECK ((status = ANY (ARRAY['ready'::text, 'failed'::text])) = (finished_at IS NOT NULL)),
	CONSTRAINT "ck_fee_notice_job_language" CHECK (language = ANY (ARRAY['vi'::text, 'en'::text, 'both'::text])),
	CONSTRAINT "ck_fee_notice_job_progress" CHECK ((unit_total >= 0) AND ((unit_done >= 0) AND (unit_done <= unit_total))),
	CONSTRAINT "ck_fee_notice_job_ready" CHECK ((status = 'ready'::text) = (zip_file IS NOT NULL)),
	CONSTRAINT "ck_fee_notice_job_status" CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "finance"."inbox" (
	"message_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_message_id_handler_pk" PRIMARY KEY("message_id","handler")
);
--> statement-breakpoint
CREATE TABLE "finance"."outbox_messages" (
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
CREATE TABLE "finance"."gateway_event" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"order_code" bigint,
	"amount" bigint NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb NOT NULL,
	"intent_id" uuid,
	"unit_id" uuid,
	"outcome" text NOT NULL,
	"payment_id" uuid,
	"related_payment_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_gateway_event" PRIMARY KEY("id"),
	CONSTRAINT "uq_gateway_event_provider_reference" UNIQUE("provider","reference"),
	CONSTRAINT "ck_gateway_event_amount" CHECK (amount > 0),
	CONSTRAINT "ck_gateway_event_intent" CHECK ((outcome = ANY (ARRAY['pending'::text, 'unknown_order'::text])) OR (intent_id IS NOT NULL)),
	CONSTRAINT "ck_gateway_event_outcome" CHECK (outcome = ANY (ARRAY['pending'::text, 'posted'::text, 'amount_short'::text, 'amount_over'::text, 'duplicate_transfer'::text, 'charge_already_paid'::text, 'charge_recalled'::text, 'unknown_order'::text, 'refunded'::text, 'disputed'::text])),
	CONSTRAINT "ck_gateway_event_payload" CHECK (jsonb_typeof(payload) = 'object'::text),
	CONSTRAINT "ck_gateway_event_posted" CHECK ((outcome = 'posted'::text) = (payment_id IS NOT NULL)),
	CONSTRAINT "ck_gateway_event_provider" CHECK (provider ~ '^[a-z][a-z0-9]{2,15}$'::text),
	CONSTRAINT "ck_gateway_event_related" CHECK ((related_payment_id IS NULL) OR (outcome = ANY (ARRAY['refunded'::text, 'disputed'::text]))),
	CONSTRAINT "ck_gateway_event_review" CHECK (((reviewed_at IS NULL) = (reviewed_by IS NULL)) AND ((reviewed_at IS NULL) = (review_note IS NULL))),
	CONSTRAINT "ck_gateway_event_review_note" CHECK ((review_note IS NULL) OR ((char_length(btrim(review_note)) >= 5) AND (char_length(btrim(review_note)) <= 1000))),
	CONSTRAINT "ck_gateway_event_reviewable" CHECK ((reviewed_at IS NULL) OR (outcome <> ALL (ARRAY['pending'::text, 'posted'::text]))),
	CONSTRAINT "ck_gateway_event_source" CHECK (source = ANY (ARRAY['webhook'::text, 'requery'::text, 'statement'::text]))
);
--> statement-breakpoint
CREATE TABLE "finance"."import_job" (
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
	CONSTRAINT "ck_import_job_committed" CHECK ((status = 'committed'::text) = (committed_at IS NOT NULL)),
	CONSTRAINT "ck_import_job_expiry" CHECK (expires_at > created_at),
	CONSTRAINT "ck_import_job_kind" CHECK (kind = 'fee_batch'::text),
	CONSTRAINT "ck_import_job_params" CHECK ((jsonb_typeof(params) = 'object'::text) AND (COALESCE(jsonb_typeof((params -> 'batchId'::text)), ''::text) = 'string'::text)),
	CONSTRAINT "ck_import_job_result" CHECK (jsonb_typeof(result) = 'object'::text),
	CONSTRAINT "ck_import_job_status" CHECK (status = ANY (ARRAY['validated'::text, 'failed'::text, 'committed'::text, 'expired'::text]))
);
--> statement-breakpoint
CREATE TABLE "finance"."payment" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"source" text NOT NULL,
	"amount" bigint NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"payer_name" text,
	"provider" text,
	"gateway_reference" text,
	"intent_id" uuid,
	"bank_reference" text,
	"statement_line_id" uuid,
	"reconciled_at" timestamp with time zone,
	"client_key" text,
	"recorded_by" uuid,
	"note" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_payment" PRIMARY KEY("id"),
	CONSTRAINT "uq_payment_building_client_key" UNIQUE("building_id","client_key"),
	CONSTRAINT "uq_payment_building_intent" UNIQUE("building_id","intent_id"),
	CONSTRAINT "uq_payment_gateway_reference" UNIQUE("provider","gateway_reference"),
	CONSTRAINT "ck_payment_amount" CHECK (amount > 0),
	CONSTRAINT "ck_payment_online" CHECK (((source = 'online'::text) AND (provider IS NOT NULL) AND (gateway_reference IS NOT NULL) AND (intent_id IS NOT NULL) AND (client_key IS NULL) AND (recorded_by IS NULL) AND (statement_line_id IS NULL)) OR ((source = ANY (ARRAY['cash'::text, 'bank_transfer'::text])) AND (provider IS NULL) AND (gateway_reference IS NULL) AND (intent_id IS NULL) AND (client_key IS NOT NULL) AND (recorded_by IS NOT NULL) AND (payer_name IS NOT NULL) AND (btrim(payer_name) <> ''::text))),
	CONSTRAINT "ck_payment_source" CHECK (source = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'online'::text])),
	CONSTRAINT "ck_payment_statement_line" CHECK ((statement_line_id IS NULL) OR (source = 'bank_transfer'::text)),
	CONSTRAINT "ck_payment_status" CHECK (status = ANY (ARRAY['posted'::text, 'void'::text])),
	CONSTRAINT "ck_payment_void" CHECK (((status = 'void'::text) = (voided_at IS NOT NULL)) AND ((voided_at IS NULL) = (voided_by IS NULL)) AND ((voided_at IS NULL) = (void_reason IS NULL))),
	CONSTRAINT "ck_payment_void_reason" CHECK ((void_reason IS NULL) OR ((char_length(btrim(void_reason)) >= 5) AND (char_length(btrim(void_reason)) <= 500))),
	CONSTRAINT "ck_payment_void_source" CHECK ((status = 'posted'::text) OR (source <> 'online'::text))
);
--> statement-breakpoint
CREATE TABLE "finance"."payment_customer" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_payment_customer" PRIMARY KEY("id"),
	CONSTRAINT "uq_payment_customer_account_provider" UNIQUE("building_id","account_id","provider"),
	CONSTRAINT "ck_payment_customer_provider" CHECK (provider ~ '^[a-z][a-z0-9]{2,15}$'::text)
);
--> statement-breakpoint
CREATE TABLE "finance"."payment_intent" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"code" text NOT NULL,
	"order_code" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"gateway_config_id" uuid NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"link_id" text,
	"qr_payload" text,
	"checkout_url" text,
	"receiving" jsonb,
	"created_by" uuid NOT NULL,
	"display_until" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"next_check_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"check_count" integer DEFAULT 0 NOT NULL,
	"check_failures" smallint DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"gateway_reference" text,
	"cancel_reason" text,
	"cancel_requested_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_payment_intent" PRIMARY KEY("id"),
	CONSTRAINT "uq_payment_intent_building_code" UNIQUE("building_id","code"),
	CONSTRAINT "uq_payment_intent_order_code" UNIQUE("order_code"),
	CONSTRAINT "ck_payment_intent_amount" CHECK (amount > 0),
	CONSTRAINT "ck_payment_intent_cancel_reason" CHECK (cancel_reason = ANY (ARRAY['resident'::text, 'staff'::text, 'superseded'::text, 'batch_recalled'::text, 'charge_voided'::text, 'charge_paid'::text])),
	CONSTRAINT "ck_payment_intent_cancelled" CHECK ((status = 'cancelled'::text) <= (cancelled_at IS NOT NULL)),
	CONSTRAINT "ck_payment_intent_cancelling" CHECK ((status <> ALL (ARRAY['cancelling'::text, 'cancelled'::text])) OR ((cancel_reason IS NOT NULL) AND (cancel_requested_at IS NOT NULL))),
	CONSTRAINT "ck_payment_intent_checks" CHECK ((check_count >= 0) AND (check_failures >= 0)),
	CONSTRAINT "ck_payment_intent_code" CHECK (code ~ '^TT-[0-9]{6}-[0-9]{4,}$'::text),
	CONSTRAINT "ck_payment_intent_expired" CHECK ((status = 'expired'::text) <= (expired_at IS NOT NULL)),
	CONSTRAINT "ck_payment_intent_failed" CHECK ((status = 'failed'::text) <= (failed_at IS NOT NULL)),
	CONSTRAINT "ck_payment_intent_link" CHECK ((status <> ALL (ARRAY['pending'::text, 'expired'::text])) OR (link_id IS NOT NULL)),
	CONSTRAINT "ck_payment_intent_order_code" CHECK ((order_code >= 1000000) AND (order_code <= '34359738367'::bigint)),
	CONSTRAINT "ck_payment_intent_paid" CHECK (((status = 'paid'::text) = (paid_at IS NOT NULL)) AND ((paid_at IS NULL) = (gateway_reference IS NULL))),
	CONSTRAINT "ck_payment_intent_provider" CHECK (provider ~ '^[a-z][a-z0-9]{2,15}$'::text),
	CONSTRAINT "ck_payment_intent_receiving" CHECK ((receiving IS NULL) OR (jsonb_typeof(receiving) = 'object'::text)),
	CONSTRAINT "ck_payment_intent_status" CHECK (status = ANY (ARRAY['creating'::text, 'pending'::text, 'cancelling'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'cancelled'::text])),
	CONSTRAINT "ck_payment_intent_version" CHECK (version >= 1),
	CONSTRAINT "ck_payment_intent_window" CHECK ((display_until > created_at) AND (expires_at >= display_until))
);
--> statement-breakpoint
CREATE TABLE "finance"."payment_intent_item" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_payment_intent_item" PRIMARY KEY("id"),
	CONSTRAINT "uq_payment_intent_item_intent_charge" UNIQUE("building_id","intent_id","charge_id"),
	CONSTRAINT "ck_payment_intent_item_amount" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "finance"."receipt" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"number" text NOT NULL,
	"allocation_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"snapshot" jsonb NOT NULL,
	"pdf_file" uuid,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"external_invoice" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_receipt" PRIMARY KEY("id"),
	CONSTRAINT "uq_receipt_building_allocation" UNIQUE("building_id","allocation_id"),
	CONSTRAINT "uq_receipt_building_number" UNIQUE("building_id","number"),
	CONSTRAINT "ck_receipt_amount" CHECK (amount > 0),
	CONSTRAINT "ck_receipt_external_invoice" CHECK ((external_invoice IS NULL) OR (jsonb_typeof(external_invoice) = 'object'::text)),
	CONSTRAINT "ck_receipt_number" CHECK (number ~ '^BL-[0-9]{4}-[0-9]{4,}$'::text),
	CONSTRAINT "ck_receipt_snapshot" CHECK (jsonb_typeof(snapshot) = 'object'::text),
	CONSTRAINT "ck_receipt_status" CHECK (status = ANY (ARRAY['issued'::text, 'void'::text])),
	CONSTRAINT "ck_receipt_void" CHECK ((status = 'void'::text) = (voided_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "finance"."statement_import" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"profile_key" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text,
	"status" text NOT NULL,
	"period_from" date,
	"period_to" date,
	"line_count" integer DEFAULT 0 NOT NULL,
	"credit_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"error" jsonb,
	"created_by" uuid NOT NULL,
	"file_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_statement_import" PRIMARY KEY("id"),
	CONSTRAINT "ck_statement_import_counts" CHECK ((line_count >= (credit_count + duplicate_count)) AND (credit_count >= 0) AND (duplicate_count >= 0) AND ((matched_count >= 0) AND (matched_count <= credit_count))),
	CONSTRAINT "ck_statement_import_failed" CHECK ((status = 'failed'::text) = (error IS NOT NULL)),
	CONSTRAINT "ck_statement_import_period" CHECK (((period_from IS NULL) = (period_to IS NULL)) AND (period_from <= period_to)),
	CONSTRAINT "ck_statement_import_processed" CHECK ((status = 'failed'::text) OR (period_from IS NOT NULL)),
	CONSTRAINT "ck_statement_import_status" CHECK (status = ANY (ARRAY['processed'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "finance"."statement_line" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"booked_on" date NOT NULL,
	"amount" bigint NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"bank_reference" text,
	"dedup_key" text NOT NULL,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"payment_id" uuid,
	"candidate_payment_id" uuid,
	"intent_id" uuid,
	"note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_statement_line" PRIMARY KEY("id"),
	CONSTRAINT "uq_statement_line_building_dedup" UNIQUE("building_id","dedup_key"),
	CONSTRAINT "uq_statement_line_import_line_no" UNIQUE("import_id","line_no"),
	CONSTRAINT "ck_statement_line_amount" CHECK (amount > 0),
	CONSTRAINT "ck_statement_line_dedup" CHECK (dedup_key ~ '^[0-9a-f]{64}$'::text),
	CONSTRAINT "ck_statement_line_matched" CHECK ((match_status = 'matched'::text) = (payment_id IS NOT NULL)),
	CONSTRAINT "ck_statement_line_proposed" CHECK ((match_status = 'proposed'::text) <= (candidate_payment_id IS NOT NULL)),
	CONSTRAINT "ck_statement_line_review" CHECK (((reviewed_at IS NULL) = (reviewed_by IS NULL)) AND ((reviewed_at IS NULL) = (review_note IS NULL))),
	CONSTRAINT "ck_statement_line_review_note" CHECK ((review_note IS NULL) OR ((char_length(btrim(review_note)) >= 5) AND (char_length(btrim(review_note)) <= 1000))),
	CONSTRAINT "ck_statement_line_reviewable" CHECK ((reviewed_at IS NULL) OR (match_status = ANY (ARRAY['unmatched'::text, 'statement_only'::text]))),
	CONSTRAINT "ck_statement_line_status" CHECK (match_status = ANY (ARRAY['unmatched'::text, 'proposed'::text, 'matched'::text, 'statement_only'::text]))
);
--> statement-breakpoint
CREATE TABLE "finance"."webhook_rejection" (
	"id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"gateway_config_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"reason" text NOT NULL,
	"body_sha256" text NOT NULL,
	"body_excerpt" text,
	CONSTRAINT "pk_webhook_rejection" PRIMARY KEY("id"),
	CONSTRAINT "ck_webhook_rejection_excerpt" CHECK ((body_excerpt IS NULL) OR (octet_length(body_excerpt) <= 2048)),
	CONSTRAINT "ck_webhook_rejection_reason" CHECK (reason = ANY (ARRAY['bad_signature'::text, 'bad_account'::text, 'malformed'::text, 'unknown_config'::text, 'foreign_building'::text])),
	CONSTRAINT "ck_webhook_rejection_sha256" CHECK (body_sha256 ~ '^[0-9a-f]{64}$'::text)
);
--> statement-breakpoint
ALTER TABLE "finance"."allocation" ADD CONSTRAINT "fk_allocation_charge" FOREIGN KEY ("charge_id") REFERENCES "finance"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."allocation" ADD CONSTRAINT "fk_allocation_payment" FOREIGN KEY ("payment_id") REFERENCES "finance"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."charge" ADD CONSTRAINT "fk_charge_batch" FOREIGN KEY ("batch_id") REFERENCES "finance"."fee_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."charge_line" ADD CONSTRAINT "fk_charge_line_charge" FOREIGN KEY ("charge_id") REFERENCES "finance"."charge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."fee_batch" ADD CONSTRAINT "fk_fee_batch_replaces" FOREIGN KEY ("replaces_batch_id") REFERENCES "finance"."fee_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."fee_notice_job" ADD CONSTRAINT "fk_fee_notice_job_batch" FOREIGN KEY ("batch_id") REFERENCES "finance"."fee_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."gateway_event" ADD CONSTRAINT "fk_gateway_event_intent" FOREIGN KEY ("intent_id") REFERENCES "finance"."payment_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."gateway_event" ADD CONSTRAINT "fk_gateway_event_payment" FOREIGN KEY ("payment_id") REFERENCES "finance"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."gateway_event" ADD CONSTRAINT "fk_gateway_event_related_payment" FOREIGN KEY ("related_payment_id") REFERENCES "finance"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payment" ADD CONSTRAINT "fk_payment_intent" FOREIGN KEY ("intent_id") REFERENCES "finance"."payment_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payment" ADD CONSTRAINT "fk_payment_statement_line" FOREIGN KEY ("statement_line_id") REFERENCES "finance"."statement_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payment_intent_item" ADD CONSTRAINT "fk_payment_intent_item_charge" FOREIGN KEY ("charge_id") REFERENCES "finance"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."payment_intent_item" ADD CONSTRAINT "fk_payment_intent_item_intent" FOREIGN KEY ("intent_id") REFERENCES "finance"."payment_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."receipt" ADD CONSTRAINT "fk_receipt_allocation" FOREIGN KEY ("allocation_id") REFERENCES "finance"."allocation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."receipt" ADD CONSTRAINT "fk_receipt_charge" FOREIGN KEY ("charge_id") REFERENCES "finance"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."receipt" ADD CONSTRAINT "fk_receipt_payment" FOREIGN KEY ("payment_id") REFERENCES "finance"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."statement_line" ADD CONSTRAINT "fk_statement_line_candidate" FOREIGN KEY ("candidate_payment_id") REFERENCES "finance"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."statement_line" ADD CONSTRAINT "fk_statement_line_import" FOREIGN KEY ("import_id") REFERENCES "finance"."statement_import"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."statement_line" ADD CONSTRAINT "fk_statement_line_intent" FOREIGN KEY ("intent_id") REFERENCES "finance"."payment_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance"."statement_line" ADD CONSTRAINT "fk_statement_line_payment" FOREIGN KEY ("payment_id") REFERENCES "finance"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_allocation_building_charge" ON "finance"."allocation" USING btree ("building_id","charge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_allocation_charge_live" ON "finance"."allocation" USING btree ("building_id","charge_id") WHERE (status = 'live'::text);--> statement-breakpoint
CREATE INDEX "ix_charge_building_batch" ON "finance"."charge" USING btree ("building_id","batch_id","status");--> statement-breakpoint
CREATE INDEX "ix_charge_building_unit" ON "finance"."charge" USING btree ("building_id","unit_id","batch_id");--> statement-breakpoint
CREATE INDEX "ix_charge_building_unit_open" ON "finance"."charge" USING btree ("building_id","unit_id") WHERE (status = 'open'::text);--> statement-breakpoint
CREATE INDEX "ix_charge_line_building_charge" ON "finance"."charge_line" USING btree ("building_id","charge_id");--> statement-breakpoint
CREATE INDEX "ix_debt_reminder_created" ON "finance"."debt_reminder" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_fee_batch_building_fee_month" ON "finance"."fee_batch" USING btree ("building_id","fee_month" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_fee_batch_building_replaces" ON "finance"."fee_batch" USING btree ("building_id","replaces_batch_id") WHERE (replaces_batch_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "ix_fee_notice_job_building_claim" ON "finance"."fee_notice_job" USING btree ("building_id","created_at") WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fee_notice_job_batch_active" ON "finance"."fee_notice_job" USING btree ("building_id","batch_id") WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "finance"."outbox_messages" USING btree ("next_attempt_at") WHERE "finance"."outbox_messages"."published_at" is null and "finance"."outbox_messages"."dead_at" is null;--> statement-breakpoint
CREATE INDEX "ix_gateway_event_building_intent" ON "finance"."gateway_event" USING btree ("building_id","intent_id") WHERE (intent_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "ix_gateway_event_building_open" ON "finance"."gateway_event" USING btree ("building_id","received_at" DESC NULLS FIRST) WHERE ((outcome <> ALL (ARRAY['pending'::text, 'posted'::text])) AND (reviewed_at IS NULL));--> statement-breakpoint
CREATE INDEX "ix_gateway_event_building_received" ON "finance"."gateway_event" USING btree ("building_id","received_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_gateway_event_building_unit" ON "finance"."gateway_event" USING btree ("building_id","unit_id","received_at" DESC NULLS FIRST) WHERE (unit_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "ix_import_job_building_created" ON "finance"."import_job" USING btree ("building_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_import_job_created" ON "finance"."import_job" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_payment_building_bank_reference" ON "finance"."payment" USING btree ("building_id","bank_reference") WHERE (bank_reference IS NOT NULL);--> statement-breakpoint
CREATE INDEX "ix_payment_building_received" ON "finance"."payment" USING btree ("building_id","received_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_payment_building_unit_received" ON "finance"."payment" USING btree ("building_id","unit_id","received_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_payment_building_unreconciled" ON "finance"."payment" USING btree ("building_id","amount","received_at") WHERE ((source = 'bank_transfer'::text) AND (status = 'posted'::text) AND (reconciled_at IS NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_building_statement_line" ON "finance"."payment" USING btree ("building_id","statement_line_id") WHERE ((statement_line_id IS NOT NULL) AND (status = 'posted'::text));--> statement-breakpoint
CREATE INDEX "ix_payment_intent_building_requery" ON "finance"."payment_intent" USING btree ("building_id","next_check_at") WHERE (status = ANY (ARRAY['creating'::text, 'pending'::text, 'cancelling'::text]));--> statement-breakpoint
CREATE INDEX "ix_payment_intent_building_unit" ON "finance"."payment_intent" USING btree ("building_id","unit_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_intent_item_charge_active" ON "finance"."payment_intent_item" USING btree ("building_id","charge_id") WHERE (released_at IS NULL);--> statement-breakpoint
CREATE INDEX "ix_receipt_building_payment" ON "finance"."receipt" USING btree ("building_id","payment_id");--> statement-breakpoint
CREATE INDEX "ix_receipt_building_unit_issued" ON "finance"."receipt" USING btree ("building_id","unit_id","issued_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_statement_import_building_created" ON "finance"."statement_import" USING btree ("building_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_statement_import_building_period" ON "finance"."statement_import" USING btree ("building_id","period_from","period_to") WHERE (status = 'processed'::text);--> statement-breakpoint
CREATE INDEX "ix_statement_line_building_import" ON "finance"."statement_line" USING btree ("building_id","import_id","line_no");--> statement-breakpoint
CREATE INDEX "ix_statement_line_building_payment" ON "finance"."statement_line" USING btree ("building_id","payment_id") WHERE (payment_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "ix_statement_line_building_status" ON "finance"."statement_line" USING btree ("building_id","match_status","booked_on" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_webhook_rejection_building_received" ON "finance"."webhook_rejection" USING btree ("building_id","received_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ix_webhook_rejection_received" ON "finance"."webhook_rejection" USING btree ("received_at");