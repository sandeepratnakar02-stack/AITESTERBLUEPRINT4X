---
name: cy-parallel-runner
description: >-
  Splits a Cypress suite for parallel execution and configures CI sharding. Use when an SDET
  says "the Cypress suite takes 40 minutes", "run specs in parallel", "cypress-split", "Cypress
  Cloud parallelisation", "balance specs across CI machines", or asks how to shard by spec.
  Produces a balanced sharding strategy, config, and the CI matrix to run it.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: cypress
  version: 1.0.0
---

# CY Parallel Runner

You cut wall-clock time **without** introducing order-dependence — the usual price of naive
parallelisation.

## When to use
- The suite is too slow to gate a PR.
- CI machines are idle relative to a single long job.
- Flakiness appeared right after parallelising (a strong hint specs share state).

## Workflow
1. **Make specs independent first.** Parallelism only works if each spec creates its own
   state: `cy.session` for auth, API seeding per spec, unique data per run, no reliance on
   execution order. Fix this *before* sharding, or you will ship flake.
2. **Measure the imbalance.** Collect per-spec durations from a single run (or the JSON
   reporter). Splitting by file count alone leaves one machine with the heavy specs.
3. **Pick the approach:**

   | Approach | When | Notes |
   |---|---|---|
   | CI matrix + `--spec` groups | Small suite, cheap machines | Manual balance; drifts over time |
   | `cypress-split` (history file) | Free, self-hosted | Balances using recorded durations |
   | Cypress Cloud parallelisation | Paid, simplest | Native load-balancing + analytics |
   | `--group` + `--ci-build-id` | Any parallel run | Required so reports group correctly |

4. **Remove cross-spec coupling** — no shared `localStorage`, cookies, DB rows, or files.
   Allocate per-shard data (e.g. `runId` in the payload) so shards cannot collide.
5. **Group reports** with a shared build id/group so a shard's results are readable as one run.
6. **Verify** — total time, per-shard time spread, and a 5× repeat of the parallel run to
   prove the flake rate did not rise.

## Output shape
```typescript
// cypress.config.ts — shard-safe defaults
export default defineConfig({
  e2e: {
    baseUrl: process.env.BASE_URL ?? 'http://localhost:3000',
    retries: { runMode: 0, openMode: 0 }, // measure real flake while validating parallel runs
  },
});
```

```yaml
# .github/workflows/e2e-parallel.yml
jobs:
  e2e:
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      # cypress-split balances using recorded per-spec durations
      - run: npx cypress run
        env:
          SPLIT_INDEX: ${{ matrix.shard }}
          SPLIT_TOTAL: 4
          SPLIT_FILE: timing.json          # committed or restored from cache
          SPLIT_GROUP_TITLE: e2e-${{ matrix.shard }}
```

```
Before: 1 job × 42 min
After : 4 shards → 12 / 11 / 12 / 11 min (spread < 10%), 5 consecutive runs green
```

## Guardrails
- Do not parallelise a suite with shared state; you will trade time for flake.
- Always pass a `--ci-build-id`/group so results are not fragmented across dashboards.
- Never reuse fixed record ids across shards — generate unique data per run.
- Report measured shard spread; an unbalanced split delivers far less than the theoretical gain.
- Keep `retries` at 0 while validating the parallel setup, then re-enable deliberately.
