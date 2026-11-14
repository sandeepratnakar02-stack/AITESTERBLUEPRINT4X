---
name: api-contract-validator
description: >-
  Validates an API against its OpenAPI/JSON Schema contract and flags breaking changes. Use
  when a tester says "does the response match the spec", "validate the schema", "the provider
  changed a field", "detect breaking API changes", or pastes an OpenAPI document and a
  response. Produces a conformance report, spec violations, and consumer-breaking diffs.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: api-testing
  version: 1.0.0
---

# API Contract Validator

You check **the contract, not just the status code**. A 200 with the wrong shape is a failing
test; a spec that does not match the service is itself the defect.

## When to use
- A service publishes OpenAPI/Swagger or a JSON Schema and consumers rely on it.
- A provider released a change and you must decide if it breaks consumers.
- Responses are being asserted field-by-field instead of against a shared schema.

## Workflow
1. **Pin the contract version** — record the spec URL/file, version, and commit. Validating
   against "latest" makes failures unreproducible.
2. **Three-way check:**
   - **Spec vs service** — does the live response satisfy the documented schema, status codes,
     required fields, and content types?
   - **Spec vs spec** — compare the new revision to the pinned baseline.
   - **Service vs consumer expectations** — what the client actually reads.
3. **Classify every finding:**

   | Class | Examples | Effect |
   |---|---|---|
   | Breaking | field removed/renamed, type narrowed, required added, enum value removed, status code changed | Consumers break; needs a version bump |
   | Additive | new optional field, new enum value | Usually safe if consumers ignore unknowns |
   | Cosmetic | description, example, ordering | No runtime impact |

4. **Prove unknowns explicitly** — `additionalProperties` not set means the schema permits
   extra fields; say so rather than assuming strictness.
5. **Report with evidence** — the JSON pointer (`#/components/schemas/Order/properties/status`),
   the observed value, and the rule violated.
6. **Recommend the gate** — schema validation as a test, plus a CI check that diffs the spec
   on change so a breaking edit cannot ship silently.

## Output shape
```
Contract: openapi.yaml v2.3.1 (commit abc1234) — baseline v2.3.0

Conformance (live vs spec)
  PASS  POST /orders → 201, body satisfies #/components/schemas/Order
  FAIL  GET  /orders/{id} → 200, body.status = "PENDING"
        #/components/schemas/Order/properties/status enum = [open, closed] → value not permitted
  FAIL  GET  /orders/{id} → response missing required "createdAt"
  INFO  GET  /orders → schema has no additionalProperties; unknown fields are permitted

Breaking changes vs v2.3.0
  BREAKING  removed  #/components/schemas/Order/properties/legacyRef
  ADDITIVE  added    #/components/schemas/Order/properties/channel (optional)
  COSMETIC  changed  description on /orders

Recommendation: fail the build on the two FAIL rows; bump the API version for the removal,
or re-add legacyRef with a deprecation window.
```

## Guardrails
- Never treat HTTP 200 as conformance — assert the schema, required fields, and types.
- Do not soften a schema to make a live response pass; a mismatch is either a service bug or a
  spec bug, and you must say which.
- Only call a change breaking when consumer-visible; state the reasoning, not just the label.
- Do not validate against an unpinned/`latest` spec — results become non-reproducible.
- Assume nothing about strictness: an unset `additionalProperties` permits extra fields.
- If the spec is absent, that is the finding — do not reverse-engineer one and call it the contract.
