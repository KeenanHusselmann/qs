/**
 * The rubric every output document is held to.
 *
 * ── Why the practice needs to be able to read this ─────────────────────────────────────────
 *
 * The standard a bill is measured to lived in two places a quantity surveyor could not open: the
 * agent's prompt, and the checks that review what it produced. Both were followed; neither could
 * be read, argued with, or handed to somebody new. A standard nobody can read is not a standard,
 * it is a habit.
 *
 * ── Why it cannot drift from what is actually followed ─────────────────────────────────────
 *
 * This page renders `domain/rubric.ts`, and so does the agent: the measuring prompt is assembled
 * from those same strings, and `rubric.test.ts` fails if a check exists with no rule written for
 * it, or a rule claims a check that does not exist. So this is not a description of the rubric.
 * It is the rubric, with the machine reading one rendering of it and the reader another.
 */

import { BookCheck } from "lucide-react";

import { RubricView } from "@/components/rubric/rubric-view";
import { allRules, isChecked, RUBRICS } from "@/domain/rubric";
import { requireSession } from "@/lib/auth";

export default async function RubricPage() {
  await requireSession();

  const rules = allRules();
  const checked = rules.filter(isChecked).length;

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 py-6">
      <header>
        <h1 className="t-xl text-[var(--n-800)]">Rubric</h1>
        <p className="t-md mt-1 max-w-[80ch] text-[var(--n-600)]">
          What every document this platform produces is held to, and which of those rules it proves
          for itself. The agents that draft these documents are given these exact words — this page
          and their instructions are built from one list, so what you read here is what is followed.
        </p>
      </header>

      {/*
        The one figure worth putting at the top.

        Not a score: a rubric with more rules is not a better rubric, and a percentage would invite
        someone to raise it by writing rules nothing checks. What this says is narrower and more
        useful — of everything the practice requires, how much the platform can prove on its own,
        and therefore how much still rests on a person remembering.
      */}
      <section
        data-region="rubric-summary"
        className="flex items-center gap-3 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] px-4 py-3"
      >
        <BookCheck aria-hidden size={16} strokeWidth={1.75} className="text-[var(--a-700)]" />
        <p className="t-sm max-w-[80ch] text-[var(--n-700)]">
          <span className="num font-semibold text-[var(--n-800)]">{rules.length}</span> rules across{" "}
          <span className="num font-semibold text-[var(--n-800)]">{RUBRICS.length}</span> output
          documents. <span className="num font-semibold text-[var(--n-800)]">{checked}</span> are
          checked — the platform reviews the finished document and raises a finding where the rule
          was not followed. The rest are asked for, and rest on the reviewer.
        </p>
      </section>

      {RUBRICS.map((rubric) => (
        <RubricView key={rubric.slug} rubric={rubric} />
      ))}

      <p className="t-sm max-w-[80ch] text-[var(--n-500)]">
        A finding is a question, never a correction. Nothing here changes a quantity or refuses a
        document: a wall genuinely built without piers has no pier caps, and a bill for one is
        right. Each finding says what the documents would normally require and what it would cost to
        be wrong, so a quantity surveyor can dismiss it in a second or act on it.
      </p>
    </div>
  );
}
