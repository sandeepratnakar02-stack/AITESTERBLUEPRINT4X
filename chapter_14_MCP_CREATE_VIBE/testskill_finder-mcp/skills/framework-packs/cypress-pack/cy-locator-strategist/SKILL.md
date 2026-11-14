---
name: cy-locator-strategist
description: >-
  Chooses and repairs element selectors for Cypress tests. Use when someone says "this
  selector is flaky", "cy.get keeps failing", "make the locators robust", "which selector
  should I use", or pastes a failing cy.get. Produces a preferred-selector decision, a
  test-id convention, and rewritten locators with the reason each was chosen.
license: MIT
metadata:
  author: TheTestingAcademy
  pack: cypress
  version: 1.0.0
---

# CY Locator Strategist

You make Cypress locators **stable and self-explanatory**, and you stop the cycle of
patched selectors by fixing the convention rather than the one failing line.

## When to use
- `cy.get(...)` fails, matches multiple elements, or breaks on every UI change.
- A team needs a rule for which selector to use where.
- A page is being automated and the elements have no test ids yet.

## Workflow
1. **Reproduce the intent** — what user-visible thing is being targeted? Name it in the
   spec's language ("the Save button in the billing form"), not by DOM path.
2. **Rank the options, best first:**

   | Rank | Selector | Why |
   |---|---|---|
   | 1 | `[data-cy=save-billing]` | Purpose-built, survives styling and copy changes |
   | 2 | `cy.findByRole('button', { name: /save/i })` | Accessibility-true, catches a11y regressions |
   | 3 | `cy.contains('Save')` | Readable, but breaks on copy changes |
   | 4 | CSS class / DOM path | Last resort; couples tests to styling |

3. **Apply the convention.** Test ids are stable, unique, and intention-revealing:
   `data-cy="<component>-<element>"`, kebab-case, no positional words (`div3`, `button2`).
4. **Disambiguate scope before hardening.** Prefer narrowing (`cy.get('[data-cy=row]').filter()`,
   `.within()`) over adding `:nth-child` or reaching into internals.
5. **Rewrite and explain.** Return the new locator plus one line on why it is more durable,
   and list any test id the app must add.

## Output shape
```
Broken:  cy.get('div:nth-child(3) > button.btn.btn-primary').click()

Fixed:   cy.get('[data-cy=invoice-save]').click()
Why:     Targets intent, not DOM order or styling. Survives markup and CSS refactors.

App change required: add data-cy="invoice-save" to the Save button in InvoiceForm.
Less preferred: cy.contains('Save') — breaks the day the copy changes to "Save invoice".
```

## Guardrails
- Never invent a test id silently — list it as a required app change.
- Do not assert on auto-generated classes (`css-1x2y3z`) or framework internals; they are
  not contracts.
- Avoid XPath and deep `>` chains; Cypress retries better against short, semantic selectors.
- A locator duplicated across many specs belongs in a custom command, not copy-paste.
- If the element genuinely has no stable handle, say so — the correct fix may be in the app.
