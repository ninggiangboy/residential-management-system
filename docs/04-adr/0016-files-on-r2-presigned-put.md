# ADR-0016: Store files on R2, upload with a presigned PUT, verify with `HEAD` and a magic-byte check, and track every object in `file_object` under a per-building quota

- Status: Accepted
- Date: 2026-10-19 · Related: DR-61, DR-83, DR-86, DR-07, FR-40, FR-19.1, FR-30.1, NFR-08, EXP-10, DOC-37, DOC-17, DOC-39

## Context

Residents upload ticket photos and videos, vehicle papers and plate photos; staff upload notice and library attachments, import files and statements; the worker writes generated PDFs and exports. The original SDD wanted a size-limited presigned upload and a quota of 50 GB per building with an alert at 80%, and "orphaned uploads deleted after 24 hours". Two facts changed the plan. An S3 presigned PUT cannot enforce a maximum size by itself. And the Owner chose Cloudflare R2 (DR-83), which supports presigned GET, HEAD, PUT and DELETE but **no presigned POST**, so the POST policy with `content-length-range` that DR-61 first assumed does not exist. The API also never carries a video (the Caddy body limit is 2 MB, DR-07), so the client must write to storage directly.

## Options considered

1. **Presigned POST with a size policy.** Enforces the size at the storage edge. Not available on R2. Rejected.
2. **Upload through the API.** The API could count bytes and verify content before storing. Videos up to 50 MB would pass through Caddy, `api` memory and the 2 MB limit; the host has 1 GB per `api` container (DOC-10 §6). Rejected.
3. **Presigned PUT, then verify afterwards.** The client writes to a fixed key with a signed `Content-Type`; the server checks size with `HEAD`, reads the first 4 KB for the magic bytes and deletes the object when it fails. Whether R2 also honors a signed `Content-Length` is checked in P1-07; the design does not depend on it.
4. **A Vietnam-hosted S3-compatible store for personal files.** Considered in the data-residency note of DR-83 as the fallback if counsel rejects Cloudflare for vehicle papers. Not chosen now; it is a configuration change behind `FilesApi`, not a redesign.

## Decision

Option **3** (DR-61, DR-83).

- `building` owns `file_object (id, building_id, module, purpose, object_key, mime, size, checksum, status, owner_ref, created_at, attached_at)`, status `pending | verified | attached | deleted`, behind the contract `FilesApi` (register, verify, attach, remove, usage). Other modules never touch the table or the bucket directly ([DOC-07](../03-architecture/system-context-and-containers.md) §6.4).
- Two private buckets per environment, `rms-<env>-files` and `rms-<env>-backup`, with separate API tokens: the files token cannot read the backup bucket. There is no public bucket and no CDN. The bucket CORS allows `PUT` and `GET` from `admin.<domain>` only.
- One object-key layout for every object, generated PDFs included: `{env}/{building_id}/{module}/{yyyy}/{mm}/{uuid}.{ext}`; `file_object.purpose` tells the kinds apart and the logical path of a cached PDF is `owner_ref` (DR-86).
- Flow: register (`pending`) → presigned PUT, 15 min, signed `Content-Type`, fixed key → `HEAD` size, magic bytes against the allowed types → `verified` → attach to the owning row. A wrong size or type deletes the object (`file_not_verified`, FR-40.2). Limits: images 10 MB, video 50 MB, attachments 20 MB, imports and statements 5 MB, logo 1 MB.
- Downloads are signed GET URLs inside DTOs: 15 min, 5 min for vehicle papers (FR-40.4).
- Quota is the sum of `size` of non-deleted files per building; an hourly job alerts at 80% and new uploads are refused at 100% with 413 `quota_exceeded`; `pending` files older than 24 h are deleted by the same job (FR-40.1, FR-40.3).
- The CCCD number is never a file; no CCCD image goes in the bucket (DR-83, DR-58).

## Consequences

**Positive**

- No upload byte passes through the API, so memory and the 2 MB Caddy limit are unaffected.
- One table and one contract make quota, orphan cleanup and signed URLs uniform for every module.

**Negative**

- The size is checked after the bytes are written: a client can briefly store an oversized object (up to the presign window) before `HEAD` deletes it, and storage is billed for it meanwhile.
- Verification reads 4 KB of each object and `HEAD`s it, adding a round trip to every upload; a crash between PUT and verify leaves a `pending` row that only the hourly job cleans.
- R2 is outside Vietnam, so vehicle papers and plate photos are personal data transferred abroad. The Owner deferred the legal review (DR-83); if counsel refuses, the files move to another S3-compatible store.
- Backups and files share one provider account (ADR-0017).

**Follow-up work**

- P1-07 proves on R2 that PUT limits hold, whether a signed `Content-Length` is honored, and that thumbnails (480 px, in the worker) run on the chosen runtime; the result goes into the compatibility table of [DOC-11](../03-architecture/tech-stack-and-versions.md).
- DOC-37 holds the flow, the limits table and the `FS-` tests; DOC-17 the DDL; DOC-39 the signed-URL and CORS rules.
