# START-22 Acceptance — Klavierhaus -> HIMATE Export Adapter

## Scope

START-22 adds a one-way, privacy-safe export adapter from Klavierhaus ERP to HIMATE Connector Protocol v1.

The adapter does not grant HIMATE direct SQLite access and does not replicate raw business tables. The accepted contract is limited to approved aggregate or business-metadata datasets for the 38 Klavierhaus functional modules.

## Architecture

- [x] Adapter code is isolated under `server/himate-connector/`.
- [x] The existing Node.js / Express ERP remains unchanged as the business system of record.
- [x] The connector contract is implementation-language independent.
- [x] A future Go Klavierhaus backend can reuse the same HIMATE Connector Protocol v1.
- [x] The connector is disabled by default.
- [x] Runtime credentials come from environment configuration only.
- [x] HIMATE connector secrets are never written to SQLite, Git, logs or frontend code.
- [x] Runtime status/manual sync APIs require authenticated Superadmin access.

## 38-module export contract

- [x] Exactly 38 module keys are present.
- [x] Every module has one stable dataset key.
- [x] Every dataset has an explicit field allowlist.
- [x] Every dataset has cadence, transfer mode, target service and schema version metadata.
- [x] Collector coverage is exactly 38/38.
- [x] Collectors fail closed on schema/query failures.
- [x] Collectors emit only approved scalar values.
- [x] Raw passwords, password hashes, sessions, tokens, OAuth/API secrets, Stripe/payment credentials, invitation/preview tokens and raw customer message bodies are not exported.
- [x] Customer/employee identity is aggregated unless explicitly represented by the approved company-profile business metadata contract.

## Protocol and integrity

- [x] Protocol version is `1.0`.
- [x] Source system is `KLAVIERHAUS`.
- [x] Dataset checksums use canonical JSON + SHA-512.
- [x] Batch requests use HMAC-SHA-512.
- [x] Each signed request has timestamp, nonce, body checksum and signature.
- [x] A fresh nonce is generated for every signed request.
- [x] Connector credential is bearer-authenticated but never serialized into request bodies.
- [x] Daily reconciliation uses order-independent aggregate SHA-512 checksums.

## Scheduler

- [x] Heartbeat runs every five minutes.
- [x] System datasets run every five minutes.
- [x] Operational datasets run hourly.
- [x] Full 38-module synchronization runs daily.
- [x] Full sync is followed by reconciliation.
- [x] Manual Superadmin sync supports module, cadence and full-sync triggers.
- [x] Concurrent scheduled/manual sync is guarded against duplicate execution.

## Production configuration

- [x] `HIMATE_CONNECTOR_ENABLED=false` by default.
- [x] `HIMATE_CONNECTOR_URL` is runtime configurable.
- [x] `HIMATE_CONNECTOR_TOKEN` is empty in the repository example and documented as a runtime-only secret.
- [x] `HIMATE_CONNECTOR_TIMEOUT_MS` is runtime configurable.
- [x] Production usage requires HTTPS at the HIMATE Gateway boundary.

## Automated evidence

- [x] Dedicated GitHub Actions job: `START-22 Connector Contract`.
- [x] Registry contract tests.
- [x] Privacy/denylist tests.
- [x] All-38 collector execution tests against the real Klavierhaus schema.
- [x] Canonical SHA-512 and HMAC deterministic contract tests.
- [x] Reconciliation checksum tests.
- [x] Signed-header / token non-serialization test.
- [x] Runtime wiring / Superadmin boundary test.
- [x] Production secret-configuration documentation test.

## Legacy CI baseline

The Klavierhaus `develop` branch was already red before START-22.

Baseline evidence:

- `develop` workflow run `35407716057`
- legacy `verify` job: 67 failures
- legacy `public-website-verify` job: missing website `check:assets` script

The START-22 branch does not modify the legacy website/CSS/public application files that produce those failures.

On the START-22 branch, the same legacy suite still reports the same 67 pre-existing failures, while the dedicated START-22 Connector Contract job passes. Those legacy failures are therefore outside START-22 scope and are not treated as Connector regressions.

## Release rule

The Klavierhaus side of START-22 is accepted when:

1. the dedicated `START-22 Connector Contract` job is green;
2. the branch remains 0 commits behind `develop`;
3. no new legacy failure is introduced compared with the documented pre-START-22 baseline;
4. the matching HIMATE START-22 signed connector/retention/Compose acceptance is green.
