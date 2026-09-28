# Dependency and security review — 2026-09-28

## Open PRs covered

This consolidation includes #14 (OpenAI SDK 7.23.0), #15 (tsx 4.23.15), and
#16 (CodeQL's pinned action revision). Existing bot PRs should only be closed
after this replacement is merged. No deployment, production writes or paid
AI requests were manually triggered during verification.

## Findings and fixes

- **Unauthenticated requests reached in-memory multipart parsing.** A forged
  or missing receipt token was checked only after Multer buffered the upload.
  Authentication now runs first. Upload callers must send the documented
  credential headers or Bearer credentials, not credentials in multipart fields.
  The existing frontend already uses headers.
- **Multipart metadata and aggregate upload work were insufficiently bounded.**
  The existing one-file/8 MiB limit now also caps fields (four), each field's
  bytes (4 KiB), and total parts (five). A per-process two-request admission
  limit spans upload parsing, image preparation and AI processing. Busy callers
  receive 503 with Retry-After. Disconnecting during processing cannot free a
  slot while that processing is still active.
- **Receipt rate-limit identity came from an unverified header.** The upload
  limiter now uses the verified identity, including for Bearer authentication,
  preventing forged identity headers from selecting another user's bucket.
- **Sensitive responses lacked an explicit cache prohibition.** Receipt/session
  responses now use `Cache-Control: private, no-store`. Multipart limit errors
  return bounded 400/413 responses instead of generic server failures.

No evidence of production exploitation was established. Limits are per process;
multi-instance deployment would need shared quotas. Authentication is not an
invitation system: new anonymous receipt sessions remain an intentional feature.
Byte/concurrency limits reduce resource abuse; they do not prove arbitrary
image decoders cannot exhaust resources on a specially crafted input.

## Verification

- GitHub: zero open Dependabot, CodeQL and secret-scanning alerts at review time.
- Node 22: build and all 53 tests pass (34 TypeScript tests, 19 JavaScript tests).
- Real local HTTP tests confirm rejection before multipart parsing, forged
  token rejection, metadata/file limits, valid Bearer access, and cache headers.
  Admission tests cover saturation, disconnects and idempotent slot release.
- Memory-budget benchmark with real catalogs, 20 rounds and six concurrent
  requests: maximum heap 204.2 MiB and RSS 340 MiB; the configured gate passed.
- `npm audit`: zero known vulnerabilities, including development dependencies.
- `npm audit signatures`: all 116 installed packages had verified registry
  signatures; ten had verified attestations. Sources remain on registry.npmjs.org.

No suspicious changes were found in the reviewed dependency diff. Registry
signatures and automated scans cannot certify that a repository is malware-free;
this is a scoped source/dependency review, not an exhaustive penetration test.

Reference: [Multer memory storage and limits](https://expressjs.com/en/resources/middleware/multer/).
