# ADR-0001: Record architecture decisions as short ADRs sourced from the decision register

- Status: Accepted
- Date: 2026-10-19 · Related: DOC-13, master plan §0.3, §3.2

## Context

The project is built by one person from a design that already holds 100+ decisions in the decision register (`docs/00-decision-register.md`). Most of them are small. A few are hard to reverse and touch many modules: the ledger, the module boundaries, the deployment topology, the identity model. Those need a stable, short record that a reader meets in the code review of the task that depends on them, without reading the whole register. The register itself is a working list that the Owner reviews and edits; an ADR must not change under a reader's feet.

## Options considered

1. **Register only.** Every decision stays a DR. No second place to maintain — but a DR is edited in place with `Revised` notes, mixes problem statements with proposals and has no gate or supersession chain; architecture-level decisions get lost among 100 entries.
2. **One ADR per DR.** Complete, but most DRs are conventions (a code format, a limit) that do not deserve a separate document, and the index would repeat the register.
3. **ADRs only for architecture-level decisions, short MADR, sourced from DRs.** The register stays the place where decisions are proposed and decided; an ADR is written for the 26 architecture-level subjects listed in master plan §3.2 and never edited in substance afterwards.

## Decision

Option **3** is chosen.

- ADRs live in `docs/04-adr/NNNN-kebab-title.md`, numbered from 0001; a number is never reused. The title states the decision, not the topic.
- Template: master plan Appendix A.1 (Context, Options considered, Decision, Consequences with a real negative part and follow-up work). Header lines: `Status` (`Proposed`, `Accepted`, `Superseded by ADR-yyyy`), `Date`, `Related`.
- Each ADR cites its source DRs. It links to the design documents for detail and does not copy them.
- An ADR is `Accepted` when its source DRs are decided. It is `Proposed` while a source DR is still open (ADR-0007 waits for the gateway sandbox).
- An accepted ADR is never edited in substance. A changed decision gets a new DR and a new ADR; the old one is marked `Superseded by ADR-yyyy`. Typos and broken links may be fixed.
- `docs/04-adr/README.md` (DOC-13) is the index: ADR · title · status · gate · source DR. Writing or superseding an ADR updates it in the same change, and the master plan's ADR table follows.
- The gate of an ADR is the phase that needs it `Accepted` before it starts (master plan §3.2).

## Consequences

**Positive**

- A reviewer of a task reads the one ADR it depends on, with the rejected options.
- The register can keep changing during review without invalidating the records.

**Negative**

- Two places hold a decision (DR and ADR). They can drift; the ADR cites the DR and a changed DR triggers a new ADR, but nothing enforces it except review.
- Writing 26 ADRs is about two days of work that produces no code.

**Follow-up work**

- Write ADR-0002…0026 in the order of the index; update DOC-13 each time.
- The pull-request template asks whether a decision changed (master plan §7.3).
