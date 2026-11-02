-- Custom migration (DOC-15 §11, DR-243): the guards that keep ledger rows frozen and their states moving only forward. Drizzle
-- does not model functions or triggers, so this file is hand-written; it is the DOC-15 §11 block as run there on PostgreSQL 18.6.
-- The use cases check first and answer a typed error; a trigger only catches a bug (DOC-21 §3).
-- The one exception to "ledger rows are never deleted": DemoReset sets
--   SELECT set_config('rms.demo_reset', :building_id::text, true);   -- transaction-local
-- after building.assertDemo(:building_id). A row of any other building is still refused.
CREATE FUNCTION finance.is_demo_reset(p_building_id uuid) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT coalesce(current_setting('rms.demo_reset', true), '') = p_building_id::text $$;

-- fee_batch: frozen once published; allowed transitions only
--> statement-breakpoint
CREATE FUNCTION finance.fee_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' OR finance.is_demo_reset(OLD.building_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'fee_batch % cannot be deleted once %', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'draft' AND (NEW.building_id, NEW.code, NEW.name, NEW.fee_month, NEW.replaces_batch_id, NEW.created_by)
       IS DISTINCT FROM (OLD.building_id, OLD.code, OLD.name, OLD.fee_month, OLD.replaces_batch_id, OLD.created_by) THEN
    RAISE EXCEPTION 'fee_batch % is frozen once %; only due_date and status change', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status, NEW.status) NOT IN
       (('draft', 'published'), ('published', 'recalled'), ('published', 'closed')) THEN
    RAISE EXCEPTION 'fee_batch % cannot go from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_fee_batch_guard BEFORE UPDATE OR DELETE ON finance.fee_batch
  FOR EACH ROW EXECUTE FUNCTION finance.fee_batch_guard();

-- charge: frozen once not draft; allowed transitions; publish requires amount = Σ lines
--> statement-breakpoint
CREATE FUNCTION finance.charge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_sum bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' OR finance.is_demo_reset(OLD.building_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'charge % cannot be deleted once %', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'draft' AND (NEW.building_id, NEW.batch_id, NEW.unit_id, NEW.unit_code, NEW.amount)
       IS DISTINCT FROM (OLD.building_id, OLD.batch_id, OLD.unit_id, OLD.unit_code, OLD.amount) THEN
    RAISE EXCEPTION 'charge % amount is immutable once %', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) NOT IN
         (('draft', 'open'), ('open', 'paid'), ('paid', 'open'), ('open', 'void')) THEN
      RAISE EXCEPTION 'charge % cannot go from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.status = 'open' AND OLD.status = 'draft' THEN
      SELECT sum(amount) INTO v_sum FROM finance.charge_line WHERE charge_id = NEW.id;
      IF v_sum IS DISTINCT FROM NEW.amount THEN
        RAISE EXCEPTION 'charge % amount % differs from its lines (%)', NEW.id, NEW.amount, coalesce(v_sum::text, 'no lines')
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_charge_guard BEFORE UPDATE OR DELETE ON finance.charge
  FOR EACH ROW EXECUTE FUNCTION finance.charge_guard();

-- charge_line: written only while its charge is draft
--> statement-breakpoint
CREATE FUNCTION finance.charge_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_charge uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.charge_id ELSE NEW.charge_id END;
  v_building uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.building_id ELSE NEW.building_id END;
  v_status text;
BEGIN
  IF finance.is_demo_reset(v_building) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT status INTO v_status FROM finance.charge WHERE id = v_charge;
  -- no row on DELETE: the parent draft charge is being deleted (cascade)
  IF v_status = 'draft' OR (v_status IS NULL AND TG_OP = 'DELETE') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.charge_id IS DISTINCT FROM OLD.charge_id THEN
    RAISE EXCEPTION 'charge_line % cannot move to another charge', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RAISE EXCEPTION 'charge_line of charge % is immutable once %', v_charge, coalesce(v_status, 'missing')
    USING ERRCODE = 'integrity_constraint_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_charge_line_guard BEFORE INSERT OR UPDATE OR DELETE ON finance.charge_line
  FOR EACH ROW EXECUTE FUNCTION finance.charge_line_guard();

-- payment, allocation, receipt: append-only; only the void columns (and a few named ones) change
--> statement-breakpoint
CREATE FUNCTION finance.payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF finance.is_demo_reset(OLD.building_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'payment % is never deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.building_id, NEW.unit_id, NEW.source, NEW.amount, NEW.received_at, NEW.payer_name, NEW.provider,
      NEW.gateway_reference, NEW.intent_id, NEW.client_key, NEW.recorded_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.building_id, OLD.unit_id, OLD.source, OLD.amount, OLD.received_at, OLD.payer_name, OLD.provider,
      OLD.gateway_reference, OLD.intent_id, OLD.client_key, OLD.recorded_by, OLD.created_at)
     OR (OLD.status = 'void' AND NEW.status <> 'void') THEN
    RAISE EXCEPTION 'payment % is append-only: only void and reconciliation columns change', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_payment_guard BEFORE UPDATE OR DELETE ON finance.payment
  FOR EACH ROW EXECUTE FUNCTION finance.payment_guard();

--> statement-breakpoint
CREATE FUNCTION finance.allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF finance.is_demo_reset(OLD.building_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'allocation % is never deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.building_id, NEW.payment_id, NEW.charge_id, NEW.amount, NEW.created_at)
     IS DISTINCT FROM (OLD.building_id, OLD.payment_id, OLD.charge_id, OLD.amount, OLD.created_at)
     OR (OLD.status = 'void' AND NEW.status <> 'void') THEN
    RAISE EXCEPTION 'allocation % is append-only: only live -> void', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_allocation_guard BEFORE UPDATE OR DELETE ON finance.allocation
  FOR EACH ROW EXECUTE FUNCTION finance.allocation_guard();

--> statement-breakpoint
CREATE FUNCTION finance.receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF finance.is_demo_reset(OLD.building_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'receipt % is never deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.building_id, NEW.number, NEW.allocation_id, NEW.payment_id, NEW.charge_id, NEW.unit_id, NEW.amount,
      NEW.snapshot, NEW.issued_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.building_id, OLD.number, OLD.allocation_id, OLD.payment_id, OLD.charge_id, OLD.unit_id, OLD.amount,
      OLD.snapshot, OLD.issued_at, OLD.created_at)
     OR (OLD.status = 'void' AND NEW.status <> 'void') THEN
    RAISE EXCEPTION 'receipt % is frozen: only status, voided_at, pdf_file and external_invoice change', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_receipt_guard BEFORE UPDATE OR DELETE ON finance.receipt
  FOR EACH ROW EXECUTE FUNCTION finance.receipt_guard();

-- gateway_event: the confirmation is frozen; the outcome leaves 'pending' once; a review is written once
--> statement-breakpoint
CREATE FUNCTION finance.gateway_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF finance.is_demo_reset(OLD.building_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'gateway_event % is never deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.building_id, NEW.provider, NEW.reference, NEW.order_code, NEW.amount, NEW.paid_at, NEW.source,
      NEW.payload, NEW.received_at)
     IS DISTINCT FROM
     (OLD.building_id, OLD.provider, OLD.reference, OLD.order_code, OLD.amount, OLD.paid_at, OLD.source,
      OLD.payload, OLD.received_at)
     OR (OLD.outcome <> 'pending' AND (NEW.outcome, NEW.payment_id, NEW.intent_id, NEW.unit_id)
           IS DISTINCT FROM (OLD.outcome, OLD.payment_id, OLD.intent_id, OLD.unit_id))
     OR (OLD.reviewed_at IS NOT NULL AND (NEW.reviewed_at, NEW.reviewed_by, NEW.review_note)
           IS DISTINCT FROM (OLD.reviewed_at, OLD.reviewed_by, OLD.review_note)) THEN
    RAISE EXCEPTION 'gateway_event % is frozen: the outcome is set once, the review once', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_gateway_event_guard BEFORE UPDATE OR DELETE ON finance.gateway_event
  FOR EACH ROW EXECUTE FUNCTION finance.gateway_event_guard();

-- statement_line: the bank's data is frozen; never deleted; a review is written once
--> statement-breakpoint
CREATE FUNCTION finance.statement_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF finance.is_demo_reset(OLD.building_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'statement_line % is never deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.building_id, NEW.import_id, NEW.line_no, NEW.booked_on, NEW.amount, NEW.content, NEW.bank_reference,
      NEW.dedup_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.building_id, OLD.import_id, OLD.line_no, OLD.booked_on, OLD.amount, OLD.content, OLD.bank_reference,
      OLD.dedup_key, OLD.created_at)
     OR (OLD.reviewed_at IS NOT NULL AND (NEW.reviewed_at, NEW.reviewed_by, NEW.review_note, NEW.match_status)
           IS DISTINCT FROM (OLD.reviewed_at, OLD.reviewed_by, OLD.review_note, OLD.match_status)) THEN
    RAISE EXCEPTION 'statement_line % is frozen: only matching and one review change', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_statement_line_guard BEFORE UPDATE OR DELETE ON finance.statement_line
  FOR EACH ROW EXECUTE FUNCTION finance.statement_line_guard();

-- Never deleted outside a demo reset: intents and their items, statement imports, the counters
--> statement-breakpoint
CREATE FUNCTION finance.no_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF finance.is_demo_reset(OLD.building_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION '% row is never deleted', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_payment_intent_no_delete BEFORE DELETE ON finance.payment_intent
  FOR EACH ROW EXECUTE FUNCTION finance.no_delete_guard();
--> statement-breakpoint
CREATE TRIGGER trg_payment_intent_item_no_delete BEFORE DELETE ON finance.payment_intent_item
  FOR EACH ROW EXECUTE FUNCTION finance.no_delete_guard();
--> statement-breakpoint
CREATE TRIGGER trg_statement_import_no_delete BEFORE DELETE ON finance.statement_import
  FOR EACH ROW EXECUTE FUNCTION finance.no_delete_guard();
--> statement-breakpoint
CREATE TRIGGER trg_document_counter_no_delete BEFORE DELETE ON finance.document_counter
  FOR EACH ROW EXECUTE FUNCTION finance.no_delete_guard();
