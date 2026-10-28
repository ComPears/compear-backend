# Isolate optional location refresh from product deployment

The 28 October seed run reached the 45-minute job timeout while Overpass returned
502/504 responses. `continue-on-error` on the import step cannot rescue a job
that has already exhausted its entire timeout. Product seeding, build and memory
checks had passed, but publication and Render deployment never ran.

## Changes

- Product seeding no longer calls OpenStreetMap or stages store-location data.
  It retains the last committed locations, validates all three country catalogs,
  then commits and deploys them independently.
- Product seed runs serialize without cancelling an active deployment.
- Optional locations refresh in a separate workflow: weekly Sunday at 04:30 UTC
  or manually. Its 30-minute import limit is below its 40-minute job budget.
  A failed/timed-out import produces a warning and cannot commit candidate data.
- UK sub-query failures and empty regions reject the import before the CLI writes
  its output. They cannot silently replace last-good locations with partial data.
- Each publishing workflow stages only its own data and rebases on main before
  pushing. A rebase conflict fails closed rather than overwriting another change.
- Successful location updates are picked up by the next product deployment;
  they do not trigger a separate competing Render deployment.

## Verification

Backend tests cover workflow independence, the success-only location commit,
the import timeout, and rejected failed/empty imports without real OSM requests.
Run `npm test`, `npm run test:memory`, `npm audit` and actionlint before merge.
After merge, dispatch `seed-backend.yml` on main (not a rerun of the old revision).
Confirm catalog commit, Render deployment and `/health/ready` reporting that
exact commit. Do not rerun supermarket scraping just to synchronize published data.
