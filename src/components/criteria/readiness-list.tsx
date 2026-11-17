/**
 * What a process needs before it may begin — PLATFORM.md §1.3.3.
 *
 * The screen a QS actually looks at. Status first, in a sentence; then what is missing, with the
 * action beside it.
 *
 * ── What research changed ──────────────────────────────────────────────────────────────────
 *
 * The first attempt at this was a configuration table — dropdowns reading "Blocks / Flags" and a
 * "Declarable" checkbox. That is the schema wearing a UI, and it answered a question a firm asks
 * once a year rather than the one a QS asks every session. Configuration now lives in Settings.
 *
 * From v3, which solved this in the same lineage:
 *
 *  - **A blocked step must say what it is waiting FOR.** "Blocked" alone is a shrug.
 *  - **Missing documents and unsigned upstreams are different blockers**, and only the first can be
 *    cleared by uploading. They are shown apart because the reader's next action differs.
 *  - **Nothing a reader must act on hides in a tooltip.** A gap, a fallback and a blocked step all
 *    say their piece in the open.
 *  - **The action sits beside the thing that needs it**, not in a toolbar.
 */

"use client";

import { Check, ChevronDown, FileUp, Quote } from "lucide-react";

import { CriterionUpload } from "@/components/criteria/criterion-upload";
import { WithdrawEvidence } from "@/components/criteria/withdraw-evidence";
import { DocumentLink, DocumentOrigin } from "@/components/documents/document-link";
import { Panel } from "@/components/shell/panel";

import { type CriterionOutcome, type Readiness } from "@/lib/criteria-status";

/** What a row needs to name a document, open it, and say where it came from. */
export interface FiledDocument {
  id: string;
  filename: string;
  sourcePath: string | null;
  kind: string;
}

export function ReadinessList({
  readiness,
  /** Present on a project's module page, where the buttons can actually file something. */
  projectId,
  /** Document kinds already filed on this project, so a line can say it is done. */
  filedKinds,
  /** Everything filed, so a criterion can list all of its evidence rather than one citation. */
  filedDocuments,
}: {
  readiness: Readiness;
  projectId?: string;
  filedKinds?: ReadonlySet<string>;
  filedDocuments?: readonly FiledDocument[];
}) {
  const { missingInputs, gaps, outcomes, upstreamPending } = readiness;
  const resolved = outcomes.filter((o) => o.state === "satisfied" || o.state === "declared");

  /*
    ── This panel is about documents, so it is coloured by documents ─────────────────────────

    It read `startable`, which is *both* blockers at once — no missing document **and** no unsigned
    upstream. On Tender Analysis that painted the whole panel amber, bar and all, while its own
    header said "2/2 filed" and the line beside the bar said "Ready to start". Amber over a
    complete checklist tells a reader something is wrong with their documents, and nothing is.

    `criteria-status.ts` names this mistake at the top of the file: v3 gated a run button on
    `startable` and printed "needs a cost plan" directly under "Filed and indexed: the cost plan".
    The rule it draws is to key on the blocker the reader can actually clear from here — and from
    here, that is a missing document. The unsigned upstream is said in the page header and again in
    the run panel's own banner, both of which are about the step rather than about its filing.
  */
  const outstanding = missingInputs.length > 0;

  return (
    /*
      ── One panel, not three groups on the canvas ─────────────────────────────────────────
      This was a bare `<div>` holding a bordered status box and three sections whose only
      containers were uppercase words — "REQUIRED", "OPTIONAL", "FILED" — sitting directly on the
      page. Every other surface in the platform says a section is a section by putting a border and
      a header strip around it, so a reader arriving from the overview or the dashboard met a page
      that had stopped speaking the language. On the two modules that run no agent it was the whole
      screen: a title, a floating box and two capitalised words.

      The three groups stay groups inside it. What they were missing was the container, not the
      distinction.

      Amber when something required is outstanding — §7.2's attention colour doing its one job, with
      the count in the header saying the same thing in words so nothing rests on the tint.
    */
    <div data-region="readiness">
      <Panel
        title="What this step needs"
        count={`${resolved.length}/${outcomes.length} filed`}
        tone={outstanding ? "warn" : undefined}
      >
        {/*
          ── The status bar ────────────────────────────────────────────────────────────────
          "Blocked — 2 required inputs are missing." was true and told a reader nothing about what
          they were looking at or what to do. It named a state without naming the work.

          This says what the page is for and shows how far through it you are — a bar reads at a
          glance where a sentence has to be parsed. The ratio itself moved into the panel's header,
          which is where every other section on the platform states its count, and printing it twice
          one line apart read as two different measures.

          Amber when blocked rather than red: nothing has gone wrong, the work simply has not
          arrived yet (§7.2 — red is for rejected and over budget).
        */}
        <p className="t-sm text-[var(--n-600)]">
          File the documents this step needs. Each requirement is met by{" "}
          <span className="font-medium">any one</span> of the documents listed under it — upload it
          and the item ticks itself.
        </p>

        <div className="mt-2.5 flex items-center gap-3">
          <div
            role="progressbar"
            aria-valuenow={resolved.length}
            aria-valuemin={0}
            aria-valuemax={outcomes.length}
            aria-label="Requirements met"
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--n-200)]"
          >
            <div
              className={`h-full rounded-full transition-[width] ${
                outstanding ? "bg-[var(--warn-500)]" : "bg-[var(--ok-500)]"
              }`}
              style={{
                width: `${outcomes.length ? (resolved.length / outcomes.length) * 100 : 0}%`,
                transitionDuration: "var(--m-slow)",
              }}
            />
          </div>

          {/*
            Three states, because there are three. Saying "Ready to start" the moment the last
            document lands is wrong on any step with an unsigned upstream — the filing is finished
            and the step still cannot run, and a green line claiming otherwise sends a reader to
            press a button that is disabled.

            The middle state is neutral on purpose: `--ok` would call it done and `--warn` would ask
            for an action nobody can take from this panel. Nothing here needs doing, and what does
            is named rather than merely coloured (§7.1 #5).

            "**Required** filing complete", because the bar beside it counts the optional documents
            too and sits half full on a step whose mandatory rows are all in. A bare "complete" next
            to a half-drawn bar reads as one of the two being wrong.
          */}
          <span
            className={`t-sm shrink-0 ${
              outstanding
                ? "text-[var(--warn-700)]"
                : upstreamPending.length > 0
                  ? "text-[var(--n-600)]"
                  : "text-[var(--ok-700)]"
            }`}
          >
            {outstanding
              ? `${missingInputs.length} required still needed`
              : upstreamPending.length > 0
                ? `Required filing complete — waiting on ${upstreamPending.join(", ")}`
                : "Ready to start"}
          </span>
        </div>

        {missingInputs.length > 0 && (
          <Section heading="Required">
            {missingInputs.map((outcome) => (
              <Row key={outcome.criterion.id} outcome={outcome} blocking projectId={projectId} filedKinds={filedKinds} filedDocuments={filedDocuments} />
            ))}
          </Section>
        )}

        {gaps.length > 0 && (
          <Section heading="Optional">
            {gaps.map((outcome) => (
              <Row key={outcome.criterion.id} outcome={outcome} blocking={false} projectId={projectId} filedKinds={filedKinds} filedDocuments={filedDocuments} />
            ))}
          </Section>
        )}

        {resolved.length > 0 && (
          <Section heading="Filed">
            {resolved.map((outcome) => (
              <Row key={outcome.criterion.id} outcome={outcome} blocking={false} projectId={projectId} filedKinds={filedKinds} filedDocuments={filedDocuments} />
            ))}
          </Section>
        )}
      </Panel>
    </div>
  );
}

function Section({
  heading,
  note,
  children,
}: {
  heading: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    /* Separated by the panel's own rule rather than by whitespace: three groups in one box need a
       line between them, and `mt-7` of nothing was what read as "these are unrelated". */
    <section className="mt-4 border-t border-[var(--n-100)] pt-3">
      <h2 className="t-sm font-semibold tracking-[0.03em] text-[var(--n-500)] uppercase">
        {heading}
      </h2>
      {note && <p className="t-sm mt-1 max-w-[65ch] text-[var(--n-500)]">{note}</p>}
      <ul className="mt-2 flex flex-col">{children}</ul>
    </section>
  );
}

function Row({
  outcome,
  blocking,
  projectId,
  filedKinds,
  filedDocuments,
}: {
  outcome: CriterionOutcome;
  blocking: boolean;
  projectId?: string;
  filedKinds?: ReadonlySet<string>;
  filedDocuments?: readonly FiledDocument[];
}) {
  const { criterion, state, evidence, declaredBy, declaredReason } = outcome;

  /*
    Still open for work. `uncertain` counts: a document is filed but nothing in it grounds the
    criterion, which is exactly the moment someone needs the other acceptable documents — and the
    row used to hide them, leaving a filed-but-unmatched row with no way forward at all.
  */
  const unresolved = state === "missing" || state === "uncertain";

  /*
    Everything filed against this criterion.

    The row used to show a single citation, because grounding picks the one passage it can quote.
    File three documents and two of them vanished from the screen — they were in the database the
    whole time, but a QS looking at the page had no way to know that, and it read as each upload
    replacing the last. What is filed is a fact about the corpus, not about which passage won.
  */
  const mine = (filedDocuments ?? []).filter((d) => criterion.acceptedEvidence.includes(d.kind));

  /*
    One entry per document, with the passage attached to the document it came from.

    The citation and the filed list were separate blocks, which was tolerable while the citation
    was a paragraph of grey prose and became obvious the moment both showed the filename as a
    link: a criterion grounded by the only document filed against it printed that document twice,
    one line apart, and two links to one file read as two files.

    The list is the list. The quote is a property of an entry in it.
  */
  const cited = evidence?.documentId;
  const citedIsFiled = Boolean(cited && mine.some((d) => d.id === cited));

  const shown = [
    /*
      A passage can come from a document filed under a different kind — retrieval searches the
      project, not the criterion's shortlist, so the brief can be what grounds the site criterion.
      That document is this criterion's evidence without being one of its documents, so it is
      listed and marked as the source of the passage rather than as something filed here.
    */
    ...(evidence && !citedIsFiled
      ? [
          {
            key: cited ?? "cited",
            id: cited,
            filename: evidence.document,
            sourcePath: null,
            kind: null as string | null,
            evidence,
          },
        ]
      : []),
    ...mine.map((doc) => ({
      key: doc.id,
      id: doc.id as string | undefined,
      filename: doc.filename,
      sourcePath: doc.sourcePath,
      kind: doc.kind as string | null,
      evidence: doc.id === cited ? evidence : undefined,
    })),
  ];

  return (
    // Addressable, so a step further up the page can send a reader to the row that would clear it
    // rather than growing an uploader of its own. §2.5: one act, and exactly one way to do it.
    <li
      data-criterion={criterion.id}
      className="border-b border-[var(--n-100)] py-2.5 last:border-b-0"
    >
      {/*
        The label line and the documents beneath it are separate rows, not one flex row with the
        documents nested inside the middle column. Nesting them meant a criterion that carries a
        Declare button had a narrower middle column, so its Upload buttons stopped short of the
        ones above — the same control ending at two different edges depending on a property of the
        criterion. Now every Upload lands on the row's right edge, whatever else is on the line.
      */}
      <div className="flex items-start gap-3">
        <StateIcon state={state} blocking={blocking} />

        <div className="min-w-0 flex-1">
        {/* The name and what would satisfy it, on one line. A QS scanning this page is asking
            "what do I still owe?" — the answer is the label, and the accepted kinds are the
            answer to "what do I go and find?". Everything else was prose in the way. */}
          <span className="t-base font-medium text-[var(--n-800)]">
            {criterion.label}
            {criterion.weight === "mandatory" && (
              <span
                aria-label="required"
                title="Required before this step can start"
                className="ml-1 text-[var(--err-500)]"
              >
                *
              </span>
            )}
          </span>

        {/* Why it matters, folded away. It is worth having and not worth reading fourteen times. */}
        {criterion.detail && unresolved && (
          <details className="group mt-0.5">
            <summary className="t-sm w-fit cursor-pointer list-none text-[var(--n-400)] hover:text-[var(--n-600)] [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Why this is needed</span>
              <span className="hidden group-open:inline">Why this is needed</span>
            </summary>
            <p className="t-sm mt-1 max-w-[68ch] text-[var(--n-500)]">{criterion.detail}</p>
            {criterion.fallback && (
              <p className="t-sm mt-1 max-w-[68ch] text-[var(--warn-700)]">
                Without it: {criterion.fallback}
              </p>
            )}
          </details>
        )}

        {shown.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-2">
            {shown.map((doc) => (
              <li key={doc.key} className="flex items-start gap-2">
                {doc.kind === null ? (
                  // Evidence, but not filed under this criterion's kinds — see `shown`.
                  <Quote
                    aria-label="The passage came from here"
                    size={12}
                    strokeWidth={2}
                    className="mt-1 shrink-0 text-[var(--n-400)]"
                  />
                ) : (
                  <Check
                    aria-hidden
                    size={13}
                    strokeWidth={3}
                    className="mt-1 shrink-0 text-[var(--ok-500)]"
                  />
                )}

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <DocumentLink
                      projectId={projectId}
                      documentId={doc.id}
                      filename={doc.filename}
                    />
                    {doc.evidence?.page !== undefined && (
                      <span className="num t-xs shrink-0 text-[var(--n-400)]">
                        p.{doc.evidence.page}
                      </span>
                    )}
                  </span>

                  <DocumentOrigin sourcePath={doc.sourcePath} />

                  {doc.evidence && (
                    <Passage evidence={doc.evidence} uncertain={state === "uncertain"} />
                  )}
                </span>

                {doc.kind && (
                  <span className="t-xs mt-0.5 shrink-0 text-[var(--n-400)]">{doc.kind}</span>
                )}

                {projectId && doc.id && (
                  <WithdrawEvidence
                    projectId={projectId}
                    documentId={doc.id}
                    filename={doc.filename}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {declaredBy && (
          <p className="t-sm mt-1.5 text-[var(--n-600)]">
            Declared by {declaredBy}
            {declaredReason && ` — ${declaredReason}`}
          </p>
        )}

        </div>

        {/*
          Declaring used to live here, beside a "Document only" label on rows that could not be
          declared. Two controls answering a question the row does not raise: someone reading
          "Client mandate — Appointment letter — Upload" is not asking what they may assert, they
          are looking for the button that files a document.

          The tick in the checklist card is the same act and explains itself in place, so this row
          now has exactly one job — filing — and the card has the other.
        */}
      </div>

      {/*
          The documents themselves, one line each.

          They were a single grey run of text — "Appointment letter · Signed mandate · Service
          level agreement" — which reads as a note about the requirement rather than as three
          things you can go and find. A QS holding a signed mandate needs to see that exact words
          on its own line with its own button, not parse a sentence to work out whether it counts.

          **Any one of them satisfies the requirement.** They are alternatives, not a list to
          complete, which is why the heading says "any of" and why filing one closes the group.
        */}
      {criterion.acceptedEvidence.length > 0 && (
        /* Indented to sit under the label: the 17px tick box plus the 12px gap beside it. */
        /* Capped rather than full-width. Aligning the buttons to the page edge put half a screen
           of nothing between "Appointment letter" and the button that files it, and the two read as
           unrelated furniture. A column narrow enough to scan in one go keeps them a pair while
           still ending on one edge. */
        <ul className="mt-2 ml-[29px] flex max-w-[560px] flex-col gap-0.5 border-l border-[var(--n-200)] pl-3">
            {/*
              ── A satisfied criterion still takes documents ──────────────────────────────────
              The list used to render only while the criterion was unresolved, so the moment one
              document grounded it the row offered no way to file another. That is wrong for most
              of this platform: a job has forty contract instructions and twelve payment
              certificates, and the criterion is satisfied by the first one. The rest had nowhere
              to go except the bulk import screen — and the reason the upload is on the row at all
              is the v3 lesson at the top of this file, that a reader who discovers they need a
              document must be able to file it *there*.

              What changes on a satisfied row is only the sentence. Filing is no longer the thing
              that would unblock the step, so it does not ask to be read as one.
            */}
            <li className="t-xs text-[var(--n-400)]">
              {unresolved ? "Any one of these satisfies it" : "Filed — add another if there is more than one"}
            </li>
            {criterion.acceptedEvidence.map((kind) => (
              <li
                key={kind}
                className="flex items-center gap-3 rounded-[var(--r-sm)] py-0.5 pr-1 hover:bg-[var(--n-25)]"
              >
                <span className="t-sm min-w-0 flex-1 truncate text-[var(--n-700)]">{kind}</span>

                {/*
                  A line whose document is already filed says so, rather than offering the same
                  button as the empty ones beside it. Green because it is done — the one place §7.2
                  spends the colour on this screen, so the eye finds the finished lines without
                  reading any of them.
                */}
                {/*
                  On a satisfied row every kind offers an upload, because the question there is
                  "is there another one" rather than "which of these would do". The Uploaded badge
                  answers the second question and would only be in the way of the first.
                */}
                {unresolved && filedKinds?.has(kind) ? (
                  <span className="t-sm flex h-6 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--ok-500)] bg-[var(--ok-50)] px-2 font-medium text-[var(--ok-700)]">
                    <Check aria-hidden size={13} strokeWidth={3} />
                    Uploaded
                  </span>
                ) : projectId ? (
                  <CriterionUpload projectId={projectId} kind={kind} label={kind} compact />
                ) : (
                  <Action icon={FileUp} label="Upload" />
                )}
              </li>
            ))}
          </ul>
        )}
    </li>
  );
}

/**
 * The passage a criterion rests on — §1.3.2, the proof rather than a label.
 *
 * ── The quote was drowning the document ────────────────────────────────────────────────────
 *
 * It used to run inline: `brief.txt, p.4 — "… two hundred and twenty characters of retrieved
 * chunk …"`. Fourteen criteria on a page meant fourteen paragraphs of grey prose, and the one
 * thing a reader was looking for — *which document is this?* — was the four words at the front of
 * a wall of text. The name lost to its own evidence.
 *
 * So the document leads, on its own line, as a link. The passage stays on screen, because a
 * citation nobody can see is a tick with nothing behind it, but it is clamped to one line and
 * opens in full on a click. Trimmed, not hidden.
 *
 * ── An uncertain row is not quoting anything ───────────────────────────────────────────────
 *
 * Where a document is filed but nothing in it matched, the text underneath is the platform
 * explaining itself, not a passage from the corpus. It is short, it is the reader's next action,
 * and §1.3.3's rule stands: nothing a reader must act on hides behind a disclosure.
 */
function Passage({
  evidence,
  uncertain,
}: {
  evidence: NonNullable<CriterionOutcome["evidence"]>;
  uncertain: boolean;
}) {
  /*
    An uncertain row is not quoting anything. The text is the platform explaining that a document
    is filed and nothing in it matched — the reader's next action, and short. §1.3.3's rule holds:
    nothing a reader must act on hides behind a disclosure.
  */
  if (uncertain) {
    return <p className="t-sm mt-0.5 max-w-[62ch] text-[var(--warn-700)]">{evidence.quote}</p>;
  }

  return (
    <details className="group mt-0.5">
      <summary className="t-sm flex cursor-pointer list-none items-baseline gap-1 text-[var(--n-500)] hover:text-[var(--n-700)] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate italic group-open:hidden">
          &ldquo;{evidence.quote}&rdquo;
        </span>
        <span className="hidden flex-1 group-open:inline">The passage it matched</span>
        <ChevronDown
          aria-hidden
          size={12}
          strokeWidth={2}
          className="shrink-0 translate-y-px transition-transform group-open:rotate-180"
          style={{ transitionDuration: "var(--m-fast)" }}
        />
      </summary>
      <p className="t-sm mt-1 max-w-[68ch] border-l border-[var(--n-200)] pl-2.5 text-[var(--n-600)] italic">
        &ldquo;{evidence.quote}&rdquo;
      </p>
    </details>
  );
}

/**
 * The tick box for one item.
 *
 * ── Why a box and not an icon ──────────────────────────────────────────────────────────────
 *
 * This was a row of loose glyphs — a tick, a warning circle, a dashed circle — each meaning
 * something different and none of them reading as a list you work through. A checklist is a
 * recognised object: squares down the left, ticked ones done, empty ones not. People know what it
 * is at a glance and can count their remaining work without reading a word.
 *
 * ── Why it is not an <input type="checkbox"> ───────────────────────────────────────────────
 *
 * It looks tickable and deliberately is not. Nobody may mark "QS cost plan" done by clicking a box:
 * §1.3.2 says a criterion is satisfied when a passage in the corpus grounds it, and §1.3.3 says the
 * only other route is a named person declaring it with a reason. A tickable box would put a third
 * route in — one with no evidence and no name behind it — and quietly turn an audit trail into an
 * honour system. So it ticks *itself* when the document lands, and the buttons beside it are how a
 * person moves it.
 */
function StateIcon({ state, blocking }: { state: CriterionOutcome["state"]; blocking: boolean }) {
  const box =
    "mt-px grid size-[17px] shrink-0 place-items-center rounded-[4px] border transition-colors";

  if (state === "satisfied")
    return (
      <span
        role="img"
        aria-label="Satisfied"
        title="Found in a filed document"
        className={`${box} border-[var(--ok-500)] bg-[var(--ok-500)]`}
      >
        <Check aria-hidden size={12} strokeWidth={3} className="text-white" />
      </span>
    );

  // Somebody's word, not evidence. Ticked, because the item is dealt with — but outlined rather
  // than filled, so a reviewer scanning the column can see which ticks rest on a person.
  if (state === "declared")
    return (
      <span
        role="img"
        aria-label="Declared"
        title="Declared by a named person, without a document"
        className={`${box} border-[var(--ok-500)] bg-[var(--ok-50)]`}
      >
        <Check aria-hidden size={12} strokeWidth={3} className="text-[var(--ok-700)]" />
      </span>
    );

  // Filed, but nothing in it matched. Distinct from never filed at all, because the reader's next
  // move differs: check the document, rather than go and find one.
  if (state === "uncertain")
    return (
      <span
        role="img"
        aria-label="Filed, but nothing in it matched"
        title="A document is filed, but nothing in it matches this"
        className={`${box} border-[var(--warn-500)] bg-[var(--warn-50)] text-[var(--warn-700)]`}
      >
        <span aria-hidden className="t-xs leading-none font-bold">
          ?
        </span>
      </span>
    );

  // Empty, and the border says whether that matters.
  return (
    <span
      role="img"
      aria-label={blocking ? "Missing — blocks the run" : "Absent — does not block"}
      title={blocking ? "Required before this step can start" : "Optional — the run proceeds without it"}
      className={`${box} ${
        blocking ? "border-[var(--warn-500)] bg-[var(--n-0)]" : "border-dashed border-[var(--n-300)]"
      }`}
    />
  );
}

/**
 * Disabled until there is a corpus to upload into and a person to declare as.
 *
 * Present rather than hidden, and labelled with why: §1.3's integrity rule applied to a control.
 * A button that silently did nothing would be worse than one that says it cannot yet.
 */
function Action({ icon: Icon, label }: { icon: typeof FileUp; label: string }) {
  return (
    <button
      type="button"
      disabled
      title={`${label} — not built yet`}
      className="t-sm flex h-7 items-center gap-1.5 rounded-[var(--r-sm)] border border-[var(--n-200)] px-2 text-[var(--n-500)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon aria-hidden size={13} strokeWidth={1.75} />
      {label}
    </button>
  );
}
