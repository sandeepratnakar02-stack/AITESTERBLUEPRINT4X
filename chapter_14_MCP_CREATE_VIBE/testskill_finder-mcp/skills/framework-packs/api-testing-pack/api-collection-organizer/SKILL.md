---
name: api-collection-organizer
description: >-
  Organises API tests into a maintainable collection (Postman/Bruno/Insomnia) with
  environments, variables, folders, and ordering. Use when a tester says "organise my Postman
  collection", "share these API tests with the team", "set up environments", "make this
  runnable in CI", or pastes a messy collection. Produces a folder structure, variable plan,
  and a Newman/CLI run path.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: api-testing
  version: 1.0.0
---

# API Collection Organizer

You turn a heap of saved requests into a **reviewable, version-controlled, CI-runnable
collection** — with variables instead of hard-coded hosts and tokens.

## When to use
- Requests work on one engineer's machine because the token is pasted in the URL.
- A collection has no environments, so it cannot be pointed at staging vs local.
- API tests exist but are not run in CI.

## Workflow
1. **Separate the layers:**
   - **Collection** — requests and assertions (logic, committed).
   - **Environment** — base URLs, ids, secrets (per stage; secrets never committed).
   - **Data** — request bodies and fixtures, preferably loaded from files for large payloads.
2. **Structure by resource then behaviour**, not by chronology:
   ```
   Auth/            login, refresh, logout
   Orders/          create, read, list, update, cancel
   Orders/Errors/   400s and 403s (kept beside the happy path)
   Admin/           admin-only endpoints
   ```
3. **Introduce variables** — `{{baseUrl}}`, `{{token}}`, `{{orderId}}`. Chain by setting
   variables from responses (test script: `pm.collectionVariables.set('orderId', ...)`).
4. **Add assertions to every request** — status, schema-ish field checks, and one negative case
   per endpoint. A request with no assertion is a manual step, not a test.
5. **Manage secrets properly** — collection variables for non-secrets; environment/CI secrets
   for tokens; mark secret variables as such so they are masked in exports and logs.
6. **Make it CI-ready** — export and run with Newman (or Bruno's CLI):
   `newman run collection.json -e ci.json --reporters cli,junit --bail`.
7. **Review the diff** — collections are JSON and belong in git; a PR should show which
   requests/assertions changed.

## Output shape
```
Collection: vwo-api.postman_collection.json        (committed)
Environments: local.json, staging.json              (committed, non-secret values only)
              ci.json                               (generated in CI from secrets)

Variables
  {{baseUrl}}        env  http://localhost:3000 | https://api.staging.example.com
  {{token}}          env  SECRET  (masked; injected by CI, never committed)
  {{orderId}}        collection  set by Orders/Create test script
  {{tenantId}}       env  test tenant provided by the platform team

Folders
  Auth/ | Orders/ | Orders/Errors/ | Admin/

CI
  newman run vwo-api.postman_collection.json -e ci.json \
    --reporters cli,junit --reporter-junit-export reports/api.xml --bail
```

```javascript
// Orders/Create → Tests tab
pm.test('201 and returns an id', () => {
  pm.response.to.have.status(201);
  const body = pm.response.json();
  pm.expect(body.id).to.be.a('string');
  pm.collectionVariables.set('orderId', body.id);   // chain the next request
});
```

## Guardrails
- Never commit real tokens or production credentials in a collection or environment file —
  use environment secrets and verify the export masks them.
- Do not organise by creation order; group by resource so a reviewer finds things predictably.
- A request without assertions is documentation, not a test — say so rather than counting it as coverage.
- Prefer `--bail` (or explicit ordering) in CI only when the collection is genuinely sequential;
  otherwise keep requests independent.
- Live collections that call production must be read-only or use disposable test data.
- Keep large bodies in files; a 2 MB inline payload makes the collection unreviewable.
