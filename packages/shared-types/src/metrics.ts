/**
 * The metrics that business modules report (DOC-40 §4.3, §4.4): the name of each and the closed set of values of its labels. A
 * module calls `metrics.inc('auth_refresh_total', { outcome: 'reuse' })` and the compiler refuses a name or a value that DOC-40 does
 * not list; the registry behind the port lives in `apps/api` (`bootstrap/metrics.ts`) and the test OB-01 keeps both equal to the
 * document. A label never holds a person: an email, a phone or an id of an account or unit is not a value here (DOC-40 §4 rule 2).
 */
import type { TemplateKey } from './notification'
import type { UsageApp, UsageAudience, UsageEventKind, UsageName } from './usage'

/** The counters, with the labels of each (`undefined` = none). */
export interface CounterLabels {
  auth_staff_login_total: { outcome: 'ok' | 'invalid' | 'locked' | 'rate_limited' }
  auth_lockouts_total: undefined
  auth_otp_requested_total: {
    outcome:
      | 'issued'
      | 'not_registered'
      | 'resend_wait'
      | 'phone_limited'
      | 'ip_limited'
      | 'daily_cap'
      | 'sms_down'
  }
  auth_otp_verify_total: { outcome: 'ok' | 'invalid' | 'expired' | 'exhausted' }
  otp_daily_cap_reached_total: undefined
  auth_refresh_total: { outcome: 'ok' | 'grace' | 'reuse' | 'expired' | 'account_inactive' }
  /** The ten reasons of DOC-26 §3.8. */
  auth_sessions_revoked_total: { reason: string }
  auth_step_up_total: {
    action: 'gateway_config' | 'admin_change' | 'staff_email'
    outcome: 'requested' | 'ok' | 'failed' | 'rate_limited'
  }
  sms_sent_total: {
    outcome: 'sent' | 'expired' | 'skipped_demo' | 'skipped_unknown' | 'not_allowlisted' | 'failed'
  }
  mail_sent_total: {
    outcome: 'sent' | 'expired' | 'skipped_demo' | 'skipped_unknown' | 'failed'
  }
  membership_changes_total: {
    change: 'added' | 'removed' | 'type_changed' | 'can_pay_changed' | 'locked' | 'unlocked'
    actor: 'resident' | 'staff' | 'system'
  }
  membership_guard_refusals_total: { reason: 'missing' | 'locked' }
  member_invitations_total: { outcome: 'queued' | 'owner_cap' | 'phone_bucket' }
  owner_transfers_total: { keep_members: 'true' | 'false' }
  import_commits_total: { outcome: 'committed' | 'expired' | 'stale' | 'not_ready' }
  client_errors_total: {
    app: 'resident' | 'staff' | 'web'
    kind: 'crash' | 'unhandled_rejection' | 'render' | 'network'
  }
  /** DR-279, DOC-104 §11: the labels hold no person, and `name` is a screen, a control or a lifecycle word of the closed lists. */
  usage_events_total: {
    app: UsageApp
    audience: UsageAudience
    event: UsageEventKind
    name: UsageName
  }
  usage_events_dropped_total: { reason: 'unknown_name' | 'disabled' | 'demo' }
  /** DOC-40 §4.8, DOC-31 §10: rows inserted by `CreateInboxEntries`; `template_key` is the closed catalog of DOC-31 §3.2. */
  inbox_entries_created_total: { template_key: TemplateKey }
  /** DOC-31 §10 (DR-301): one count per recipient device or account at the sender. */
  push_sent_total: {
    outcome:
      | 'accepted'
      | 'ticket_error'
      | 'skipped_off'
      | 'skipped_no_device'
      | 'skipped_session_dead'
      | 'skipped_expired'
  }
  push_receipts_total: { outcome: 'ok' | 'failed' | 'unknown' }
  /** DOC-42 §8.5, DOC-31 §10: the push reasons only; `sms` and `mail` join when their adapters report. */
  delivery_failed_total: {
    channel: 'push'
    reason:
      | 'device_not_registered'
      | 'message_too_big'
      | 'message_rate_exceeded'
      | 'mismatch_sender_id'
      | 'invalid_credentials'
      | 'other'
  }
  provider_auth_failed_total: { provider: 'push' }
  /** DOC-52 §15 (DR-289). */
  sse_stream_opens_total: { outcome: 'resumed' | 'fresh' | 'limited' }
  sse_events_published_total: {
    type:
      | 'inbox.created'
      | 'ticket.created'
      | 'ticket.changed'
      | 'money_log.opened'
      | 'export.ready'
      | 'session.revoked'
  }
}

/** The histograms, observed in seconds, with the labels of each (`undefined` = none). */
export interface HistogramLabels {
  import_validate_duration_seconds: undefined
  demo_reset_duration_seconds: undefined
  /** One observation of `durationSec` per `app_close` written (DOC-104 §11). */
  usage_foreground_seconds: { app: UsageApp; audience: UsageAudience }
}

export type HistogramName = keyof HistogramLabels

export type CounterName = keyof CounterLabels

type Args<L> = L extends undefined ? [] : [labels: L]

/** What a module needs to report: no registry, no library. */
export interface MetricsPort {
  inc<N extends CounterName>(name: N, ...labels: Args<CounterLabels[N]>): void
  /** `by` is 1 unless a batch is counted at once (`audit_purge_rows_total`). */
  add<N extends CounterName>(name: N, by: number, ...labels: Args<CounterLabels[N]>): void
  observe<N extends HistogramName>(
    name: N,
    seconds: number,
    ...labels: Args<HistogramLabels[N]>
  ): void
}

/** For the tests of a module and for a process that exports nothing. */
export const NO_METRICS: MetricsPort = {
  inc() {},
  add() {},
  observe() {},
}
