/**
 * Opening a project — three questions, one at a time.
 *
 * ── What was wrong with one form ───────────────────────────────────────────────────────────
 *
 * It asked for a name, a code, a client and six stages, all ticked, all at once, and then dropped
 * the reader on an empty project with forty requirements spread across eleven pages. That shape
 * assumes every project starts at its beginning with its whole document set in hand. Almost none
 * do: a practice takes work on at tender, or at valuation, with one document and a phone call.
 *
 * So this asks the three things in the order somebody can answer them:
 *
 *   1. What is it        — a name, and a code and client if they are settled.
 *   2. Where is it       — the stage it is at now. One click, and everything after it narrows.
 *   3. What have you got — that stage's requirements only, and what you can put your hands on.
 *
 * Step 3 is the point of the whole exercise. `onboarding.ts` derives it from the same entry
 * criteria the runs gate on, so the list is the checklist and not an approximation of it, and it
 * is five to twenty rows rather than forty. A project may be opened having answered nothing:
 * "not yet" is a recorded answer, not a refusal.
 *
 * ── Why the guidance is not a language model ───────────────────────────────────────────────
 *
 * The panel at the foot of steps 2 and 3 is what an onboarding agent would be for, and asking a
 * model "which documents does the Procurement stage need?" would get a plausible list that is not
 * the checklist the platform actually gates on. The repository knows the exact answer. §14 names
 * building the plausible-looking version as a way this project fails, so the guidance is derived
 * (`adviceFor`) and the model is kept for the question nobody wrote the answer to — what a given
 * file *is*, which `inferKind` guesses from the folder it came out of and shows for confirmation.
 *
 * ── The two-phase submit, and why it is not a form action ──────────────────────────────────
 *
 * Files cannot be filed against a project that does not exist yet, so this creates the project and
 * then uploads. A server action taking the whole thing in one multipart body would put every
 * attached document through the 4.5 MB serverless body limit at once; `fileDocument` already knows
 * how to route a large file around it, one at a time. A failed upload does not undo the project —
 * it says which file did not land, and the project's own Documents page takes it from there.
 */

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleSlash,
  Info,
  Loader2,
  Paperclip,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";

import { createProject, type CreateProjectResult } from "@/app/(app)/projects/actions";
import { DOCUMENT_KINDS } from "@/lib/document-kinds";
import type { Criterion } from "@/lib/entry-criteria";
import { fileDocument } from "@/lib/ingest/file-document";
import { inferKind } from "@/lib/ingest/infer-kind";
import {
  ANSWER_LABEL,
  STAGE_OPTIONS,
  adviceFor,
  criteriaForStage,
  stagesFrom,
  type Advice,
  type Answer,
  type StageOption,
  type Standing,
} from "@/lib/onboarding";
import { PROJECT_NAV } from "@/lib/navigation";
import { REGIONS } from "@/lib/rates";

/** Menu labels, so a group heading spells a module the way the sidebar does. */
const MODULE_LABEL = new Map(PROJECT_NAV.flatMap((g) => g.items).map((i) => [i.href, i.label]));

/** What is attached to one requirement: the file, and the kind the classifier proposed for it. */
interface Attachment {
  file: File;
  kind: string;
  /** The folder or filename the guess was made from, so a reader can judge it. */
  because: string | null;
}

const STEPS = ["The project", "Where it is", "What you have"] as const;

export function NewProjectDialog({ trigger = "button" }: { trigger?: "button" | "empty-state" }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [client, setClient] = useState("");
  const [region, setRegion] = useState("");
  const [stage, setStage] = useState<StageOption | null>(null);
  /*
    Earlier phases the practice runs as well.

    The starting phase carries everything after it, which is right for the usual engagement and wrong
    for the ones that are not: a practice appointed at Construction is still sometimes asked for the
    feasibility it never did, and a phase entered a click too far down had to be corrected afterwards
    in Project Details. Each earlier phase can simply be switched back on here. Cleared when the
    starting phase moves, so a phase that is now carried anyway cannot also sit in this set.
  */
  const [alsoRuns, setAlsoRuns] = useState<readonly number[]>([]);
  const chooseStage = (picked: StageOption) => {
    setStage(picked);
    setAlsoRuns((earlier) => earlier.filter((number) => number < picked.number));
  };
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [attached, setAttached] = useState<Record<string, Attachment>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The navigation to the new project, which is most of the wait.
   *
   * Creating the row takes a fraction of a second; rendering the project page the dialog lands on
   * takes seconds, longer on a cold function. The dialog used to close the moment the row existed,
   * which left the list page standing unchanged for that whole time, and "nothing happened" was
   * the report. Pushing inside a transition keeps `navigating` true until the project page has
   * rendered, so the loading panel stays up until there is something to replace it with.
   */
  const [navigating, startNavigation] = useTransition();
  const working = busy ?? (navigating ? "Opening the project…" : null);

  /**
   * A <dialog> is only ever modal, or shut.
   *
   * ── The third state, and why it has to be watched rather than checked ────────────────────
   *
   * `<dialog open>` without `showModal()` is a *non-modal* dialog: it sits in the normal document
   * flow, paints no backdrop, leaves the page behind it live, and scrolls with the page. It was
   * reported twice as "the modal is fixed to the projects page on load", and the give-away both
   * times was that nothing behind it was dimmed.
   *
   * Nothing here sets `open` deliberately, and a clean load never reaches that state — that was
   * measured, with a MutationObserver watching the attribute from before hydration: zero. What
   * reaches it is a tab that was left with the dialog open and then hot-reloaded. React replaces
   * the element, the attribute is reconciled onto the new node, and the browser's top-layer entry
   * is not — `open` survives, modality does not.
   *
   * The first attempt at this corrected the element inside a render effect, which was the wrong
   * shape: **the bad state arrives without a render, and no render follows it.** The effect sat
   * unrun and the dialog stayed on screen. A guard that only fires when something else happens is
   * not a guard.
   *
   * So the attribute is *watched*. `open` appearing without `:modal` is corrected the moment it
   * appears, whatever put it there. There is no loop: `showModal()` sets `open` and satisfies
   * `:modal`, so the observer's next pass finds nothing to do.
   */
  const [shown, setShown] = useState(false);

  // Read by the observer, which is installed once and must not re-subscribe on every keystroke.
  // Written in the effect below, never during render — a ref written during render is a value the
  // component cannot re-render on, and eslint's react-hooks/refs is right to refuse it.
  const wanted = useRef(shown);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    const enforce = () => {
      // The one state that must not exist: standing open with no top layer behind it.
      if (!element.open || element.matches(":modal")) return;

      // Removed rather than `close()`d. `close()` dispatches a close event, `onClose` below sets
      // `shown` back to false, and the dialog would shut itself the instant it was asked to open.
      // Verified: it did exactly that.
      element.removeAttribute("open");
      if (wanted.current) element.showModal();
    };

    enforce();
    const observer = new MutationObserver(enforce);
    observer.observe(element, { attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);

  // React state drives it the rest of the time. Separate from the guard above: this one is about
  // doing what the reader asked, that one is about a state nobody asked for.
  useEffect(() => {
    wanted.current = shown;

    const element = dialog.current;
    if (!element) return;

    if (shown && !element.matches(":modal")) element.showModal();
    else if (!shown && element.open) element.close();
  }, [shown]);

  function open() {
    setStep(0);
    setName("");
    setCode("");
    setClient("");
    setStage(null);
    // Or a phase switched on in a dialog that was then cancelled is quietly run by the next project.
    setAlsoRuns([]);
    setAnswers({});
    setAttached({});
    setError(null);
    setShown(true);
  }

  const criteria = stage ? criteriaForStage(stage.number) : [];
  const standings: Standing[] = criteria.map((criterion) => ({
    criterion,
    // Null, not "not-yet". Both mean the document is not to hand; only one of them is somebody
    // saying so, and the panel reacts to being told rather than to a default.
    answer: answers[criterion.id] ?? null,
    filename: attached[criterion.id]?.file.name,
  }));
  const advice = stage ? adviceFor(stage, standings) : null;

  /**
   * Answering "not yet" or "not applicable" drops whatever was attached.
   *
   * Leaving the file behind would file a document against a requirement the reader has just said
   * they do not have — the tick would be green over a document nobody meant to submit, which is
   * §1.3.1's warning about a figure that survives review looking checked, applied to evidence.
   */
  function answer(criterion: Criterion, value: Answer) {
    setAnswers((previous) => ({ ...previous, [criterion.id]: value }));
    if (value !== "have") {
      setAttached((previous) => {
        const next = { ...previous };
        delete next[criterion.id];
        return next;
      });
    }
  }

  function attach(criterion: Criterion, file: File) {
    // The kinds this criterion accepts are tried first: a file called "Layout.pdf" against the
    // zoning requirement is far more likely to be the land-use layout plan than a concept drawing.
    const preferred = inferKind(file.name, criterion.acceptedEvidence);
    const guess = preferred.kind ? preferred : inferKind(file.name, DOCUMENT_KINDS);

    setAttached((previous) => ({
      ...previous,
      [criterion.id]: {
        file,
        // Falling back to the criterion's first accepted kind rather than to nothing: the reader
        // has just said this file satisfies this requirement, which is more than the filename says.
        kind: guess.kind ?? criterion.acceptedEvidence[0] ?? DOCUMENT_KINDS[0],
        because: guess.because,
      },
    }));
    setAnswers((previous) => ({ ...previous, [criterion.id]: "have" }));
  }

  async function submit() {
    setError(null);
    setBusy("Creating the project…");

    const data = new FormData();
    data.set("name", name);
    data.set("code", code);
    data.set("client", client);
    // Built by hand, so a `name=` attribute on the control is not enough — the field has to be set
    // here too. Adding the select without this line stored nothing and looked like it had worked.
    data.set("region", region);
    const running = stage ? [...new Set([...stagesFrom(stage.number), ...alsoRuns])].sort((a, b) => a - b) : [];
    for (const number of running) {
      data.append("stages", String(number));
    }

    // A thrown action (the database unreachable, the connection dropped) rejects rather than
    // returning an error. Uncaught, it left the loading panel up over a dialog that could not be
    // used or closed.
    let outcome: CreateProjectResult;
    try {
      outcome = await createProject(null, data);
    } catch {
      outcome = { error: "The project could not be created – the server did not answer. Try again." };
    }
    if (outcome.error || !outcome.project) {
      setBusy(null);
      setError(outcome.error ?? "The project could not be created.");
      return;
    }

    const project = outcome.project;
    const files = Object.entries(attached);
    const failed: string[] = [];

    for (const [index, [, attachment]] of files.entries()) {
      setBusy(`Filing ${attachment.file.name} — ${index + 1} of ${files.length}…`);
      const result = await fileDocument({
        projectId: project.id,
        file: attachment.file,
        kind: attachment.kind,
      });
      if (!result.ok) failed.push(`${attachment.file.name} — ${result.error ?? "refused"}`);
    }

    setBusy(null);

    if (failed.length > 0) {
      // The project exists; saying otherwise would send someone to create it again. Name what did
      // not land, and let them file it from the project's own page.
      setError(
        `${project.name} was created, but ${failed.length} of ${files.length} ${failed.length === 1 ? "file" : "files"} did not file: ${failed.join("; ")}. File ${failed.length === 1 ? "it" : "them"} from the project's Documents page.`,
      );
      return;
    }

    // Not closed here: the dialog unmounts with the list page once the project page has rendered.
    startNavigation(() => {
      router.push(`/projects/${project.id}`);
      router.refresh();
    });
  }

  const canAdvance = step === 0 ? name.trim().length > 0 : step === 1 ? stage !== null : true;

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={
          trigger === "button"
            ? "t-base flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)]"
            : "t-base mt-4 h-8 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)]"
        }
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        {trigger === "button" && <Plus aria-hidden size={14} strokeWidth={2} />}
        {trigger === "button" ? "Add project" : "Add the first project"}
      </button>

      <dialog
        ref={dialog}
        data-region="new-project"
        aria-labelledby="new-project-title"
        // Escape and the close button both close the element directly; without this the state
        // would still say open and the next click on "Add project" would change nothing.
        onClose={() => setShown(false)}
        // Escape fires `cancel` before `close`. Refused while working, for the same reason as the
        // backdrop click below.
        onCancel={(e) => {
          if (working) e.preventDefault();
        }}
        onClick={(e) => {
          // Clicking the backdrop closes. The dialog element *is* the backdrop as far as events
          // are concerned, so a click landing on it rather than on its contents came from outside.
          // Not while it is working: a stray click must not abandon a half-filed set of documents.
          if (e.target === dialog.current && !working) setShown(false);
        }}
        aria-busy={!!working}
        className="relative m-auto flex max-h-[86vh] w-[min(720px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] p-0 shadow-[var(--e-2)] backdrop:bg-[rgba(20,24,30,0.28)]"
      >
        {working && <Creating name={name} status={working} />}

        <Header step={step} onClose={() => !working && setShown(false)} />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 0 && (
            <Details
              name={name}
              code={code}
              client={client}
              region={region}
              onName={setName}
              onCode={setCode}
              onClient={setClient}
              onRegion={setRegion}
            />
          )}
          {step === 1 && (
            <Where chosen={stage} onChoose={chooseStage} alsoRuns={alsoRuns} onToggleEarlier={(number) =>
              setAlsoRuns((earlier) =>
                earlier.includes(number) ? earlier.filter((n) => n !== number) : [...earlier, number],
              )
            } />
          )}
          {step === 2 && stage && (
            <What
              stage={stage}
              answers={answers}
              attached={attached}
              onAnswer={answer}
              onAttach={attach}
            />
          )}
        </div>

        {advice && step > 0 && <AdvicePanel advice={advice} />}

        <footer className="flex shrink-0 items-center gap-3 border-t border-[var(--n-200)] bg-[var(--n-50)] px-5 py-3">
          {error && (
            <p role="alert" className="t-sm min-w-0 flex-1 text-[var(--err-700)]">
              {error}
            </p>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                disabled={!!working}
                className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-3 text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)] disabled:opacity-60"
                style={{ transitionDuration: "var(--m-fast)" }}
              >
                <ArrowLeft aria-hidden size={14} strokeWidth={1.75} />
                Back
              </button>
            )}

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                data-action="next"
                onClick={() => setStep(step + 1)}
                disabled={!canAdvance}
                className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:opacity-50"
                style={{ transitionDuration: "var(--m-fast)" }}
              >
                Next
                <ArrowRight aria-hidden size={14} strokeWidth={1.75} />
              </button>
            ) : (
              <button
                type="button"
                data-action="create"
                onClick={submit}
                disabled={!!working}
                className="t-base h-8 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:opacity-60"
                style={{ transitionDuration: "var(--m-fast)" }}
              >
                {working ? "Working…" : "Open the project"}
              </button>
            )}
          </div>
        </footer>
      </dialog>
    </>
  );
}

// ── The chrome ────────────────────────────────────────────────────────────────────────────

/**
 * The loading panel, over the whole dialog from the click until the project page is on screen.
 *
 * Over the dialog rather than a line in its footer. The footer line was there, said "Creating the
 * project…" for about 150ms, and nobody saw it; the wait that followed had no feedback at all. A
 * panel covering the form also says the form is no longer editable, which a disabled button alone
 * did not. The one status region lives here, so a screen reader hears each phase once.
 */
function Creating({ name, status }: { name: string; status: string }) {
  return (
    <div
      data-region="creating"
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--n-0)]/95 px-6 text-center"
    >
      <Loader2 aria-hidden size={28} strokeWidth={2} className="animate-spin text-[var(--a-500)]" />
      <p className="t-lg max-w-[48ch] break-words text-[var(--n-800)]">Creating {name.trim()}</p>
      <p role="status" aria-live="polite" className="t-sm max-w-[60ch] break-words text-[var(--n-600)]">
        {status}
      </p>
      <p className="t-xs text-[var(--n-500)]">This takes a few seconds. Keep this window open.</p>
    </div>
  );
}

/**
 * The step rail — where you are of three, and what the other two will ask.
 *
 * Named rather than numbered. "2 of 3" says how much is left and nothing about what it is; a rail
 * that reads *The project · Where it is · What you have* lets somebody decide before they start
 * whether they can answer it now.
 */
function Header({ step, onClose }: { step: number; onClose: () => void }) {
  return (
    <header className="shrink-0 border-b border-[var(--n-200)] bg-[var(--n-50)] px-5 py-3">
      <div className="flex items-center gap-3">
        <h2 id="new-project-title" className="t-lg text-[var(--n-800)]">
          Open a project
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto grid size-7 shrink-0 place-items-center rounded-[var(--r-sm)] text-[var(--n-500)] transition-colors hover:bg-[var(--n-100)] hover:text-[var(--n-700)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <X aria-hidden size={15} strokeWidth={2} />
        </button>
      </div>

      <ol data-region="steps" className="mt-2.5 flex items-center gap-1.5">
        {STEPS.map((label, index) => (
          <li key={label} className="flex min-w-0 items-center gap-1.5">
            <span
              data-step={index}
              data-state={index === step ? "current" : index < step ? "done" : "ahead"}
              className={`t-xs flex items-center gap-1.5 rounded-[var(--r-full)] py-0.5 pr-2.5 pl-1.5 font-medium ${
                index === step
                  ? "bg-[var(--a-500)] text-white"
                  : index < step
                    ? "bg-[var(--ok-50)] text-[var(--ok-700)]"
                    : "bg-[var(--n-100)] text-[var(--n-500)]"
              }`}
            >
              <span className="num grid size-4 shrink-0 place-items-center">
                {index < step ? <Check aria-hidden size={11} strokeWidth={2.5} /> : index + 1}
              </span>
              {label}
            </span>
            {index < STEPS.length - 1 && (
              <span aria-hidden className="h-px w-3 shrink-0 bg-[var(--n-200)]" />
            )}
          </li>
        ))}
      </ol>
    </header>
  );
}

/**
 * What the setup says back, at the foot of every step that has an answer to react to.
 *
 * §7.2's semantic roles, and never colour alone (§7.1 #5) — the icon and the words carry it, the
 * tint only makes it findable.
 */
/** How many outstanding requirements are named before the panel starts counting instead. */
const SHOWN = 3;

/**
 * What the setup says back, at the foot of every step that has an answer to react to.
 *
 * §7.2's semantic roles, and never colour alone (§7.1 #5) — the icon and the words carry it, the
 * tint only makes it findable. Capped in height and in list length: this is a summary of the
 * checklist above it, and a summary that pushes the checklist off screen has stopped being one.
 */
function AdvicePanel({ advice }: { advice: Advice }) {
  const skin = {
    info: { box: "border-[var(--n-200)] bg-[var(--n-25)]", mark: "text-[var(--n-500)]", Icon: Info },
    ok: {
      box: "border-[var(--ok-500)]/25 bg-[var(--ok-50)]",
      mark: "text-[var(--ok-700)]",
      Icon: Check,
    },
    warn: {
      box: "border-[var(--warn-500)]/25 bg-[var(--warn-50)]",
      mark: "text-[var(--warn-700)]",
      Icon: TriangleAlert,
    },
  }[advice.tone];

  return (
    <aside
      data-region="advice"
      data-tone={advice.tone}
      className={`max-h-[30vh] shrink-0 overflow-y-auto border-t px-5 py-2.5 ${skin.box}`}
    >
      <p className="flex items-start gap-2">
        <skin.Icon aria-hidden size={14} strokeWidth={2} className={`mt-0.5 shrink-0 ${skin.mark}`} />
        <span className="t-base min-w-0 font-medium text-[var(--n-800)]">{advice.headline}</span>
      </p>

      {/* Names, on one wrapped line. Eight requirements each on their own row was eleven lines of
          panel saying one thing; the sentence under them is what they have in common. */}
      {advice.blocking.length > 0 && (
        <p data-region="blocking" className="t-sm mt-1 pl-6 text-[var(--n-700)]">
          <span className="font-medium">{advice.blocking.slice(0, SHOWN).join(", ")}</span>
          {advice.blocking.length > SHOWN &&
            ` and ${advice.blocking.length - SHOWN} more`}
        </p>
      )}

      {/* The half worth the space: what the platform will do *instead*, in the criterion's own
          words. A QS deciding whether to start today wants "the verdict is withheld" before they
          start, not after. */}
      {advice.consequences.length > 0 && (
        <ul data-region="consequences" className="mt-1.5 flex flex-col gap-1 pl-6">
          {advice.consequences.map((item) => (
            <li key={item.label} className="t-sm text-[var(--n-700)]">
              {/* The label as the criterion spells it. Lowercasing turned "QS cost plan" into
                  "qs cost plan", and a QS reading their own acronym in lower case reads a typo. */}
              <span className="font-medium">Without the {item.label}</span>
              <span className="text-[var(--n-600)]"> — {item.effect}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="t-sm mt-1.5 max-w-[88ch] pl-6 text-[var(--n-600)]">{advice.next}</p>
    </aside>
  );
}

// ── Step 1 ────────────────────────────────────────────────────────────────────────────────

function Details({
  name,
  code,
  client,
  region,
  onName,
  onCode,
  onClient,
  onRegion,
}: {
  name: string;
  code: string;
  client: string;
  region: string;
  onName: (v: string) => void;
  onCode: (v: string) => void;
  onClient: (v: string) => void;
  onRegion: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="t-sm max-w-[70ch] text-[var(--n-600)]">
        Only the name is needed. The rest can wait.
      </p>
      <Field
        name="name"
        label="Name"
        value={name}
        onChange={onName}
        placeholder="Erf 180 Monaghan Ext 3"
        required
        autoFocus
      />
      <div className="flex gap-3">
        <Field name="code" label="Code" value={code} onChange={onCode} placeholder="MON-01" width={130} />
        <Field
          name="client"
          label="Client"
          value={client}
          onChange={onClient}
          placeholder="Clever Development Trust"
          grow
        />
      </div>

      {/*
        ── The province, and why this one field earns its place ────────────────────────────

        §2.6 is right that a field demanded up front is a decision pushed onto somebody early, and
        the paragraph above says only the name is needed. This is the exception the rate library
        created: **a rate library is regional.** `rates.region` holds one of the nine provinces and
        the same item genuinely costs different money in Gauteng and the Western Cape, so without
        it the pricing screen asks a QS which province to price in *every time they open it* — a
        question the job could answer once.

        Optional, like the code and the client. Nobody said is a real answer, and a project with no
        province simply prices from the whole library with the screen saying so.
      */}
      <label className="flex flex-col gap-1">
        <span className="t-sm text-[var(--n-600)]">Province</span>
        <select
          name="region"
          value={region}
          onChange={(e) => onRegion(e.target.value)}
          className="t-base h-8 w-[220px] rounded-[var(--r-md)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)]"
        >
          <option value="">Not stated</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <span className="t-xs text-[var(--n-500)]">
          Where the work is. Rates are priced by province, so saying it here stops the pricing
          screen asking on every visit.
        </span>
      </label>
    </div>
  );
}

// ── Step 2 ────────────────────────────────────────────────────────────────────────────────

/**
 * Which stage the project is at — one click, and everything after it narrows.
 *
 * Options rather than six ticked checkboxes. A checkbox set asks "which of these apply", which is
 * a question about the whole chain; this asks the one thing a QS knows without thinking, and
 * derives the rest. The earlier stages are shown as behind it rather than hidden, because a reader
 * who picks Construction should be able to see that they have just set five stages aside.
 */
function Where({
  chosen,
  onChoose,
  alsoRuns,
  onToggleEarlier,
}: {
  chosen: StageOption | null;
  onChoose: (stage: StageOption) => void;
  alsoRuns: readonly number[];
  onToggleEarlier: (number: number) => void;
}) {
  const from = chosen?.number ?? 0;

  return (
    /* A <legend> is positioned by its fieldset rather than laid out by the fieldset's own
       formatting context, so on a `flex` fieldset it painted straight over the paragraph under
       it. `role="group"` + `aria-labelledby` is the same thing to a screen reader and lays out
       like anything else. */
    <div data-region="stages" role="group" aria-labelledby="where-legend" className="flex flex-col gap-3">
      <div>
        <p id="where-legend" className="t-base font-medium text-[var(--n-800)]">
          Where is this project now?
        </p>
        <p className="t-sm mt-0.5 max-w-[70ch] text-[var(--n-600)]">
          Pick the stage the work is at. Earlier stages are set aside – switch any back on, now or later.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        {STAGE_OPTIONS.map((stage) => {
          const selected = chosen?.number === stage.number;
          const behind = from > 0 && stage.number < from;

          const alsoChosen = alsoRuns.includes(stage.number);

          return (
            <div key={stage.number} className="flex items-stretch gap-1.5">
            <button
              type="button"
              data-stage={stage.number}
              data-selected={selected}
              data-also={alsoChosen}
              onClick={() => onChoose(stage)}
              className={`flex min-w-0 flex-1 items-start gap-3 rounded-[var(--r-md)] border px-3 py-2.5 text-left transition-colors ${
                selected
                  ? "border-[var(--a-500)] bg-[var(--a-50)]"
                  : behind && !alsoChosen
                    ? "border-[var(--n-100)] bg-[var(--n-25)] opacity-60 hover:opacity-100"
                    : behind
                      ? "border-[var(--a-300)] bg-[var(--n-0)]"
                      : "border-[var(--n-200)] bg-[var(--n-0)] hover:border-[var(--a-300)] hover:bg-[var(--a-50)]"
              }`}
              style={{ transitionDuration: "var(--m-fast)" }}
            >
              <span
                aria-hidden
                className={`num mt-0.5 grid size-5 shrink-0 place-items-center rounded-[var(--r-full)] text-[11px] font-semibold ${
                  selected
                    ? "bg-[var(--a-500)] text-white"
                    : "bg-[var(--n-100)] text-[var(--n-600)]"
                }`}
              >
                {stage.number}
              </span>

              <span className="min-w-0 flex-1">
                <span className="t-base block font-medium text-[var(--n-800)]">{stage.name}</span>
                <span className="t-xs block text-[var(--n-500)]">{stage.covers.join(" · ")}</span>
              </span>

              <span
                className={`t-xs shrink-0 rounded-[var(--r-full)] px-2 py-0.5 font-medium ${
                  selected ? "bg-[var(--a-500)] text-white" : "bg-[var(--n-100)] text-[var(--n-600)]"
                }`}
              >
                {behind ? (alsoChosen ? "also run" : "behind it") : `${stage.wants} to gather`}
              </span>
            </button>

            {/*
              Its own control, beside the choice rather than inside it: a button cannot hold a button,
              and clicking the row is already how the starting phase is picked.
            */}
            {behind && (
              <button
                type="button"
                data-include={stage.number}
                aria-pressed={alsoChosen}
                onClick={() => onToggleEarlier(stage.number)}
                className={`t-xs shrink-0 rounded-[var(--r-md)] border px-2.5 font-medium transition-colors ${
                  alsoChosen
                    ? "border-[var(--a-500)] bg-[var(--a-50)] text-[var(--a-700)]"
                    : "border-[var(--n-200)] bg-[var(--n-0)] text-[var(--n-600)] hover:border-[var(--a-300)] hover:text-[var(--n-900)]"
                }`}
                style={{ transitionDuration: "var(--m-fast)" }}
              >
                {alsoChosen ? "Running it" : "Run it too"}
              </button>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 3 ────────────────────────────────────────────────────────────────────────────────

/**
 * The stage's own checklist, grouped by the page each requirement is filed on.
 *
 * Feasibility & Inception asks for twenty things, which is a scroll nobody reads. Grouping by
 * module cuts it into four lists of three to seven, headed by the page the work happens on — and
 * the advisory rows sit behind a disclosure per group, because a reader deciding whether they can
 * start needs the nine that block a run, not the eleven that flag a gap.
 */
function What({
  stage,
  answers,
  attached,
  onAnswer,
  onAttach,
}: {
  stage: StageOption;
  answers: Record<string, Answer>;
  attached: Record<string, Attachment>;
  onAnswer: (criterion: Criterion, answer: Answer) => void;
  onAttach: (criterion: Criterion, file: File) => void;
}) {
  const criteria = criteriaForStage(stage.number);

  const groups = [...new Set(criteria.map((c) => c.module))].map((module) => ({
    module,
    label: MODULE_LABEL.get(module) ?? module,
    mandatory: criteria.filter((c) => c.module === module && c.weight === "mandatory"),
    advisory: criteria.filter((c) => c.module === module && c.weight === "advisory"),
  }));

  return (
    <div data-region="checklist" className="flex flex-col gap-4">
      <div>
        <p className="t-base font-medium text-[var(--n-800)]">
          What can you put your hands on for {stage.name}?
        </p>
        <p className="t-sm mt-0.5 max-w-[74ch] text-[var(--n-600)]">
          Mark what you have and attach it if it&rsquo;s to hand. A project can start with no documents.
        </p>
      </div>

      {groups.map((group) => (
        <section key={group.module} className="rounded-[var(--r-md)] border border-[var(--n-200)]">
          <h3 className="t-sm flex items-center gap-2 border-b border-[var(--n-100)] bg-[var(--n-50)] px-3 py-1.5 font-semibold text-[var(--n-700)]">
            {group.label}
            <span className="t-xs rounded-[var(--r-full)] bg-[var(--n-200)] px-1.5 py-0.5 font-medium text-[var(--n-600)]">
              {group.mandatory.length + group.advisory.length}
            </span>
          </h3>

          <div className="flex flex-col">
            {group.mandatory.map((criterion) => (
              <Row
                key={criterion.id}
                criterion={criterion}
                answer={answers[criterion.id] ?? null}
                attachment={attached[criterion.id]}
                onAnswer={onAnswer}
                onAttach={onAttach}
              />
            ))}
          </div>

          {group.advisory.length > 0 && (
            <details className="border-t border-[var(--n-100)]">
              <summary className="t-xs cursor-pointer list-none px-3 py-1.5 text-[var(--a-600)] hover:underline">
                {group.advisory.length} more that flag a gap rather than block the run
              </summary>
              <div className="flex flex-col border-t border-[var(--n-100)]">
                {group.advisory.map((criterion) => (
                  <Row
                    key={criterion.id}
                    criterion={criterion}
                    answer={answers[criterion.id] ?? null}
                    attachment={attached[criterion.id]}
                    onAnswer={onAnswer}
                    onAttach={onAttach}
                  />
                ))}
              </div>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}

const ANSWER_ICON = { have: Check, "not-yet": CircleSlash, "n/a": X } as const;

/**
 * One requirement, three answers, and a file if there is one.
 *
 * The answers are buttons rather than a select: three options is a case where the whole choice
 * fits on screen, and §7.1 #3 wants the frequent action reachable without opening anything.
 */
function Row({
  criterion,
  answer,
  attachment,
  onAnswer,
  onAttach,
}: {
  criterion: Criterion;
  answer: Answer | null;
  attachment: Attachment | undefined;
  onAnswer: (criterion: Criterion, answer: Answer) => void;
  onAttach: (criterion: Criterion, file: File) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);

  return (
    <div
      data-criterion={criterion.id}
      data-answer={answer ?? "unanswered"}
      className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[var(--n-100)] px-3 py-2.5 last:border-0"
    >
      <div className="min-w-[16rem] flex-1">
        <p className="t-base flex items-center gap-2 font-medium text-[var(--n-800)]">
          {criterion.label}
          {criterion.weight === "mandatory" && (
            <span className="t-xs rounded-[var(--r-sm)] bg-[var(--warn-50)] px-1.5 py-0.5 font-medium text-[var(--warn-700)]">
              Required
            </span>
          )}
        </p>
        {/* The kinds that would satisfy it, in the words the classifier matches on — so somebody
            looking at a folder of forty files knows what they are looking for. */}
        <p className="t-xs mt-0.5 text-[var(--n-500)]">
          {criterion.acceptedEvidence.slice(0, 4).join(" · ")}
          {criterion.acceptedEvidence.length > 4 && ` · +${criterion.acceptedEvidence.length - 4}`}
        </p>

        {attachment && (
          <p className="t-xs mt-1 flex flex-wrap items-center gap-1.5 text-[var(--n-600)]">
            <Paperclip aria-hidden size={11} strokeWidth={2} className="shrink-0" />
            <span className="font-medium text-[var(--n-800)]">{attachment.file.name}</span>
            <span className="rounded-[var(--r-sm)] bg-[var(--a-50)] px-1.5 py-0.5 font-medium text-[var(--a-700)]">
              {attachment.kind}
            </span>
            {/* The classifier names what it matched on. A guess a reader cannot check is a guess
                they have to trust, and §1.3 does not ask anybody to do that. */}
            {attachment.because && <span>read from &ldquo;{attachment.because}&rdquo;</span>}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {(["have", "not-yet", "n/a"] as const).map((value) => {
          const Icon = ANSWER_ICON[value];
          const on = answer === value;

          return (
            <button
              key={value}
              type="button"
              data-answer-option={value}
              aria-pressed={on}
              onClick={() => onAnswer(criterion, value)}
              className={`t-xs flex h-7 items-center gap-1 rounded-[var(--r-sm)] border px-2 font-medium transition-colors ${
                on
                  ? value === "have"
                    ? "border-[var(--ok-500)] bg-[var(--ok-50)] text-[var(--ok-700)]"
                    : "border-[var(--n-300)] bg-[var(--n-100)] text-[var(--n-700)]"
                  : "border-[var(--n-200)] bg-[var(--n-0)] text-[var(--n-600)] hover:bg-[var(--n-50)]"
              }`}
              style={{ transitionDuration: "var(--m-fast)" }}
            >
              <Icon aria-hidden size={11} strokeWidth={2.5} />
              {ANSWER_LABEL[value]}
            </button>
          );
        })}

        <input
          ref={picker}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onAttach(criterion, file);
            // Cleared so choosing the same file twice still fires a change.
            event.target.value = "";
          }}
        />
        <button
          type="button"
          data-action="attach"
          onClick={() => picker.current?.click()}
          className="t-xs flex h-7 items-center gap-1 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 font-medium text-[var(--a-600)] transition-colors hover:bg-[var(--a-50)]"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <Paperclip aria-hidden size={11} strokeWidth={2} />
          {attachment ? "Replace" : "Attach"}
        </button>
      </div>
    </div>
  );
}

// ── Fields ────────────────────────────────────────────────────────────────────────────────

function Field({
  name,
  label,
  value,
  onChange,
  placeholder,
  required,
  width,
  grow,
  autoFocus,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  width?: number;
  grow?: boolean;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  // `autoFocus` is not honoured on an element that was in the DOM before the dialog opened, so the
  // caret has to be placed when it opens. Without this the first keystroke goes nowhere.
  useEffect(() => {
    if (!autoFocus) return;
    const dialog = input.current?.closest("dialog");
    if (!dialog) return;

    const focus = () => input.current?.focus();
    // `open` is set by showModal() before paint; an observer catches it whoever opened it.
    const observer = new MutationObserver(() => {
      if (dialog.open) focus();
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, [autoFocus]);

  return (
    <div
      className={`flex flex-col gap-1 ${grow ? "flex-1" : ""}`}
      style={width ? { width } : undefined}
    >
      <label htmlFor={name} className="t-sm text-[var(--n-600)]">
        {label}
        {!required && <span className="ml-1 text-[var(--n-400)]">optional</span>}
      </label>
      <input
        ref={input}
        id={name}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        className="t-base h-8 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 text-[var(--n-800)] outline-none placeholder:text-[var(--n-400)] focus:border-[var(--a-500)]"
      />
    </div>
  );
}
