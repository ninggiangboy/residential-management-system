## What and why
<one paragraph; link the task Pn-xx and the DR if there is one>

## Checklist
- [ ] Docs updated in this PR (a behavior change edits the document; a decision change is a DR or a new ADR)
- [ ] Migration is backward compatible for one release (expand now, contract later), or the PR says why not
- [ ] New configuration key: added to DOC-41 and to the schema (CF-01 passes)
- [ ] New metric or alert: added to DOC-40
- [ ] New test prefix: registered in DOC-88
- [ ] Web screen added or changed: the quality bar of DOC-54 §17 holds at `DEV_LATENCY_MS=400` and `=0` (Q1…Q8: no jump, no flash, motion in and out, aligned rows, both themes)
- [ ] Native change in a mobile app: `version` bumped in `app.config.ts`; a new binary is needed
- [ ] No secret, token or personal data in code, fixtures or logs
