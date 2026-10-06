# MY CAR Test Bot

## Architecture selected from the repository

The bot is intentionally layered instead of replacing the existing tests:

1. Playwright acts as a real browser for public flows, role entry points, malformed form data, duplicate clicks, and HTTP safety boundaries.
2. The existing PGlite/PostgreSQL suites remain authoritative for RLS, ownership, role separation, checkout idempotency, stock consistency, Admin permissions, and write validation.
3. `scripts/test-bot.mjs` runs both layers and writes a plain Markdown report plus machine-readable JSON.
4. GitHub Actions runs both the local mock-safe suite and the authenticated staging gate on every pull request and every non-main push. The workflow has read-only repository permissions; the staging job receives only dedicated Test Bot secrets and is pinned to the approved staging origins.

This design avoids browser-only security claims and avoids weakening RLS or adding a service-role shortcut just to make tests convenient.

## Local run

Install dependencies and the Chromium test browser once:

```text
npm ci
npx playwright install chromium
```

If the Playwright browser CDN is unavailable but Chrome or Edge is already installed, set `TEST_BOT_BROWSER_CHANNEL=chrome` or `TEST_BOT_BROWSER_CHANNEL=msedge` for the run.

Run the permanent bot:

```text
npm run test:bot
```

The readable results are `reports/test-bot/report-local.md` and `reports/test-bot/report-staging.md`; matching JSON files are generated beside them. All reports are ignored build artifacts.

## Staging-safe opt-in

Staging is never selected by default. `npm run test:bot:staging` refuses to run unless all of these are true:

- `TEST_BOT_TARGET=staging`
- `TEST_BOT_STAGING_ACK=STAGING_ONLY`
- `TEST_BOT_BASE_URL` is HTTPS and its hostname does not look like Production
- `TEST_BOT_ALLOWED_HOST` exactly matches that staging hostname
- `TEST_BOT_SUPABASE_URL` exactly matches `https://hhkwntnbycpbypsaqvrc.supabase.co`; Production ref `peztuerebqkfrqlmxfdm` is hard-denied
- dedicated owner, seller, service, and rescuer fixture credentials are supplied through environment variables

Credential names are `TEST_BOT_<ROLE>_MOBILE` and `TEST_BOT_<ROLE>_PASSWORD`, where role is `OWNER`, `SELLER`, `SERVICE`, or `RESCUER`. Never commit their values. Staging journeys authenticate, open Profile, and verify Seller/Admin route boundaries; they do not create orders, charge money, or mutate Finance.

The four persistent identities can be bootstrapped with the staging anon configuration only by setting `TEST_BOT_SOURCE_ENV` to a local ignored env file and running `node scripts/bootstrap-test-bot-staging.mjs`. The command writes `.env.test-bot.local`, which is ignored, and never prints credentials. It refuses every Supabase project except the hard-coded staging ref.

The approved staging application is public at `https://dulcet-starlight-33ce57.netlify.app`. Before sending fixture credentials, the browser suite probes and aborts the first Auth request, verifies that the deployed application targets the exact staging Supabase hostname, and only then performs real staging logins. Unknown hosts, localhost, the Production app/project, missing credentials, and missing acknowledgement fail closed.

The authenticated CI job expects repository secrets named `TEST_BOT_SUPABASE_ANON_KEY`, `TEST_BOT_<ROLE>_MOBILE`, and `TEST_BOT_<ROLE>_PASSWORD` for `OWNER`, `SELLER`, `SERVICE`, and `RESCUER`. Secret values are never stored in the workflow or repository. Until those secrets are installed in GitHub, the job intentionally fails closed.

## Scenario map

- Store Manager: seller identity, Seller route boundary, offer/order/stock authorization and Admin separation.
- Rescue: rescuer Profile rules, service discovery boundaries, location-share ownership, invalid coordinates/TTL, expiry and revocation.
- Technical/Mechanic: service-role registration/Profile and rejection at Seller/Admin boundaries.
- Profile: malformed values, required fields by role, completeness, and browser entry.
- Sensitive Store paths: malformed writes, cross-origin and content-type rejection, duplicate offers, checkout idempotency, stock locking, buyer/seller isolation, IDOR and permission checks.
- Abuse behavior: invalid input and duplicate registration clicks in a real browser; concurrency/idempotency in the database suite.

## Honest limits

The integration baseline does not contain a Rescue dispatch/ticket lifecycle or a Mechanic job lifecycle. The bot tests only the existing rescuer/service Profile, discovery, location handoff, and security contracts. Those absent product flows remain reported as coverage limits, not false PASS results. Real payment, Finance, Production, SMS/OTP, and deployment are out of scope.
