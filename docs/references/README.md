# References

Inputs to the system design, kept in the repo so the design and its sources live together. They are condensed copies, not mirrors.

| File | What it is | Source |
| --- | --- | --- |
| [product-proposal.md](product-proposal.md) | Product proposal and feature checklist (Vietnamese): user groups, 11 modules, 139 features, main flows, scope and points to confirm | Client proposal v1.0, 10/10/2026 |
| [design-screens.md](design-screens.md) | Catalog of the 115 design artboards per app and role, and the business rules they imply | Design canvas <https://claude.ai/artifact/PLqx2HGSNuZFiVDaLhtgvj> |
| [architecture-reference/](architecture-reference/) | Selected chapters and patterns of the reference modular monolith (Elysia, Bun, Drizzle, Postgres) whose architecture this system follows | `elysia-architecture` repository, `docs/` |

The architecture reference keeps only the chapters and patterns this system uses (modules, messaging, runtime, identity, notifications, billing, i18n, testing; outbox, inbox, webhooks and ledger, SKIP LOCKED, single-use tokens, gapless numbering, rate limits, uploads). Links inside those files that point to omitted chapters or to source code of the reference repository do not resolve here.
