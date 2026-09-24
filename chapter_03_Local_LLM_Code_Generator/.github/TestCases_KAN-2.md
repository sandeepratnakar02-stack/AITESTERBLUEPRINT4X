# Test Cases — KAN-2: [VWO] Add Passkey and SSO Login Options to VWO Login Page

> Derived from the **approved** `Test_Plan_KAN-2.md` (scenarios TS-1…TS-24) and the `templates/TestGen.md` template.
> **Status:** DRAFT — pending review by QA owner.
> **Traceability:** Each case links to its plan scenario (TS-#). Open gaps G-1…G-15 are flagged inline where an answer could change the expected result.
> **Conventions:** Steps assume WebAuthn for passkey and redirect-based SSO (SAML/OIDC) — pending confirmation (G-4/G-5).

## P0 — Core functionality & security

| Test ID | Description | Pre-conditions | Steps | Expected Result | Priority |
|---------|-------------|----------------|-------|-----------------|----------|
| TC-01 | “Sign in with Passkey” option is visible on the VWO login page | Valid browser (Chrome/Edge), login page loaded, feature flag ON (G-10) | 1. Navigate to VWO login page<br>2. Observe authentication options | Passkey button displayed alongside email/password; label matches approved copy (G-14); no layout break | P0 |
| TC-02 | “Sign in using SSO” option is visible on the VWO login page | Valid browser, login page loaded, flag ON | 1. Navigate to VWO login page<br>2. Observe authentication options | SSO button displayed alongside existing methods; label matches copy (G-14) | P0 |
| TC-03 | Passkey login (happy path) via platform authenticator | User has a registered passkey (Windows Hello / Touch ID / Face ID); flag ON (G-5) | 1. Click “Sign in with Passkey”<br>2. Complete platform authenticator prompt (biometric/PIN)<br>3. Observe redirect/landing | User is authenticated and lands on the VWO dashboard; no duplicate credential entry; session created | P0 |
| TC-04 | SSO login (happy path) | SSO configured for the account; test IdP available (G-4) | 1. Click “Sign in using SSO”<br>2. Get redirected to IdP<br>3. Authenticate at IdP<br>4. Observe return redirect to VWO | User returns to VWO logged in without re-entering credentials; session created | P0 |
| TC-05 | Cancel the passkey prompt — no session created | User with a registered passkey; login page loaded | 1. Click “Sign in with Passkey”<br>2. Cancel/dismiss the authenticator prompt | No session created; user returns to login page; clear message shown; retry allowed; TS-5 | P0 |
| TC-06 | SSO authentication failure — no session created | SSO configured; IdP reachable | 1. Click “Sign in using SSO”<br>2. Enter invalid credentials / cancel at IdP | VWO shows a graceful error; **no** session created; user can retry or use another method; TS-6 | P0 |
| TC-07 | User with no registered passkey attempts passkey login | User has **no** passkey registered; flag ON | 1. Click “Sign in with Passkey”<br>2. Observe result | Clear “no passkey found / enrol first” message; other login methods remain available; no crash | P0 |
| TC-08 | Account with SSO not configured/disabled | Account without SSO config (G-4) | 1. Click “Sign in using SSO”<br>2. Observe result | Clear “SSO not configured/disabled” message; fallback to email/password or passkey still works | P0 |
| TC-09 | No auth bypass after failed/cancelled auth | Unauthenticated browser session | 1. Attempt passkey and cancel (TC-05)<br>2. Attempt SSO and fail (TC-06)<br>3. Try to reach VWO dashboard directly (e.g., deep-link URL) | Unauthenticated user **cannot** access the dashboard/app in any state; guard remains enforced | P0 |
| TC-10 | Email/password login regression | Existing user with valid email/password; flag ON | 1. Enter valid email + password<br>2. Submit<br>3. Verify dashboard access | Email/password login works unchanged with new buttons present; no broken layout/disabled form | P0 |

## P1 — Extended flows, linking, security & matrix

| Test ID | Description | Pre-conditions | Steps | Expected Result | Priority |
|---------|-------------|----------------|-------|-----------------|----------|
| TC-11 | Passkey login via roaming authenticator | User has a roaming authenticator (USB security key / cross-device phone passkey) (G-5) | 1. Click “Sign in with Passkey”<br>2. Complete roaming authenticator flow | User authenticates successfully via the roaming authenticator; session created | P1 |
| TC-12 | Multiple passkeys — correct account selection | User has 2+ passkeys on the account | 1. Click “Sign in with Passkey”<br>2. Select among presented passkeys/accounts | Correct passkey/account is used; switching works; no silent failure or wrong-account login | P1 |
| TC-13 | SSO account linking (matching email) | SSO identity email matches an existing VWO email/password account (G-6) | 1. Log in via SSO<br>2. Observe account state | Identities are correctly linked — no orphan account, no duplicate; existing data preserved | P1 |
| TC-14 | Auto-provision a new SSO user | SSO identity email has **no** existing VWO account (G-6) | 1. Log in via SSO for the first time | New account provisioned per the documented rule (confirm rule with author); user lands in the app | P1 |
| TC-15 | Session expiry after passkey/SSO login | Authenticated via passkey or SSO; configured session timeout | 1. Authenticate (passkey or SSO)<br>2. Wait until idle/absolute timeout<br>3. Attempt an action | Session expires at the configured timeout; re-login required; no silent session extension | P1 |
| TC-16 | Login method captured in audit logs | Admin access to audit log (G-12) | 1. Log in via email/password, then passkey, then SSO<br>2. Review audit log entries | Audit log records the correct login method for each session (email/password vs passkey vs SSO) | P1 |
| TC-17 | Feature-flag OFF — old flow intact (rollback) | Flag toggled OFF (G-10) | 1. Load login page with flag OFF<br>2. Verify options hidden<br>3. Log in with email/password | Both new options hidden; email/password login fully functional; no references to passkey/SSO on page | P1 |
| TC-18 | Rendering across supported matrix | Declared browser/OS matrix (G-3): Chrome/Edge/Firefox/Safari × desktop/mobile widths | 1. Load login page on each matrix combination<br>2. Verify layout of both new options | Buttons render without overlap/overflow; accessible and usable on all declared combinations | P1 |

## P2 — Edge cases, degradation, a11y, i18n, perf

| Test ID | Description | Pre-conditions | Steps | Expected Result | Priority |
|---------|-------------|----------------|-------|-----------------|----------|
| TC-19 | No WebAuthn / passkey-unsupported browser | Browser without WebAuthn or passkey support (G-3) | 1. Load login page<br>2. Inspect passkey option | Graceful degradation — passkey option shows an informative message or is disabled; no error/crash; SSO & password still work | P2 |
| TC-20 | Network failure / timeout during passkey or SSO | Network throttled/unavailable mid-flow | 1. Start passkey or SSO flow<br>2. Force network failure/timeout | Clean timeout with a retry option; no stuck spinner or frozen UI; session not created | P2 |
| TC-21 | Concurrent login attempts (two tabs) | Same user, two browser tabs | 1. Initiate passkey in tab A<br>2. Initiate SSO in tab B<br>3. Complete both | No session corruption or double-session conflict; only the expected session(s) exist; consistent state | P2 |
| TC-22 | Accessibility of new options | Screen reader (e.g., NVDA/VoiceOver); keyboard only | 1. Tab through the login page<br>2. Activate passkey/SSO via keyboard<br>3. Check focus order & accessible names | Both options are keyboard-navigable, logical focus order, meaningful accessible names (G-12) | P2 |
| TC-23 | Localized labels for new options | Locale with translations configured (G-12) | 1. Switch app locale<br>2. Observe “Sign in using SSO” / “Sign in with Passkey” | Labels render translated text where supported; no truncation or hard-coded English fallback issues | P2 |
| TC-24 | Login page load performance with new options | Performance tooling (e.g., Lighthouse/WebPageTest) | 1. Measure login page load with new options<br>2. Compare against baseline (pre-change) | Load time within the agreed budget; no measurable regression from the new options (G-12) | P2 |

---
## Notes for automation
- **Mapped scenarios:** TC-01↔TS-1, TC-02↔TS-2, TC-03↔TS-3, TC-04↔TS-4, TC-05↔TS-5, TC-06↔TS-6, TC-07↔TS-7, TC-08↔TS-8, TC-09↔TS-9, TC-10↔TS-10, TC-11↔TS-11, TC-12↔TS-12, TC-13↔TS-13, TC-14↔TS-14, TC-15↔TS-15, TC-16↔TS-16, TC-17↔TS-17, TC-18↔TS-18, TC-19↔TS-19, TC-20↔TS-20, TC-21↔TS-21, TC-22↔TS-22, TC-23↔TS-23, TC-24↔TS-24.
- **Blocking clarifications before automation:** G-4 (SSO IdP), G-5 (passkey authenticator scope), G-6 (account linking), G-3 (matrix), G-13 (test data) — answers may alter steps/expected results for TC-03/04/11/12/13/14/18.
- **Automation candidates (highest ROI):** TC-01/02 (UI presence), TC-03/04 (happy paths), TC-10 (regression), TC-17 (flag off), TC-18 (matrix screenshot tests).
