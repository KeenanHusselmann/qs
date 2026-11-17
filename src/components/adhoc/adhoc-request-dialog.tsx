/**
 * Opening an ad hoc request – "here's the input, this is what I need" (November meeting).
 *
 * One short form, not the project wizard: what it is, what is needed, who asked, by when, and the
 * files it comes with. The wizard's stages and entry criteria are what an ad hoc request exists to
 * skip. The files are filed after the request is created, one at a time, for the reason
 * `new-project-dialog.tsx` gives (the serverless body limit), and a file that does not land is named
 * rather than undoing the request.
 *
 * Used in four places, which is why the trigger is a prop: beside "Add project", as the floating
 * quick action on every page, on Home, and on the Ad hoc requests page.
 */

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Paperclip, Plus, X, Zap } from "lucide-react";

import { createAdhocRequest, type CreateProjectResult } from "@/app/(app)/projects/actions";
import { DOCUMENT_KINDS } from "@/lib/document-kinds";
import { fileDocument } from "@/lib/ingest/file-document";
import { inferKind } from "@/lib/ingest/infer-kind";

type Trigger = "button" | "primary" | "fab";

interface Input {
  file: File;
  kind: string;
}

export function AdhocRequestDialog({ trigger = "button", label }: { trigger?: Trigger; label?: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState(false);
  const [name, setName] = useState("");
  const [request, setRequest] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [inputs, setInputs] = useState<Input[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [navigating, startNavigation] = useTransition();
  const working = busy ?? (navigating ? "Opening the request…" : null);

  /*
    Closed when the page changes – which is what opening a request does. The project dialog this was
    modelled on closes by unmounting with the Projects page; this one lives in the top bar, which
    persists across navigation, so it stayed open over the request it had just created (seen in the
    browser demo's screenshot, not by any check).
  */
  const pathname = usePathname();
  const openedOn = useRef(pathname);
  useEffect(() => {
    if (shown && pathname !== openedOn.current) setShown(false);
  }, [pathname, shown]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (shown && !el.open) el.showModal();
    if (!shown && el.open) el.close();
  }, [shown]);

  function open() {
    openedOn.current = pathname;
    setName("");
    setRequest("");
    setRequestedBy("");
    setDueOn("");
    setInputs([]);
    setError(null);
    setShown(true);
  }

  function add(files: FileList | null) {
    if (!files) return;
    /*
      Copied out now, not inside the updater. A FileList is live: the caller clears the input
      straight after this so the same file can be picked again, and React runs an updater later –
      by which time the list was empty and attaching a file silently added nothing. Caught by
      `checks/adhoc.mjs` on its first run in the gate.
    */
    const picked = [...files].map((file) => ({ file, kind: inferKind(file.name, DOCUMENT_KINDS).kind ?? "" }));
    // The guess is shown and can be changed; where there is none the reader picks, because a kind
    // nothing reads is a document nothing finds (`document-kinds.ts`).
    setInputs((current) => [...current, ...picked]);
  }

  const unkinded = inputs.some((i) => !i.kind);
  const ready = name.trim().length > 0 && request.trim().length > 0 && !unkinded;

  async function submit() {
    setError(null);
    setBusy("Opening the request…");
    const data = new FormData();
    data.set("name", name);
    data.set("request", request);
    data.set("requestedBy", requestedBy);
    data.set("dueOn", dueOn);

    let outcome: CreateProjectResult;
    try {
      outcome = await createAdhocRequest(null, data);
    } catch {
      outcome = { error: "The request could not be opened – the server did not answer. Try again." };
    }
    if (outcome.error || !outcome.project) {
      setBusy(null);
      setError(outcome.error ?? "The request could not be opened.");
      return;
    }

    const project = outcome.project;
    const failed: string[] = [];
    for (const [index, input] of inputs.entries()) {
      setBusy(`Filing ${input.file.name} — ${index + 1} of ${inputs.length}…`);
      const result = await fileDocument({ projectId: project.id, file: input.file, kind: input.kind });
      if (!result.ok) failed.push(`${input.file.name} — ${result.error ?? "refused"}`);
    }
    setBusy(null);

    if (failed.length > 0) {
      setError(`${project.name} was opened, but ${failed.length} of ${inputs.length} files did not file: ${failed.join("; ")}. File them from its Documents page.`);
      return;
    }
    startNavigation(() => {
      router.push(`/projects/${project.id}`);
      router.refresh();
    });
  }

  const triggerClass =
    trigger === "fab"
      ? "flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[var(--a-500)] px-2.5 font-medium text-white transition-colors hover:bg-[var(--a-600)] md:px-3"
      : trigger === "primary"
        ? "t-base flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3.5 font-medium text-white transition-colors hover:bg-[var(--a-600)]"
        : "t-base flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-300)] bg-[var(--n-0)] px-3 font-medium text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)]";

  return (
    <>
      <button
        type="button"
        data-action="new-adhoc"
        data-trigger={trigger}
        onClick={open}
        // In the top bar the words go below md, so the button keeps its name for a screen reader.
        aria-label={trigger === "fab" ? "New ad hoc request" : undefined}
        title={trigger === "fab" ? "New ad hoc request" : undefined}
        className={triggerClass}
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        {trigger === "fab" ? <Zap aria-hidden size={14} strokeWidth={2} /> : <Plus aria-hidden size={14} strokeWidth={2} />}
        <span className={trigger === "fab" ? "t-sm hidden md:inline" : undefined}>{label ?? (trigger === "fab" ? "Ad hoc request" : "Add ad hoc request")}</span>
      </button>

      <dialog
        ref={dialog}
        data-region="new-adhoc"
        aria-labelledby="new-adhoc-title"
        onClose={() => setShown(false)}
        onCancel={(e) => {
          if (working) e.preventDefault();
        }}
        onClick={(e) => {
          if (e.target === dialog.current && !working) setShown(false);
        }}
        aria-busy={!!working}
        className="relative m-auto flex max-h-[86vh] w-[min(620px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] p-0 shadow-[var(--e-2)] backdrop:bg-[rgba(20,24,30,0.28)]"
      >
        {/*
          The form is rendered only while the dialog is open. This dialog sits in the top bar of every
          page, and a closed one kept its hidden file input in the DOM ahead of the page's own – so the
          first `input[type=file]` on the Corpus page was this one, and the gate's corpus suite filed
          its documents into a dialog nobody had opened. A control on every page that nobody can see
          is the wrong default anyway.
        */}
        {shown && (
        <>
        {working && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--n-0)]/95 px-6 text-center">
            <Loader2 aria-hidden size={26} className="animate-spin text-[var(--a-500)]" />
            <p role="status" aria-live="polite" className="t-sm max-w-[56ch] text-[var(--n-600)]">{working}</p>
          </div>
        )}

        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--n-200)] px-5 py-3.5">
          <div>
            <h2 id="new-adhoc-title" className="t-lg font-semibold text-[var(--n-800)]">New ad hoc request</h2>
            <p className="t-sm mt-0.5 text-[var(--n-600)]">Here&rsquo;s the input, this is what I need. No project setup – the files are kept as context for follow-up questions.</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => !working && setShown(false)} className="rounded-[var(--r-sm)] p-1 text-[var(--n-500)] hover:bg-[var(--n-100)]">
            <X aria-hidden size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="t-sm font-medium text-[var(--n-700)]">Name</span>
            <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="Steel schedule for the supplier meeting" className="t-base h-9 rounded-[var(--r-md)] border border-[var(--n-300)] px-2.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-sm font-medium text-[var(--n-700)]">What is needed</span>
            <textarea name="request" value={request} onChange={(e) => setRequest(e.target.value)} maxLength={4000} rows={4} placeholder="Steel tonnage and specification for the blocks, retaining walls, carports, roofs and boundary walls, from the architect's and engineer's drawings." className="t-base rounded-[var(--r-md)] border border-[var(--n-300)] px-2.5 py-2" />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="t-sm font-medium text-[var(--n-700)]">Who asked <span className="font-normal text-[var(--n-500)]">(optional)</span></span>
              <input name="requestedBy" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} maxLength={160} placeholder="Richard" className="t-base h-9 rounded-[var(--r-md)] border border-[var(--n-300)] px-2.5" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-sm font-medium text-[var(--n-700)]">Needed by <span className="font-normal text-[var(--n-500)]">(optional)</span></span>
              <input name="dueOn" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="t-base h-9 rounded-[var(--r-md)] border border-[var(--n-300)] px-2.5" />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="t-sm font-medium text-[var(--n-700)]">The inputs</span>
            {inputs.length > 0 && (
              <ul data-region="adhoc-inputs" className="flex flex-col gap-1.5">
                {inputs.map((input, i) => (
                  <li key={`${input.file.name}-${i}`} className="flex flex-wrap items-center gap-2 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 py-1.5">
                    <Paperclip aria-hidden size={13} className="shrink-0 text-[var(--n-500)]" />
                    <span className="t-sm min-w-0 flex-1 truncate text-[var(--n-800)]">{input.file.name}</span>
                    <select
                      aria-label={`What ${input.file.name} is`}
                      value={input.kind}
                      onChange={(e) => setInputs((all) => all.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}
                      className={`t-sm h-7 max-w-[220px] rounded-[var(--r-sm)] border px-1.5 ${input.kind ? "border-[var(--n-300)]" : "border-[var(--warn-500)]"}`}
                    >
                      <option value="">What is it?</option>
                      {DOCUMENT_KINDS.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                    <button type="button" aria-label={`Remove ${input.file.name}`} onClick={() => setInputs((all) => all.filter((_, j) => j !== i))} className="text-[var(--n-400)] hover:text-[var(--err-500)]">
                      <X aria-hidden size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="t-sm inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-[var(--r-md)] border border-dashed border-[var(--n-300)] px-3 py-1.5 text-[var(--n-700)] hover:bg-[var(--n-50)]">
              <Paperclip aria-hidden size={13} /> Attach drawings, specifications, emails…
              <input type="file" multiple className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
            </label>
            {unkinded && <p className="t-xs text-[var(--warn-700)]">Say what each file is, so the assistant and the take-off can find it.</p>}
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-[var(--n-200)] bg-[var(--n-50)] px-5 py-3">
          {error && <p role="alert" className="t-sm min-w-0 flex-1 text-[var(--err-700)]">{error}</p>}
          <button
            type="button"
            data-action="create-adhoc"
            onClick={submit}
            disabled={!ready || !!working}
            className="t-base ml-auto h-8 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:opacity-50"
          >
            Open the request
          </button>
        </footer>
        </>
        )}
      </dialog>
    </>
  );
}
