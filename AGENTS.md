<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules (GAID WIFI SERVICES)
- Business rules (packages, prices, phone/MAC/voucher formats) live only in `src/lib/wifi.ts` and are covered by `src/test/wifi-rules.test.ts`; why: one source of truth shared by portal, admin and server.
- All database access goes through server functions using the service-role client; tables have RLS on with no policies. Why: customers are anonymous and admin uses a signed token, not database accounts.
- Admin auth: a single `admin_account` row holds a PBKDF2 hash (created once on first visit to /admin; setup closes once the row exists); `requireAdmin` checks an HMAC-signed token (ADMIN_SESSION_SECRET) whose version must match `session_version`, and failed tries are logged in `admin_login_attempts` for lockout. Why: no default credentials, and changing the password revokes old sessions.
- M-Pesa (Daraja) lives in `src/lib/mpesa.server.ts` and falls back to mock mode when keys are missing; callbacks are verified with a per-transaction secret token in the callback URL. Why: Daraja callbacks are unsigned.
- Router control lives in `src/lib/mikrotik.server.ts` (simulated unless MIKROTIK_* env set); the `users` table is the allowed list. Why: works without hardware during testing.
- Expiry is enforced by a per-minute managed HTTP schedule hitting `/api/public/jobs/expire-users`, plus lazy sweeps on admin loads. Why: router bindings must be removed even when nobody opens the app.
- Prepaid logic lives in `src/lib/prepaid.server.ts`: customers sign in with an SMS code (shown on screen while `sms.server.ts` is in test mode) and get an HMAC-signed `cust` token; credit changes only through the `add_credit` / `spend_credit` SQL functions. Transaction `purpose`: `package` = pay and activate, `topup` = pay shortfall then buy from credit, `credit` = add to credit only. Why: atomic credit and one payment pipeline.
- STK callbacks from localhost / editor preview are sent to the published site (same database) unless `MPESA_CALLBACK_BASE_URL` is set. Why: Safaricom rejects non-public callback URLs.
