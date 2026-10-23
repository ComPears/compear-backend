# Security maintenance: 23 October 2026

## Findings and fixes

- Node's bundled Brotli decoder is affected by CVE-2026-111497. Express request
  parsing and outbound fetch can reach it; updating npm packages alone is not a fix.
  Pin Node 22.23.4 in Docker, Render and `.nvmrc`; CI and the seed job use that file.
  `engine-strict` rejects older runtimes during installation.
- Incorporate the dependency changes proposed in Dependabot #21 and #22.
  Update the vulnerable transitive `ip-address` package; npm audit reports zero findings.
- The GitHub Actions versions proposed by #23 are already present on main.
  No additional action downgrade or duplicate change is needed.
- GitHub reported no open Dependabot or CodeQL alerts at review time. This is not
  evidence that deployed runtime images are patched, nor a comprehensive malware assessment.

## Verification

Clean npm install, full tests/build, npm audit and the concurrent memory-budget
test pass on Node 22.23.4. Peak heap: 198.5 MB; peak RSS: 333 MB. Runtime configuration
regression tests and an npm audit CI gate are included.

## Rollout still required

Merge and redeploy with a fresh image (`docker build --pull --no-cache ...`).
For the existing native Render service, set NODE_VERSION=22.23.4 in its dashboard
if it is not managed by this Blueprint, clear the build cache, and deploy.
Verify startup logs report Node v22.23.4 and readiness succeeds. Updating this
repository does not update an already-running process. Do not roll back to a
vulnerable runtime; roll back application code on the patched runtime instead.
GitHub-hosted Actions use a separate runner-owned Node for JavaScript actions;
setup-node does not patch that binary. Use current hosted runners.

Source: [Node October security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
