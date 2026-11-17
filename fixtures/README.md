# Fixtures

Deterministic input for the checks. **Named as fixtures because that is what they are** — §1.3
forbids seed data, and that rule is about fabricating a *project's* figures for a user. A test needs
input it can assert against, and inventing one openly for a test is not the same thing.

**Not all of these are invented, and the difference matters.** This file used to call them all
synthetic, which was wrong in a way somebody could act on: reading it and concluding the directory
was safe to publish would have exposed a client's scheme.

| File | |
|---|---|
| `brief.txt` | **Real.** Monaghan Farm / Clever Development Trust — Erf 180, 1 046 units, the figures the live run asserts against |
| `costplan.txt` | **Real.** The same scheme's elemental estimate |
| `title-deed.pdf` | **Real.** The same scheme |
| `layouts.txt` | Invented, but **written to agree with `brief.txt`** — same scheme, same unit count, same typology areas. It exists because the feasibility step requires concept layouts and the real corpus in this directory has none, so without it the step cannot legitimately start |
| `typologies.txt` | Invented, and a **different** scheme (Anytown, 896 units). Do not file it beside `brief.txt` in a run whose answers are asserted — two unit counts in one corpus is a corpus with two answers |
| `cost-estimate.xlsx` | Invented. Added with the workbook reader |

The repository is private, so nothing here is exposed today. It must not become public with the real
four in it, and anonymising them properly is the alternative.

Real client documents otherwise never enter version control: `.gitignore` keeps `samples/` and
`private/` out for that reason.

---

## `ridgeview/` — the official demonstration corpus

**Entirely invented, and safe to show anybody.** Fifteen PDFs for **Ridgeview Gardens**, the
official test project, covering the three areas named for the proof of value: feasibility,
procurement and cost management. No client, scheme, erf, party or figure in it is real.

It is unlike everything above it in three ways that matter:

| | |
|---|---|
| **Generated** | `npx tsx scripts/make-test-corpus.mts` writes it from `scripts/lib/test-scheme.mjs`. Do not hand-edit a PDF in there — regenerate it. |
| **Internally consistent** | One scheme declared once: the unit mix sums to 1 046 units, the elemental costs sum to the construction total, the contract sum *is* the recommended tender, and the cost report's variance is the difference it claims. `verify()` asserts every one of those and the generator refuses to write a corpus that fails. |
| **Guarded** | `scripts/lib/test-corpus.test.ts` — the PDFs still parse, each still classifies as its own kind, the figures are still present, and every mandatory criterion on the priority modules is still answered. That last one is *derived* from `DEFAULT_CRITERIA`, so adding a mandatory criterion fails the test until the corpus covers it. |

The project itself is built by `node scripts/seed-test-project.mjs`, which drives the real import
window rather than inserting rows — a project seeded by INSERT has no passages, so nothing grounds
and no run retrieves anything, and you would find that out in front of an audience.

It is named "Ridgeview Gardens" with no timestamp, which is exactly what keeps
`clean-test-projects.mjs` from deleting it: that script only removes projects whose name carries a
13-digit epoch. **Never add a timestamp to this project's name.**
