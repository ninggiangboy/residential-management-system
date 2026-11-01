# Experiments: the common protocol

> Status: **Draft** · Updated: 2026-11-01 (P1-27: first version, DR-318) · DOC-89
> Depends on: original SDD §20.2, §3.4, [DR](../../00-decision-register.md) (DR-06, 76, 77, 78, 80, 173, 318), [DOC-10](../../03-architecture/quality-attributes.md) §2, §4, [DOC-88](../test-strategy.md) §6, §7, §11, §12, §15, §16, [DOC-22](../../06-design/ledger-and-allocation.md) (the invariants), [DOC-71](../../09-operations/ci-cd.md) (stages), master plan §3.2, §5, template A.6
> Main readers: P2-14 (the first harness of this protocol), P2-11, P2-13, P3-08, P4-06, P5-02, P6-05, P6-07, P6-08; every document EXP-01…EXP-12 (DOC-90…101); the reviewer who decides whether a milestone may close

This document is what the twelve experiments have in common: where and how they run, how many times, how their numbers are summed up, how the right answer is known, what a baseline is, the formulas they share, the shape of the result files, and what a failing experiment does to a milestone. Each experiment file (template A.6) holds only what is its own: hypothesis, variables, baseline code, steps and criteria. It does not hold the test pyramid or the fixtures (DOC-88) or the numbers it is meant to check (DOC-10).

Until now DR-78 and a paragraph in each experiment stood in for this protocol (EXP-09, EXP-10). Where they differ from the text here, the text here wins from the day it is Approved and EXP-09 and EXP-10 are updated in the same change (§12).

## 1. The twelve experiments at a glance

| EXP | Document | What it proves | NFR | Where it runs | Kind of criterion | Task | Blocks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EXP-01 | DOC-90 | Duplicate and late webhooks make one payment | NFR-01, NFR-02 | staging | correctness, latency (p95 ≤ 5 s) | P3-08 | M3 |
| EXP-02 | DOC-91 | Webhook and re-query at one instant make one payment | NFR-01 | staging | correctness | P3-08 | M3 |
| EXP-03 | DOC-92 | Online and manual payment of one charge: exactly one wins | NFR-01 | database only | correctness, against a baseline | P2-14 | M2 |
| EXP-04 | DOC-93 | A recall racing payments leaves no live allocation on a void charge | NFR-01 | database only | correctness, against a baseline | P2-14 | M2 |
| EXP-05 | DOC-94 | A revoked QR code is never accepted | NFR-06 | staging | correctness | P5-02 | M5 |
| EXP-06 | DOC-95 | A notice reaches 5,000 recipients in time and once | NFR-04 | staging | latency, correctness | P4-06 | M4 |
| EXP-07 | DOC-96 | The API holds the load target | NFR-03 | staging | latency (median) | P6-07 | M6 |
| EXP-08 | DOC-97 | Bulk PDF fits the time and the memory | NFR-05 | staging | latency, memory | P2-13 | M2 |
| EXP-09 | DOC-98 | OTP abuse sends few SMS and guesses nothing | NFR-07 | staging | correctness | P1-23 | M1 |
| EXP-10 | DOC-99 | Every route refuses every actor it should | NFR-08 | CI `integration` (DR-173) | correctness, against mutants | P1-15, P6-08 | M1 (first), M6 (final) |
| EXP-11 | DOC-100 | The nightly check reports all 20 corruptions and nothing on clean data | NFR-09 | staging (of record); the injection part also nightly, database-only | correctness, against injected corruptions; duration (median) | P2-11 | M2 |
| EXP-12 | DOC-101 | A restore reaches a working system in time | NFR-11 | staging | duration, correctness | P6-05 | M6 |

(The blocked milestone is the one whose exit criteria name the experiment, master plan §4.) An experiment that is not yet written has its row here and its file number reserved; its task writes it.

## 2. Where an experiment runs

| Rule | Why |
| --- | --- |
| **Default: the staging host of DR-06** (2 vCPU, 4 GB, API ×1, worker and PostgreSQL co-located, `api ×1`). The numbers are conservative on purpose (original SDD §3.4) | The targets are set for this machine; a faster laptop would prove nothing about it |
| **Database-only experiments** (EXP-03, EXP-04) may run on a developer machine, and their cut-down form runs every night in the `nightly` stage (DOC-88 §11). A developer-machine result **describes the machine** in `machine` and is a result of record only for correctness criteria. **EXP-11** is of record on the staging host, because it also measures the cost of the nightly job on a 120,000-charge building; its injection part (no timing) runs every night as a regression guard, and is not a result of record | They measure races and queries, not speed (DR-78); DOC-22 §12 plans the staging run |
| **EXP-10 runs in the CI job `integration`**, with a developer machine as a second source (DR-173) | It is correctness-only and needs `CREATE DATABASE` rights that no application role has |
| The drivers are the `fake` payment driver, `console` SMS and mail, and a fake Expo endpoint, unless the experiment says otherwise. A real SMS, a real bank or a real payOS call is never part of an experiment | Cost and risk (DR-37); the real adapters are proved by their own tasks (P1-22, P3) |
| The host is quiet during a run: no deploy, no other experiment, no backup window, and the API restarted before run 1 | Co-location makes everything else a competing load |

**The machine record.** Every result file holds a `machine` object: `host` (`staging`, `ci`, `laptop`), `cpu` (model and count), `ramGb`, `os`, and for CI the runner image and size. The same object is read from the host by the script (`os.cpus()`, `os.totalmem()`, `/etc/os-release`), never typed by hand.

## 3. Runs and statistics

1. **Five runs** of the full experiment, one after the other, on the same commit (DR-78). The script refuses to start if the working tree is dirty and `EXP_ALLOW_DIRTY` is unset, and writes `commit` and `dirty` in every file.
2. **One warm-up pass** comes before run 1 for an experiment with a latency or memory criterion (EXP-01, 06, 07, 08, 12): it fills the caches and the connection pool and is **not** a run, not counted and not written to a result file. A correctness-only experiment has no warm-up, because a cold start is part of what it must survive (*DR-318*).
3. **Each run is summed up alone.** A percentile is computed from the samples of one run (§5). The five runs then give `min`, `median` (the third) and `max` of each metric. **Percentiles are never averaged or pooled across runs.**
4. **A correctness criterion holds in every run.** One run with one violation fails the experiment (DR-78). Nothing is averaged away: "0 duplicate receipts" means 0 in each of the five.
5. **A latency, duration or memory criterion holds in the median of the five runs**; the file also shows `max`, and a `max` above 1.5 × the criterion is written as a warning in the summary (it does not fail the experiment).
6. **No run is dropped.** There are no outliers to discard, and a run is not repeated because it looked bad. A failed set of five stays committed (§9); the fix is followed by a **new set of five**, and only a set in which every correctness criterion passes in every run counts.

**Example.** EXP-01 reports p95 of the webhook-to-visible latency. Run 1 had 1,000 samples and p95 = 3.9 s; the five runs give 3.9, 4.2, 4.0, 4.4 and 4.1 s: `min 3.9`, `median 4.1`, `max 4.4`. The criterion "p95 ≤ 5 s" holds in the median (4.1) and the maximum (4.4) is below 1.5 × 5 = 7.5, so there is no warning. A run that found one payment twice for one reference fails the correctness criterion "exactly one payment per reference" and the experiment, whatever the other four runs show.

## 4. Seeds, data and determinism

| Rule | Detail |
| --- | --- |
| **A seed per run.** `seed = baseSeed + run` (1…5), where `baseSeed` is a constant written in the experiment's document (a different one for each experiment) and echoed in the file | The five runs differ on purpose; any run can be repeated exactly |
| **The generator is `mulberry32`** (32-bit state, no dependency) behind `Rng` in `apps/api/tests/exp/lib/rng.ts`; `Math.random()` is never used in an experiment | A fixed algorithm outlives a runtime upgrade |
| **The data is generated, not copied.** The sample building of DOC-88 §7 is the base (a clone of the `sample` template database, one clone per run); the experiment adds its volume with the `Rng` (1,000 intents, 500 charges, 5,000 recipients) | A run starts from known rows and leaves nothing for the next |
| **The clock is real for latency and fake for logic.** A latency experiment reads `performance.now()` (monotonic); a correctness experiment that needs a time travel uses `FakeClock` (DOC-88 §9) | A latency under a fake clock means nothing |
| **Interleavings are not seeded.** The seed fixes the input, not the order in which two requests meet. A race is repeated enough times (`rounds` of the experiment) that the interleavings differ, and the criterion must hold **for every interleaving that occurred** | The scheduler cannot be seeded; that is why a race test is a barrier test with many rounds (DOC-88 §10) |

## 5. Ground truth: how the right answer is known

An experiment compares the system with an **oracle** that is not the system.

- **Computed from the input.** The generator knows how many payments there should be (one per reference), how many recipients (5,000), which corruption it injected (EXP-11). The expected value comes from the generator, never from a query on the table that the system wrote.
- **Read by independent SQL.** The observed value is read by a query written for the experiment, in `apps/api/tests/exp/oracle/`, connected as `rms_migrator` with the grants of DOC-14 (it reads every table). It does not call a repository or a use case of the module under test. The ledger invariants of DOC-22 §12 (Q01…Q19) are the shared queries (the same text the nightly job runs), so the experiment and the job cannot drift apart.
- **Written down before the run.** The `expected` of every criterion is in the experiment's document, with the number, and is copied to the file. A criterion changed after a run is a new experiment version (§9).

## 6. Baselines

A baseline is a deliberately naive or deliberately broken implementation of the same thing, run by the same harness on the same input. It answers one question: **can this harness fail?** A harness that stays green on a defective system proves nothing.

| Rule | Detail |
| --- | --- |
| Where it lives | `apps/api/tests/exp/baseline*.ts` (EXP-03's is `baseline.ts`, DR-78; another experiment's is `baseline-<topic>.ts`). Production code never imports it; the dependency rules (DOC-12 §14) reject an import from `src/` |
| It must fail | In its own run the baseline **violates at least one correctness criterion**, and the result file says how many violations it had. A baseline that passes means the harness is blind, and the experiment is `invalid`, not `pass` (§8) |
| It is written by the task that runs the experiment, not copied from the design | EXP-03: read the charge status, decide in code, write back at READ COMMITTED without the conditional predicate (DR-78) |
| The chosen design is run against the same input | The two results sit in one file: `baseline` and `chosen` |

| EXP | Baseline |
| --- | --- |
| EXP-03 | The naive settlement above; expected to settle some charges twice |
| EXP-04 | A recall that voids the charges of the batch without `status = 'open'` and without the count check of DOC-21 §3.5; expected to leave a void charge with a live allocation |
| EXP-10 | The 11 mutants (a defective guard each, DOC-99 §3) |
| EXP-11 | The 20 corruptions injected into a copy of clean data; the clean copy must report 0 (no false positive) |
| EXP-01, 02, 05, 06, 09 | A forged-signature-first case, a revoked code, a killed worker, a burst: each is a negative case inside the experiment, not a second implementation |
| EXP-07, 08, 12 | None: they measure against a budget, not against an alternative |

## 7. Shared formulas

| Name | Definition |
| --- | --- |
| `percentile(p, xs)` | **Nearest rank:** sort `xs` ascending, take the element at index `ceil(p/100 × n) − 1`. For n = 1,000, p95 is the 950th value. No interpolation (the result is always a sample that happened) |
| `median(runs)` | The third of five sorted values; for a sample set of even size, the lower middle |
| `min`, `max` | Over the five runs of a metric already reduced to one number per run |
| `violations` | The count of observations that break a correctness criterion in one run. The criterion says "0": `violations == 0` |
| `rate` | `violations / observations`, reported beside the count, never instead of it |
| `latency` | `end − start` on `performance.now()`, in milliseconds, with the start and the end defined by DR-80 / DOC-10 §2 for the NFR (NFR-02 from "webhook request accepted" to the first poll showing `paid`; NFR-04 to the last `POST` to Expo returned; NFR-12 to the response with the preview) |
| `rssPeakMb` | The highest resident set size of the process under test (the worker for EXP-08), sampled every 1,000 ms from `/proc/<pid>/status` (`VmRSS`) on Linux and `ps -o rss=` elsewhere, in MB (1 MB = 1,048,576 bytes) |
| `duration` | Wall-clock `finishedAt − startedAt` of the measured phase, excluding the setup the experiment names |
| `errorRate` | `responses with status ≥ 500 or a client timeout / requests`, as a percentage |
| `throughput` | `completed requests / measured seconds` |

These are implemented once in `apps/api/tests/exp/lib/stats.ts` and tested by `XP-01…05` (§11). An experiment that needs another formula defines it in its own §6 and says so in the summary.

## 8. Result files

Every file lives in `docs/10-testing/experiments/results/` (the directory exists) and is committed with the task that ran the experiment (DOC-88 §12). `<utc>` is `YYYYMMDDThhmmZ` of the first run.

```
results/EXP-03-20261203T0214Z-run1.json … -run5.json
results/EXP-03-20261203T0214Z-summary.json
```

**Per run.** The envelope of DOC-88 §12 (`experiment`, `run`, `of`, `commit`, `startedAt`, `finishedAt`, `machine`, `runtime`, `metrics`, `criteria`, `pass`) with these fields added; none of the existing ones is renamed:

```json
{
  "experiment": "EXP-03",
  "run": 2,
  "of": 5,
  "version": 1,
  "commit": "3f30820",
  "dirty": false,
  "seed": 20262,
  "startedAt": "2026-12-03T02:14:00.000Z",
  "finishedAt": "2026-12-03T02:21:12.000Z",
  "machine": { "host": "laptop", "cpu": "Apple M2 (8)", "ramGb": 16, "os": "macOS 27.2" },
  "runtime": { "bun": "1.4.3", "postgres": "18.6", "api": "sha-3f30820" },
  "metrics": { "charges": 500, "chosen": { "settledTwice": 0, "winners": 500 }, "baseline": { "settledTwice": 37, "winners": 463 } },
  "criteria": [
    { "id": "C1", "kind": "correctness", "expected": "chosen.settledTwice == 0", "observed": 0, "pass": true },
    { "id": "C2", "kind": "baseline", "expected": "baseline.settledTwice >= 1", "observed": 37, "pass": true }
  ],
  "warnings": [],
  "pass": true
}
```

**Summary.** Written after run 5; the keys `experiment`, `commit` and `runs` of the first summary (EXP-10, 2026-10-23) are kept and the rest added:

```json
{
  "experiment": "EXP-03",
  "version": 1,
  "commit": "3f30820",
  "machine": { "host": "laptop", "cpu": "Apple M2 (8)", "ramGb": 16, "os": "macOS 27.2" },
  "runs": [ { "run": 1, "pass": true, "metrics": { } } ],
  "statistics": { "chosen.settledTwice": { "min": 0, "median": 0, "max": 0 }, "baseline.settledTwice": { "min": 31, "median": 37, "max": 44 } },
  "criteria": [ { "id": "C1", "rule": "every-run", "values": [0, 0, 0, 0, 0], "expected": "== 0", "pass": true } ],
  "warnings": [],
  "outcome": "pass"
}
```

| Field | Rule |
| --- | --- |
| `version` | The version of the experiment's document whose criteria were used (§9) |
| `criteria[].kind` | `correctness` (every run), `latency` or `duration` or `memory` (the median), `baseline` (the baseline must fail), `parity` (two counts agree) |
| `criteria[].rule` (summary) | `every-run` or `median` |
| `outcome` | `pass`; `fail` (a criterion failed); `invalid` (a baseline passed, a run did not finish, the tree was dirty without the flag, or fewer than five runs). An `invalid` set is rerun and is never quoted as a result |
| Large output | A raw sample list (1,000 latencies) is **not** committed; the file holds the reduced numbers and, when useful, a histogram of at most 20 buckets. The full list goes to the job artifact |
| Stability | Keys in the order shown; numbers as numbers; times in UTC ISO 8601; no timestamp inside `metrics` |

**Immutable.** A committed result file is never edited. A mistake in a file is corrected by a new set whose summary has `supersedes: "<utc of the old set>"`. The old set stays, with the reason in the commit.

## 9. Versions and criteria

A criterion belongs to a **version** of the experiment's document (`version` in the file). Changing a threshold, a metric or the baseline after a result exists is a decision (a DR) and raises the version: the old set no longer backs the document, and the milestone needs a new set. A threshold is never loosened to make a set pass. The one exception is a threshold the Owner changes by a DR *before* the set that uses it is run.

## 10. A failing experiment and the milestone

1. A set with `outcome` `fail` or `invalid` **blocks the milestone** named in §1. The milestone's `Pn-00`-style review (master plan §4) reads the latest summary of each blocking experiment; one without a passing set is a blocker.
2. The committed summary of the failed set stays. The task that owns the experiment opens a defect, and the pass is shown by a new set (§3, point 6). The new summary says in `notes` what changed in the code, and not what changed in the experiment.
3. A criterion that cannot be met on the staging host's size (a latency one) is raised to the Owner with the numbers. The Owner may change the target by a DR (§9) or the host, never by editing the result.
4. **Only the Owner waives an experiment**, by a DR that names the experiment, the milestone, the reason and the date by which a passing set is due. A waiver is written in the register's decision log and in the milestone review. The experiments that prove the money invariant, the access invariant and recovery (EXP-01…04, 09, 10, 11, 12) are not waived for go-live: the go-live checklist (DOC-103) lists the passing set of each, and original SDD §21 names the mechanisms they protect as never cut.
5. A result older than the last change to the code it exercises is still the latest result; the nightly stage and the CI jobs are what notice a regression between sets (DOC-88 §11).

## 11. Required tests

Prefix `XP-` (experiment protocol; unused before this document; master plan §0.2; DOC-88 indexes it). They test the harness library, not an experiment, and run in `unit` without a database.

| ID | Scenario | Expected |
| --- | --- | --- |
| XP-01 | `percentile(95, xs)` for n = 1, 20, 1,000 and a list with ties | The nearest-rank element: n = 1 gives the only sample; n = 20 the 19th; n = 1,000 the 950th |
| XP-02 | `median` of five and of an even list; `min`, `max` | The third; the lower middle; as defined |
| XP-03 | `Rng` with the same seed twice; with seeds 1 and 2 | The same 1,000 values; different values; no value outside [0, 1) |
| XP-04 | `reduceRuns` on five runs with one failing correctness criterion and one latency criterion above its limit in the median | `outcome: fail` and both criteria named; a latency maximum of 1.6 × the limit with a passing median adds a warning and still passes |
| XP-05 | A summary of a set whose baseline had `settledTwice = 0` | `outcome: invalid` with the reason `baseline_passed` |
| XP-06 | `writeResult` of a file whose `run` or `of` is wrong; of a dirty tree without `EXP_ALLOW_DIRTY` | The file is not written; the dirty tree is `invalid` |
| XP-07 | `writeResult` over an existing file name | Refused: result files are immutable (§8) |
| XP-08 | `machineRecord()` on the test host | `cpu`, `ramGb`, `os` are filled from the host, never empty |
| XP-09 | The result files already committed under `results/` | Each validates against the envelope (the five fixed fields and `criteria[].id`); the EXP-10 files of 2026-10-23 and 2026-10-28 pass (their first version predates `kind`, `version` and `seed`: those fields are optional for a file with `of` = 5 written before 2026-11-01) |

## 12. Running and writing an experiment

```bash
bun run exp:03                # the five runs, the result files, the summary
EXP_RUNS=1 bun run exp:03     # a smoke run: writes results/EXP-03-<utc>-smoke-run1.json
```

- The script of experiment `NN` is `apps/api/tests/exp/expNN-<name>.ts` and the command `bun run exp:NN` (DOC-88 §12 says `apps/api/test/exp/`; the directory is `tests/exp/`, as the first script of EXP-10 has it). The shared code is `apps/api/tests/exp/lib/` (`rng.ts`, `stats.ts`, `machine.ts`, `result.ts`); P2-14 writes it with the first of the new experiments, and EXP-10's script is moved onto it when it is next changed (it has its own writer today and produces the same fields).
- A smoke run (`EXP_RUNS=1`) is for development: its file is named `-smoke-`, has `of: 1`, and the summary is `invalid` by definition. It is not committed.
- **A new experiment** is a file from template A.6, a row in §1, a script, and its `baseSeed`, `rounds`, volumes and criteria written in its document before the first run. Its hypothesis cites an NFR; its criteria are `C1…` (they are not test IDs).
- **Updating EXP-09 and EXP-10.** Their paragraph "Until DOC-89 exists" is replaced by a link to this document when each is next edited; nothing in their criteria changes.

## 13. Threats to validity common to all

| Threat | Handling |
| --- | --- |
| The staging host is shared with its own API and worker, so the load generator competes with the system | By design (conservative numbers); k6 runs from a second machine for EXP-07, and the other experiments drive the API in process or over loopback and say which |
| The fake gateway and the fake Expo endpoint answer faster or more kindly than the real ones | Each experiment states the latency it gives them (EXP-06: 200 ms); the first real payment before go-live is a separate check |
| Five runs are few for a tail percentile | The median of five is a stable estimate of a p95 over 1,000 samples; EXP-07 runs 15 minutes, which gives tens of thousands of samples per run; a tail target is recalibrated when EXP-07 first runs (DOC-10 §9) |
| A race that never happened looks like a pass | `rounds` is large, and each race experiment also counts the rounds in which both sides really overlapped (a barrier release timestamp within 5 ms) and reports it; a set where fewer than 90 % of the rounds overlapped is `invalid` (*DR-318*) |
| The oracle and the system share a bug (the same SQL) | The oracle is independent code (§5); the shared invariant queries are themselves tested against the 20 corruptions of EXP-11 |
| A result is quoted after the code moved on | A number is **planned** until a result file backs it and **measured** with the file's commit, machine and date (DOC-10 §2); a document that quotes one links the file |

## 14. Decisions made while writing

| Part of DR-318 | Decision | Where used |
| --- | --- | --- |
| Warm-up | One unrecorded warm-up pass before run 1 for latency, duration and memory experiments; none for correctness-only ones | §3 |
| Percentile | Nearest rank, per run, never averaged across runs | §3, §7 |
| Failed sets | A failed or invalid set stays committed; the fix needs a new set of five; no run is dropped or repeated alone | §3, §10 |
| Baseline must fail | A baseline that passes makes the experiment `invalid` | §6, §8 |
| Overlap | A race experiment is `invalid` if fewer than 90 % of its rounds overlapped within 5 ms | §13 |
| Immutability and versions | A result file is never edited; a criterion change raises `version` and needs a new set | §8, §9 |
| Waiver | Only the Owner, by a DR, with a due date; none for the go-live gates | §10 |
| Paths | The scripts are in `apps/api/tests/exp/`, not `test/exp/` | §12 |

## 15. Not in this document

| Topic | Lives in |
| --- | --- |
| The test pyramid, fixtures, the template database, the race harness | DOC-88 |
| The numbers an experiment checks (targets, budgets) | DOC-10 |
| Hypothesis, variables, steps and criteria of one experiment | DOC-90…101 |
| The invariant queries that EXP-11 and the nightly job share | DOC-22 §12 (Q01…Q19) |
| The CI stages that run the cut-down forms | DOC-71, DOC-88 §11 |

## 16. Traceability

| Section | Decision | Requirements and checks |
| --- | --- | --- |
| §2 where | DR-06, DR-77, DR-78, DR-173 | NFR-01…12; DOC-10 §2 |
| §3 runs and statistics | DR-78, DR-318 | `XP-01…04` |
| §4 seeds | DR-78, DR-318 | `XP-03` |
| §5 oracle, §6 baselines | DR-78 | `XP-05` |
| §8 result files | DR-77, DR-78 | `XP-06…09` |
| §10 blocking | DR-77, DR-318 | master plan §4, §7 |

## Open questions

None. DR-318 is decided under the Owner's delegation (2026-11-01) and none of its parts touches money or access.
