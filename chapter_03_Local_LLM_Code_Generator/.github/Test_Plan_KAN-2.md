# Test Plan — KAN-2: [VWO] Add Passkey and SSO Login Options to VWO Login Page

> Status: **APPROVED** by QA owner on 2026-08-15. Test cases may now be written.
> Generated from Jira ticket **KAN-2** (AIBlueprint · Story · Status: To Do) via `.github/SKILL.md` (test-plan-generator).

## 1. Scope & Objectives

- **In scope:**
  - The two new login options on the VWO login page: **“Sign in using SSO”** and **“Sign in with Passkey”**.
  - Happy-path authentication flows for both new methods (including browser/OS authenticator prompts and IdP redirect/return).
  - Negative/error handling for both methods (cancelled prompt, failed auth, unconfigured account).
  - Regression safety of the **existing email/password** login path that remains alongside the new options.
  - Security-sensitive behavior: no auth bypass, session creation rules, login-method audit attribution.
- **Out of scope:**
  - Account registration / passkey enrolment screens (not mentioned in the ticket — treated as a gap, G-1/G-6).
  - IdP administration or enterprise SSO directory configuration (needs a named IdP, G-4).
  - Non-VWO login surfaces (unless ticket links them — none present).
- **Objective:** Define “tested” for this ticket as: both new options are present, usable, secure and regression-safe on the supported environment matrix, with all ambiguous/missing requirements surfaced to the author for sign-off.

## 2. Gaps & Questions for the author

| # | Area | Finding (⚠️/❌) | Question to author |
|---|------|----------------|--------------------|
| G-1 | Acceptance criteria | ❌ No acceptance criteria field or checklist exists on KAN-2 | Can you add the ACs (or confirm the ones below)? Testability depends on observable pass/fail criteria. |
| G-2 | Priority | ⚠️ Field says **Medium**, description body says **High** | Which is authoritative? Affects P0/P1 tagging and release blocking. |
| G-3 | Environment matrix | ⚠️ “across supported environments” is undefined | Which browsers (Chrome/Edge/Firefox/Safari), OSes, and mobile vs desktop must passkey + SSO support? |
| G-4 | SSO provider | ❌ IdP not named | Which SSO protocol (SAML/OIDC) and which test IdP (Okta, Azure AD, Google…) should we point to? Is there a staging IdP? |
| G-5 | Passkey authenticators | ❌ Not specified | Which authenticator types are in scope: platform (Windows Hello / Touch ID / Face ID) vs roaming (security key, cross-device)? |
| G-6 | Account linking | ❌ Unspecified | When an SSO/passkey identity matches an existing email/password VWO account, how is it linked? Is auto-provisioning allowed? |
| G-7 | Negative / error paths | ❌ None described | What should happen on: cancelled passkey prompt, failed IdP auth, invalid/expired passkey, revoked SSO access? |
| G-8 | Boundary / empty states | ❌ None described | What does a user with no registered passkey see? An account with SSO not configured? A disabled passkey? |
| G-9 | Security requirements | ❌ Not stated | Any auth-bypass constraints, CSRF protection on the SSO redirect, session lifetime rules, or phishing-resistance expectations for passkey? |
| G-10 | Feature flag / rollback | ❌ Not stated | Is this behind a feature flag? What is the rollback / flag-off behavior (options hidden, old flow intact)? |
| G-11 | Regression surface | ⚠️ “alongside existing authentication methods” | Confirm existing email/password login must be 100% unchanged — and whether captcha/MFA flows are affected. |
| G-12 | Non-functional | ❌ Perf / a11y / i18n / audit undefined | Expected login-page load budget? Keyboard & screen-reader support for new options? Localized labels? Audit log of login method? |
| G-13 | Test data & environments | ❌ None provided | Provide test accounts (with/without passkey, SSO-configured, admin), a passkey, and the target env (staging/UAT). |
| G-14 | Design / mockups | ❌ No designs linked | Share the login-page mock/figma so placement, labels, and copy can be verified exactly. |
| G-15 | Ambiguous wording | ⚠️ “function seamlessly”, “supported environments” | Define “seamless” operationally (e.g., return to VWO in <N s, no extra re-login) and enumerate “supported environments”. |

## 3. Test Scenarios

> Traceability legend: **D-1** = passkey option added · **D-2** = SSO option added · **D-3** = seamless/UX across supported environments · **D-4** = alongside existing auth · **G-#** = gap from section 2.

| ID | Priority | Type (pos/neg/boundary) | Scenario | Maps to (AC / gap) |
|----|----------|-------------------------|----------|--------------------|
| TS-1 | P0 | positive | “Sign in with Passkey” button is displayed on the VWO login page alongside existing email/password fields. | D-1, G-14 |
| TS-2 | P0 | positive | “Sign in using SSO” button is displayed on the VWO login page alongside existing methods. | D-2, G-14 |
| TS-3 | P0 | positive | User with a registered passkey completes login via platform authenticator (Windows Hello / Touch ID / Face ID) and lands on the VWO dashboard. | D-1, D-3, G-5 |
| TS-4 | P0 | positive | User clicks “Sign in using SSO”, is redirected to the IdP, authenticates, and returns to VWO logged in without re-entering credentials. | D-2, D-3, G-4 |
| TS-5 | P0 | negative | User cancels/closes the passkey prompt — no session is created; user returns to the login page with a clear message and can retry. | D-1, G-7 |
| TS-6 | P0 | negative | IdP authentication fails (wrong/invalid credentials, cancelled at IdP) — VWO shows a graceful error and does **not** create a session. | D-2, G-7 |
| TS-7 | P0 | negative | User with **no registered passkey** attempts passkey login — clear “no passkey found / enrol first” message, other login methods remain available. | G-8, G-5 |
| TS-8 | P0 | negative | Account has **SSO not configured/disabled** — clear message and fallback to email/password or passkey. | G-8, G-4 |
| TS-9 | P0 | security | No auth bypass: after failed/cancelled passkey or SSO, unauthenticated user **cannot** reach the VWO dashboard/app. | G-9 |
| TS-10 | P0 | regression | Existing email/password login still works unchanged with new buttons present (no broken layout, no disabled form). | D-4, G-11 |
| TS-11 | P1 | positive | Passkey login via a **roaming authenticator** (USB security key / cross-device phone passkey). | G-5 |
| TS-12 | P1 | boundary | User has **multiple passkeys** — correct passkey/account is used; switching accounts works without silent failure. | G-8, G-5 |
| TS-13 | P1 | positive | SSO user whose email matches an existing VWO account is correctly **linked** (no orphan account, no duplicate). | G-6 |
| TS-14 | P1 | positive | First-time SSO user is **auto-provisioned** per the documented rule (confirm rule with author). | G-6 |
| TS-15 | P1 | security | Session after passkey/SSO login expires at the configured idle/absolute timeout and re-login is required. | G-9 |
| TS-16 | P1 | security | Audit/observability: login method (email/password vs passkey vs SSO) is captured in audit logs for the session. | G-12 |
| TS-17 | P1 | negative | Feature-flag **off** → both new options hidden, old login flow fully intact (rollback/flag behavior). | G-10 |
| TS-18 | P1 | boundary | Login page renders correctly across the supported matrix (desktop + mobile widths, declared browsers) with no overlap/overflow. | G-3, G-14 |
| TS-19 | P2 | negative | Browser/OS with **no WebAuthn support** (or passkey unsupported) — graceful degradation with an informative message for the passkey option. | G-3, G-5 |
| TS-20 | P2 | boundary | Network failure/timeout during passkey or SSO flow — clean timeout, retry option, no stuck spinner. | G-7, G-3 |
| TS-21 | P2 | boundary | **Concurrent** login attempts in two tabs using passkey/SSO — no session corruption or double-session conflict. | G-7, G-9 |
| TS-22 | P2 | a11y | New options are keyboard-navigable with logical focus order and accessible names for screen readers. | G-12 |
| TS-23 | P2 | i18n | Button labels (“Sign in using SSO”, “Sign in with Passkey”) render localized text where supported; no truncation. | G-12 |
| TS-24 | P2 | perf | Login page with the new options renders within the agreed load budget (no measurable regression vs current). | G-12 |

## 4. Test Data & Environment

- **Data (required — none supplied in ticket, see G-13):**
  - VWO user with **registered passkey** (platform authenticator).
  - VWO user with **roaming authenticator** (security key) if in scope (G-5).
  - VWO user with **no passkey** (empty/boundary).
  - VWO account with **SSO configured**; account with **SSO not configured/disabled**.
  - Email/password account for regression (TS-10).
  - SSO test IdP user (per G-4: Okta / Azure AD / Google — TBD by author).
  - Matching-email pair (SSO email == existing VWO account) for linking tests (TS-13/TS-14).
- **Environment / flags:**
  - Target: staging/UAT (confirm — G-13); feature flag for passkey/SSO options (G-10).
  - Browser/OS matrix TBD (G-3): Chrome/Edge/Firefox/Safari × Windows/macOS (+ mobile if in scope).
- **Roles / permissions:**
  - Regular user (login only); admin (if audit-log review or IdP config is exercised). No role-specific AC present — flagged G-9/G-12.

## 5. Risks & Assumptions

- **Assumptions made:**
  - Passkey flow is **WebAuthn**-based; SSO is standard redirect-based (SAML/OIDC) — author to confirm (G-4/G-5).
  - “Alongside existing methods” means email/password remains fully functional and unchanged (G-11).
  - A login method is not considered “seamless” unless the user returns authenticated without duplicate credential entry (G-15).
- **Risks:**
  - **No acceptance criteria** — the plan is derived from the description and gap analysis; scope could drift (G-1).
  - **Priority ambiguity** (Medium vs High) may mis-tag P0/P1 and block release decisions (G-2).
  - Unspecified IdP/authenticator matrix could make TS-4/TS-3 untestable until G-4/G-5 are answered.
  - Account-linking rules (G-6) unstated → risk of duplicate accounts or SSO lockout in production if implemented wrongly.

## 6. Entry / Exit criteria

- **Entry:**
  - Feature deployed to the target environment behind its flag (G-10).
  - Test accounts + passkey + SSO test IdP provisioned (G-13, G-4).
  - Design/mock approved and login-page copy confirmed (G-14).
  - Author has answered the **blocking** gaps (G-1, G-2, G-4, G-5, G-6) or explicitly deferred them in writing.
- **Exit:**
  - All **P0** scenarios pass; P1/P2 triaged with documented disposition.
  - No open P0 defects; P1 defects either fixed or formally waived by the QA owner.
  - Regression set (TS-10) green on the supported matrix.
  - Security scenarios (TS-9, TS-15, TS-16) reviewed by the security-conscious reviewer.
  - Human Review Gate below has been approved by the QA owner.

---
## HUMAN REVIEW GATE
- **I assumed:** WebAuthn for passkey; redirect-based SSO (SAML/OIDC); email/password login is untouched regression scope; “seamless” = authenticated return without duplicate credential entry.
- **I could not confirm:** Acceptance criteria (G-1), authoritative priority (G-2), supported environment matrix (G-3), SSO IdP (G-4), passkey authenticator scope (G-5), account-linking rules (G-6), feature-flag/rollback design (G-10), test data & environment (G-13), design mockups (G-14).
- **Open questions blocking sign-off:** G-1, G-2, G-4, G-5, G-6, G-10, G-13 — see section 2.
- ▶ **Approve, or edit, before I write test cases / automation.**

---
## ✅ Approval record
- **Decision:** **Approved** as drafted.
- **Approved by:** QA owner (human) · **Date:** 2026-08-15.
- **Consequence:** Test cases may now be written — see `TestCases_KAN-2.md`.
- **Note:** Gaps G-1…G-15 remain **open** (author has not yet answered them). Test cases are derived from this approved plan and each open question is flagged where its answer could change an expected result.
