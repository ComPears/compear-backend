# Render heap exhaustion and dependency consolidation

## Diagnosis

The supplied September 21 logs show the process starting with 250.5 MiB of used heap against a roughly 258 MiB heap ceiling. Garbage collection then spends seconds trying to reclaim live objects and V8 aborts with `JavaScript heap out of memory`. The preceding `/seo-index` requests returned HTTP 200; the slow requests and fatal process failure are distinct events. Rebuilding after each restart reloads the same large catalog and indexes, so restarting alone cannot fix the resource budget.

The committed snapshot matches the logs: 68,610 NL, 8,410 UK and 2,996 DE products (80,016 total). Before this patch, a local Node 22 profile retained about 103 MiB for catalogs and another 103 MiB for search indexes. Three token Sets per product and independently allocated dietary-label Sets consume substantial space. Each SEO request also rebuilt a full offer object graph and serialized it again.

Exit **139** conventionally means SIGSEGV (128 + signal 11), a native segmentation fault. It is not enough evidence to label every daily failure an OOM. The supplied fatal V8 message proves this particular memory failure; a separate 139 incident still needs its adjacent logs, runtime version and, if it persists, Render/native crash investigation. No segmentation fault occurred during the Linux regression run.

## Changes

- Compact, interned search token arrays preserve the existing ranking rules without retaining three hash sets per product.
- Parsed catalog objects are normalized in place; dietary-label combinations share read-only sets.
- SEO comparison eligibility is indexed once. Paginated responses allocate only the requested page (maximum 500 groups). Legacy unpaginated clients still receive the full array, using one cached serialized Buffer and ETag per live country catalog. Replacing a catalog invalidates that cache by identity.
- Runtime metrics now expose the effective heap limit, headroom, Node/V8 version and platform.
- Node 22 is aligned across Docker, native Render configuration, local development and backend CI. The frontend independently uses Node 24 for its updated barcode library.
- A real-server memory regression runs in PR CI **and after daily seeding, before committing catalogs or triggering Render**. Previously data-only seed commits skipped normal app CI, so catalog growth had no runtime-memory gate. Branch-only seed tests no longer trigger a production redeploy.

## Verification

- 50 backend regression tests pass, including SEO pagination/cache/country separation and receipt/security boundaries.
- Equivalent local catalog/index profiling: retained heap fell from approximately 208 MiB to 149 MiB after garbage collection, without dropping products or countries.
- Full-server Linux/amd64 Docker run: Node 22.23.2, 512 MiB container RAM, no swap, 256 MiB old-space and 1 MiB semi-space, offline networking, one CPU.
- All three countries: paginated SEO output exactly equals legacy output; conditional ETags return 304; 20 rounds of six concurrent search/SEO requests succeed.
- Linux startup used 198.2 MiB heap; sampled peak heap was 202.5 MiB and sampled peak RSS 313.5 MiB. These are local test measurements, not production performance guarantees or continuously sampled absolute peaks.
- `npm audit`: no known vulnerabilities in the resolved dependency tree.

Reproduce after `npm ci && npm run build` with `npm run test:memory`. This launches a local-only ephemeral-port backend and shuts it down afterward; it never contacts production or writes catalogs.

## Dependabot PRs included

Includes the changes requested in #10 (Multer/OpenAI), #11 (Node types), and #12 (pinned CodeQL action). The lockfile resolves compatible versions within those requested ranges. Existing Dependabot PRs are not merged to main by this branch; review this consolidated PR first.

## Rollout and operational limits

1. Merge and deploy the backend fix after CI passes, then the frontend pagination/dependency fix. Both SEO contracts remain compatible during either deployment order.
2. For a dashboard-managed native Render service, verify Node is 22.x; existing dashboard settings may override the Blueprint. Docker services use the Dockerfile. Check `/health/ready` and authenticated `/health/metrics` for the deployed revision and heap headroom.
3. Do not set a 2–4 GiB heap on a 512 MiB service. This patch passes at the existing 256 MiB old-space cap; increasing the cap is not its remedy. Leave room for Buffers, image decoding, runtime/native memory and the operating system.
4. If daily growth trips the new memory gate, investigate catalog changes or deliberately increase service capacity before publishing. The gate preserves the deployed last-good catalog instead of pushing data that cannot fit.
5. If exit 139 recurs after this deployment, retain the exact timestamp, runtime/version/revision and immediately preceding native stack. The fix addresses proven heap pressure, not an unobserved native crash cause. No Render plan, secrets or production deployment were changed during this task.

References: [Node memory limits](https://nodejs.org/download/release/v22.15.0/docs/api/cli.html#--max-old-space-sizesize-in-mib), [Node signal exits](https://nodejs.org/api/process.html#exit-codes), [Render health checks and crashes](https://render.com/tutorials/when-deploys-go-wrong/health-checks-and-crashes).
