# Security review — 19 September 2026

## Findings and changes

GitHub reported five open high-severity CodeQL findings: four receipt-storage path-injection findings (#7–#10) and a polynomial-time authorization regex (#6).

- Receipt storage now rejects IDs outside the strict 8–64 character ASCII allowlist before filesystem access, and verifies path containment. Previously it stripped characters, potentially aliasing malformed IDs to a different ID. Valid IDs keep their existing filenames and history; no data migration is needed. The review does not claim a demonstrated remote traversal through the previous stripping logic.
- Credential inputs are bounded before trimming, parsing, HMAC work, or buffer allocation. Only the issued 64-character lowercase hex token format is accepted. Fixed-prefix Bearer parsing replaces the overlapping regex; custom headers, Bearer credentials, and body credentials remain supported.
- Regression tests cover malformed/oversized credentials, traversal and aliasing inputs, and existing receipt-file compatibility. The forged-token test now always changes a character instead of occasionally producing the original token.

## Verification and dependency triage

- Backend build and all 48 tests passed (34 TypeScript and 14 compiled-JavaScript tests).
- `npm audit --json --ignore-scripts`: zero known vulnerabilities, including development dependencies.
- GitHub: no open Dependabot vulnerability alerts or secret-scanning alerts at review time.
- Open Dependabot PRs #7 (OpenAI SDK) and #8 (development type packages) are version updates, not associated with current vulnerability alerts. They remain separate from these security fixes.
- Lockfile downloads use `registry.npmjs.org` and carry integrity hashes; only esbuild and optional fsevents declare install hooks.
- Source/workflow checks found no suspicious dynamic execution or shell download/execute patterns, or matches for the common private-key/token patterns checked.

This review is not an antivirus scan, penetration test, or proof of a malware-free deployment. It does not exhaustively inspect dependency contents, git history, hosts, or runtime secrets. CodeQL must rescan the PR and then main after merge before the default-branch findings can be considered closed. No production merge or deployment was performed.
