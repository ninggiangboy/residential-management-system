#!/usr/bin/env python3
"""Capacity model for DOC-10 (planned numbers, never measured).

Run:  python3 docs/03-architecture/capacity/capacity.py
Every input below is an assumption of 2026-10-19. A row size is bytes per row
including its indexes (heap + index, no bloat). The model is replaced by
measured numbers when P1-20 / EXP-07 / EXP-08 produce result files.
"""
from dataclasses import dataclass

# ---- bytes per row, heap + indexes (planned) -------------------------------
ROW_BYTES = {
    "finance.payment": 380, "finance.allocation": 260, "finance.receipt": 1800,
    "finance.payment_intent": 420, "finance.payment_intent_item": 200,
    "finance.gateway_event": 900, "platform.idempotency_key": 1200,
    "audit.audit_log": 700, "outbox_messages": 600, "inbox": 160,
    "notification.inbox_entry": 420, "notification.push_ticket": 220,
    "finance.charge": 400, "finance.charge_line": 250,
    "notices.notice_recipient": 200, "tickets.ticket": 500,
    "tickets.ticket_message": 400, "building.file_object": 400,
    "access.qr_scan": 120, "building.job_run": 220,
}

# ---- 1. rows written by ONE online payment (avg 1.5 charges, 2.2 payers) ----
CHARGES_PER_PAYMENT = 1.5
VISIBLE_MEMBERS = 2.2          # owner + family + tenants who see fees
ONLINE_PAYMENT_ROWS = {
    "finance.payment": 1,
    "finance.allocation": CHARGES_PER_PAYMENT,
    "finance.receipt": CHARGES_PER_PAYMENT,
    "finance.payment_intent": 1,
    "finance.payment_intent_item": CHARGES_PER_PAYMENT,
    "finance.gateway_event": 1.1,           # 1 posted + ~10% unposted/duplicate-reference rows
    "platform.idempotency_key": 1,          # POST /me/payments/intents
    "audit.audit_log": 1,                   # actor_kind = 'system' (DR-57)
    # events: payment_posted + receipt_issued per receipt + receipt_render command per receipt
    "outbox_messages": 1 + 2 * CHARGES_PER_PAYMENT,
    "inbox": 1 + 2 * CHARGES_PER_PAYMENT,   # one handler per message (notification, render)
    "notification.inbox_entry": VISIBLE_MEMBERS,
    "notification.push_ticket": VISIBLE_MEMBERS * 0.9,  # 90% of members have a device token
}

def per_payment():
    rows = sum(ONLINE_PAYMENT_ROWS.values())
    b = sum(ROW_BYTES[t] * n for t, n in ONLINE_PAYMENT_ROWS.items())
    return rows, b

WAL_FACTOR = 3.0   # WAL bytes ~ 3 x heap+index bytes (full-page images, index updates) - planned
GB = 1024 ** 3
MB = 1024 ** 2

# ---- 2. stress days (rates from the master plan DOC-10 row) ----------------
def stress(scale):
    rows_p, bytes_p = per_payment()
    # publish day: 150 payments/h for 6 h after publish; due-eve: 100 per 2 h; rest of day 5/h
    publish_day = 150 * scale * 6 + 5 * scale * 18
    due_eve = 100 * scale * 1 + 5 * scale * 22     # 100 per 2 h = 50/h for 2 h
    out = []
    for name, n in (("publish day", publish_day), ("due-date eve", due_eve)):
        out.append((name, n, n * rows_p, n * bytes_p / GB, n * bytes_p * WAL_FACTOR / GB))
    return out

# ---- 3. steady monthly cycle per building size ------------------------------
@dataclass
class Scale:
    name: str
    units: int
    buildings: int = 1

def monthly(sc: Scale):
    u = sc.units
    accounts = 2.7 * u
    charges = 1.2 * u
    lines = 3.5 * charges
    pay_online = 0.7 * charges / CHARGES_PER_PAYMENT
    pay_manual = 0.3 * charges / CHARGES_PER_PAYMENT
    rows_p, bytes_p = per_payment()
    tickets = 0.15 * u
    notices = 4 * sc.buildings
    notice_recipients = notices * accounts / sc.buildings
    qr_scans = 0.5 * u * 30
    audit_staff = 40 * sc.buildings * 30
    t = {}
    def add(table, n): t[table] = t.get(table, 0) + n
    add("finance.charge", charges); add("finance.charge_line", lines)
    add("outbox_messages", charges * VISIBLE_MEMBERS / 20)   # publish fan-out is batched
    add("notification.inbox_entry", charges * VISIBLE_MEMBERS)  # fee.batch_published
    add("notification.push_ticket", charges * VISIBLE_MEMBERS * 0.9)
    for tb, n in ONLINE_PAYMENT_ROWS.items(): add(tb, n * pay_online)
    # manual payment: payment, allocations, receipts, audit (staff), outbox/inbox, inbox_entry, idempotency
    add("finance.payment", pay_manual); add("finance.allocation", pay_manual * CHARGES_PER_PAYMENT)
    add("finance.receipt", pay_manual * CHARGES_PER_PAYMENT); add("audit.audit_log", pay_manual)
    add("outbox_messages", pay_manual * 4); add("inbox", pay_manual * 4)
    add("notification.inbox_entry", pay_manual * VISIBLE_MEMBERS)
    add("platform.idempotency_key", pay_manual)
    add("tickets.ticket", tickets); add("tickets.ticket_message", tickets * 6)
    add("building.file_object", tickets * 4); add("audit.audit_log", tickets * 4)
    add("notification.inbox_entry", tickets * 5); add("outbox_messages", tickets * 6)
    add("notices.notice_recipient", notice_recipients)
    add("notification.inbox_entry", notice_recipients)
    add("notification.push_ticket", notice_recipients * 0.9)
    add("access.qr_scan", qr_scans)
    add("audit.audit_log", audit_staff)
    return t

# retention in days of the tables that are purged (None = kept; DR-57, DR-58, DR-62 + proposals)
RETENTION_DAYS = {
    "outbox_messages": 7, "inbox": 7,                 # published rows (reference default, DR-NEW-10-1)
    "platform.idempotency_key": 1, "notification.inbox_entry": 180,
    "notification.push_ticket": 7, "access.qr_scan": 90,
    "building.job_run": 30,                           # DR-NEW-10-1
    "audit.audit_log": 365 * 5,                       # 5 y finance, 2 y others: use 5 y (upper bound)
}

JOB_TICKS_PER_DAY = {  # DR-62 job catalog, runs that find nothing to do
    "notice_scheduler (30 s)": 2880, "intent_requery (30 s)": 2880,
    "notice_reclaim (60 s)": 1440, "push_receipts (5 min)": 288,
    "hourly jobs (3)": 72, "daily/weekly/monthly": 6,
}

def retained_gb(sc: Scale, years: float, with_proposal: bool):
    m = monthly(sc)
    total = 0.0
    for tb, n in m.items():
        per_day = n / 30.0
        keep = RETENTION_DAYS.get(tb)
        days = years * 365 if keep is None else min(keep, years * 365)
        total += per_day * days * ROW_BYTES[tb]
    # job_run is per worker, not per building (DR-62): flat in the scale
    ticks = sum(JOB_TICKS_PER_DAY.values())
    if with_proposal:      # only runs that did work (~40/day) are rows, purged after 30 days
        total += 40 * ROW_BYTES["building.job_run"] * min(30, years * 365)
    else:                  # every tick is a row, no purge
        total += ticks * ROW_BYTES["building.job_run"] * years * 365
    return total / GB

def files_gb_per_year(sc: Scale):
    u = sc.units
    tickets = 0.15 * u * 12
    ticket_mb = 3 * 1.5 + 0.2 * 25            # 3 photos 1.5 MB + 20% with a 25 MB video
    pdf_mb = 1.2 * u * 12 * 0.06 + 0.7 * 1.2 * u * 12 * 0.045   # fee notice 60 KB, receipt 45 KB
    vehicles_mb = 0.3 * u * (2 * 1.0)         # 0.3 new vehicles per unit per year, 2 photos of 1 MB
    notices_mb = 12 * 4 * sc.buildings * 2    # 4 notices/month, 2 MB attachments each
    return (tickets * ticket_mb + pdf_mb + vehicles_mb + notices_mb) / 1024

def requests_and_logs():
    print("\n== 7. Polling load of the payment screen, logs and metrics (planned) ==")
    qr_open_s = 240          # a resident keeps Pay-VietQR open about 4 min
    for scale in (1, 10):
        conc = 150 * scale * qr_open_s / 3600
        rps = conc / 2.2     # 2 s for the first 60 s, 3 s after: mean interval about 2.2 s over 4 min
        print(f"x{scale:<3d} {150*scale:5d} payments/h -> {conc:6.1f} open QR screens -> {rps:5.1f} polls/s")
    for name, units in (("sample 240", 240), ("x10 2400", 2400)):
        accounts = 2.7 * units
        req_day = accounts * 6 * 12 + 2000          # 6 app opens/day x 12 requests + staff and jobs
        raw_mb = req_day * 2 * 450 / MB             # 2 JSON lines per request, 450 B each
        loki_mb = raw_mb * 0.2                      # compressed chunks
        print(f"{name:12s} {req_day:9,.0f} req/day, {raw_mb:6.0f} MB/day raw logs, {loki_mb:5.0f} MB/day in Loki, "
              f"14 d = {loki_mb*14/1024:5.2f} GB")
    series, scrape = 3000, 15
    mb_day = series * (86400 / scrape) * 1.5 / MB
    print(f"Prometheus: {series} series, {scrape} s scrape -> {mb_day:.0f} MB/day, 15 d (software default retention) = {mb_day*15/1024:.2f} GB")

def main():
    rows_p, bytes_p = per_payment()
    print("== 1. One online payment (planned) ==")
    print(f"rows per payment: {rows_p:.1f}; bytes (heap+index): {bytes_p:,.0f}; WAL ~ {bytes_p*WAL_FACTOR:,.0f} B")
    for t, n in ONLINE_PAYMENT_ROWS.items():
        print(f"  {t:34s} {n:5.1f} rows x {ROW_BYTES[t]:5d} B")
    print("\n== 2. Stress days: rows/day and GB/day (planned upper bound, every payment online) ==")
    print(f"{'scale':8s}{'day':14s}{'payments':>10s}{'rows/day':>12s}{'GB/day':>9s}{'WAL GB/day':>12s}")
    for scale in (1, 10):
        for name, n, rows, g, w in stress(scale):
            print(f"x{scale:<7d}{name:14s}{n:10,.0f}{rows:12,.0f}{g:9.3f}{w:12.3f}")
    print("\n== 3. Steady month: rows/month and GB/month (planned) ==")
    scales = [Scale("sample 240", 240), Scale("x10 2400", 2400, 10), Scale("design 5000", 5000, 20)]
    print(f"{'scale':14s}{'payments':>10s}{'rows/month':>13s}{'rows/day':>11s}{'GB/month':>10s}")
    for sc in scales:
        m = monthly(sc)
        rows = sum(m.values()); gb = sum(n * ROW_BYTES[t] for t, n in m.items()) / GB
        pays = 1.2 * sc.units / CHARGES_PER_PAYMENT
        print(f"{sc.name:14s}{pays:10,.0f}{rows:13,.0f}{rows/30:11,.0f}{gb:10.3f}")
    print("\n== 4. Database size retained (GB, planned; includes purges, excludes bloat and WAL) ==")
    print(f"{'scale':14s}{'1 y':>8s}{'3 y':>8s}{'5 y':>8s}{'5 y without DR-NEW-10-1':>26s}")
    for sc in scales:
        print(f"{sc.name:14s}" + "".join(f"{retained_gb(sc, y, True):8.2f}" for y in (1, 3, 5))
              + f"{retained_gb(sc, 5, False):26.2f}")
    print("\n== 5. Object storage (files bucket: SeaweedFS in vn, R2 in global), GB per year (planned) ==")
    for sc in scales:
        per_b = files_gb_per_year(sc) / sc.buildings
        print(f"{sc.name:14s}{files_gb_per_year(sc):8.1f} GB/year in total; {per_b:5.1f} GB/year per building (quota 50 GB, alert at 40 GB)")
    print("\n== 6. Job ticks (DR-62) ==")
    ticks = sum(JOB_TICKS_PER_DAY.values())
    print(f"job_run rows/day if every tick writes a row: {ticks:,}  -> {ticks*ROW_BYTES['building.job_run']/MB:.2f} MB/day, "
          f"{ticks*ROW_BYTES['building.job_run']*365/GB:.2f} GB/year per worker")
    requests_and_logs()
    print("\n== 8. WAL archive objects ==")
    print("archive_timeout 60 s with activity -> up to 1,440 WAL segments/day (16 MB raw each, compressed size to be measured in P1-20)")

if __name__ == "__main__":
    main()
