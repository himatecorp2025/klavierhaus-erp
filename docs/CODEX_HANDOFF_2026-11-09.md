# Klavierhaus continuation in Codex — 2026-11-09

This records the initial intake session. For the subsequent release workflow, see the local CI section of the repository README and `scripts/run-local-ci.ps1`; later verification must use the final committed head, not the historical SHA below.

## Sources and current checkout

- Prior ChatGPT conversation: `6af19fa0-14b4-83eb-a3bf-455c75fe56a2`, titled **Klavierhaus rendszer áttekintése**. Read through the connected chat tool; the shared URL could not be fetched directly.
- Shared reference: https://chatgpt.com/share/e/6af1b6ab-4a48-83eb-b10c-21ffac1578c3
- Repository: https://github.com/himatecorp2025/klavierhaus-erp
- Open PR: https://github.com/himatecorp2025/klavierhaus-erp/pull/102
- Branch: `feature/showroom-pricing-order-node24-20261109`
- Downloaded head: `a4c6a3d1503db358d74c60c0986273a556fd9be7`
- Local checkout is currently a separate directory inside the FLUP workspace; it is an independent Git repository.

## Requirements recovered from the prior conversation

- Per-instrument USD prices and optional percentage/final-price discounts in ERP Website CMS, with discreet bilingual website presentation.
- Editable brand order and individual instrument order, preserving existing identifiers and URLs.
- Node.js 24 and compatible SQLite dependency across ERP and Website.
- Retire the unwired HIMATE connector and superseded workflow/business implementations after checking dependencies.
- Preserve Google Calendar behavior, Superadmin activation controls, active workshop/finance functions and existing business data.
- Test locally; do not provision paid testing services.
- The prior conversation requested merge to `develop` and Render deployment after verification. Render auto-deploy from `develop` was reported there; recheck live configuration before release.

These are recovered decisions, not proof that every acceptance criterion has been independently reviewed against the code.

## Verification performed on this Windows machine

Runtime: Node.js `v24.22.2`, npm `11.19.1`.

- Locked ERP and Website dependency installs succeeded.
- `npm test` in repository root: **272 passed, 0 failed, 0 skipped**.
- `npm run check:manifests`: passed.
- `npm run check:assets`: passed, 5 files.
- `npm run check:assets:http`: passed, 8 routes and 8 assets.
- `npm run check:migration`: passed.
- `npm run check` in repository root: schema and syntax checks passed.
- `npm run check` in `website`: passed.
- Initial `npm test` in `website`: **18 passed, 0 failed, 2 skipped** because the test searched only Mac/Linux Chrome locations.
- Updated `website/test/gallery-fit-pan.test.js` to find Windows Chrome and support `CHROME_PATH`, retaining Mac/Linux discovery.
- `node --test test/gallery-fit-pan.test.js` after the update: **2 passed, 0 failed, 0 skipped**, at desktop and mobile viewport sizes in local headless Chrome.

The complete ERP test run printed SQLite `e.slug_en` errors in some test fixtures while still passing. This session has not established whether those logs reveal a production issue. Do not describe the run as log-free.

This session did not perform npm advisory audits, five repeated ERP runs required by the default Mac gate, a complete visual pricing review, or production backup/deployment checks. Local passing tests do not establish that the full release gate is complete.

## Release state and next work

At inspection, PR #102 was open and unmerged. The commit-status API returned no statuses for the downloaded head. The prior conversation and PR description report a required `mac-ci/local` status blocking merge; this session did not independently fetch the current branch-protection configuration.

The local tests above have **not** published a GitHub status. Do not label Windows checks as a completed Mac gate or bypass branch protection. Determine the legitimate local CI publication procedure and platform requirements, complete remaining release checks, then verify the actual head SHA before publishing evidence or merging.

At the end of the initial intake session, the Windows browser-discovery change and this handoff were local and uncommitted. That session made no GitHub write, merge or Render deployment, and created no paid test environment.
