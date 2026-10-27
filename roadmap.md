# Roadmap

- [x] Customer portal (packages, M-Pesa STK push / test mode, voucher, online countdown)
- [x] Admin dashboard (/admin): stats, users, add by MAC, vouchers, M-Pesa list, block/unblock
- [x] Backend: MAC allowed list, router control (simulated / MikroTik), every-minute expiry, Daraja code
- [x] Setup guide (/setup)
- [x] Rename brand from BRADY WIFI to GAID WIFI SERVICES everywhere
- [x] End-to-end test (test-mode payment, admin, vouchers)
- [x] Secure admin login: one-time setup code, strong password, lockout, change password
- [x] M-Pesa Daraja sandbox (test) mode with user's sandbox keys; published
- [ ] Later: Live mode for Till 5813215 (waiting on user: live keys, store number, live passkey)
- [ ] Admin payment status panel: each STK push pending/successful/failed + when internet turned on
- [ ] AMAZONS-style portal redesign: customer sign-in, greeting, prepaid credit + net points box, free WiFi banner, active subscriptions with timer, voucher box, offers filter (1 / 2+ devices), BUY from credit
- [ ] Prepaid credit backend: prepaid_accounts + active_subscriptions tables, M-Pesa payment adds credit (no auto-activate), buy deducts credit, add-credit and buy-package endpoints
