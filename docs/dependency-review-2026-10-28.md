# Dependency review: 28 October 2026

## Changes

- Incorporates Dependabot #25 (Multer 2.5.0) and #23 (GitHub Actions updates).
- Direct npm audit found two vulnerabilities despite GitHub returning no open
  Dependabot or CodeQL alerts at review time:
  - [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828):
    high-severity denial of service in compressed request-body parsing. Upgrade
    the resolved body-parser from 2.3.0 to 2.4.0.
  - [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw):
    moderate-severity uncaught TypeError in qs stringify. Upgrade the resolved
    qs from 6.16.0 to 6.17.0.
- Update SHA-pinned setup-node, upload-artifact and CodeQL actions, retaining
  existing workflow permissions and the patched Node 22.23.4 runtime.

## Local verification

- Clean `npm ci`, TypeScript build and all 60 tests pass on Node 22.23.4,
  including real receipt-router authentication and multipart limits.
- `npm audit`: zero known vulnerabilities after the final clean install.
- Concurrent memory-budget test passes: peak heap 171.2 MB, peak RSS 307.6 MB
  with 54,479 catalog products.
- All workflows pass actionlint; `git diff --check` passes.

## Rollout and limits

Merge and redeploy to install the updated lockfile in production. These changes
have not been deployed. Local tests are not a comprehensive malware assessment;
GitHub CI and CodeQL results must also be checked on the PR.
