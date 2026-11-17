/**
 * Project Details — PLATFORM.md §4.4: edit anything from the wizard, plus archive and delete.
 *
 * Three sections in order of how ordinary they are: details, then archive, then delete. The
 * destructive one is last and looks it — §7.2 keeps red for negative and rejected, and putting a
 * delete button beside a name field invites the misclick it deserves.
 *
 * The route stays `/settings`. The heading follows the sidebar label, and the sidebar says what a
 * QS came here to do — read and correct the project's particulars — rather than naming a
 * preferences screen, which §2.6 says this platform should not be accumulating anyway.
 */

"use client";

import { useActionState, useState } from "react";
import { Archive, ArchiveRestore, Save, Trash2 } from "lucide-react";

import {
  deleteProject,
  setArchived,
  updateProject,
  type UpdateProjectResult,
} from "@/app/(app)/projects/[id]/settings-actions";
import { STATUS_LABEL, type ProjectStatus } from "@/lib/project-status";
import { STAGES, stagesOf } from "@/lib/stages";
import { REGIONS } from "@/lib/rates";
import type { Project } from "@/db/schema";

export function ProjectSettings({ project }: { project: Project }) {
  const [result, action, pending] = useActionState<UpdateProjectResult | null, FormData>(
    updateProject,
    null,
  );

  const archived = project.status === "archived";

  return (
    <div className="mx-auto max-w-[640px] px-6 py-6">
      <h1 className="t-xl text-[var(--n-800)]">Project Details</h1>
      <p className="t-md mt-0.5 text-[var(--n-500)]">{project.name}</p>

      {/* ── Details ──────────────────────────────────────────────────────────────────── */}
      <form action={action} className="mt-7 flex flex-col gap-4">
        <input type="hidden" name="id" value={project.id} />

        <Field name="name" label="Name" defaultValue={project.name ?? ""} required />
        <div className="flex gap-3">
          <Field name="code" label="Code" defaultValue={project.code ?? ""} width={130} />
          <Field name="client" label="Client" defaultValue={project.client ?? ""} grow />
        </div>

        {/*
          The province, editable here as well as at setup — every project created before migration
          `0019` has none, and the pricing screen falls back to asking on each visit until one is
          set. §4.8: rates are regional, so this is a fact about the job rather than a preference.
        */}
        <label className="flex flex-col gap-1">
          <span className="t-sm text-[var(--n-600)]">Province</span>
          <select
            name="region"
            defaultValue={project.region ?? ""}
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
            Where the work is. The rate library prices by province, so this is what pricing starts
            from.
          </span>
        </label>

        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="t-sm text-[var(--n-600)]">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={project.status}
            className="t-base h-8 w-[200px] rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2 text-[var(--n-800)] outline-none focus:border-[var(--a-500)]"
          >
            {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>

        {/*
          ── The stages this project runs ────────────────────────────────────────────────

          The overview has always carried a "Change" link to this page and this page has never had
          the control, so the link was a promise the form could not keep. An engagement is the
          field most likely to have been entered wrongly — it is answered once, at setup, by
          somebody who may not have the appointment in front of them — and the one most likely to
          grow, because a practice taken on for a feasibility is appointed for the cost planning
          three months later.

          Unchecking everything is not a project that runs nothing. `stagesOf` reads an empty
          column as every stage, which is what it meant before anybody narrowed it, and the note
          says so rather than leaving a reader to discover it by saving.
        */}
        <fieldset className="flex flex-col gap-1">
          <legend className="t-sm text-[var(--n-600)]">Stages this project runs</legend>
          <p className="t-xs mt-0.5 mb-1 max-w-[60ch] text-[var(--n-600)]">
            Every count on the overview is scoped to these. A step outside them is set aside, not
            hidden — it stays reachable, and anything already signed under it stays signed.
          </p>
          <div className="flex flex-col gap-1">
            {STAGES.map((stage) => (
              <label key={stage.number} className="t-base flex items-center gap-2 text-[var(--n-800)]">
                <input
                  type="checkbox"
                  name="stages"
                  value={stage.number}
                  /* `stagesOf`, so a project nobody has narrowed shows every box ticked rather
                     than none — which is what it actually runs. Ticking all of them is collapsed
                     back to "not narrowed" on save. */
                  defaultChecked={stagesOf(project.stages).includes(stage.number)}
                  className="size-3.5 accent-[var(--a-500)]"
                />
                {stage.name}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Audit C5: test data was feeding the firm's cost per unit and the benchmark bands. */}
        <label className="t-base flex items-center gap-2 text-[var(--n-800)]">
          <input
            type="checkbox"
            name="isTest"
            defaultChecked={project.isTest}
            className="size-3.5 accent-[var(--a-500)]"
          />
          Test project
          <span className="t-xs text-[var(--n-500)]">– left out of Home figures, benchmarks and past-tender rates</span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--a-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--a-600)] disabled:opacity-60"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            <Save aria-hidden size={14} strokeWidth={1.75} />
            {pending ? "Saving…" : "Save changes"}
          </button>

          {/* §13.4 — autosave is the contract elsewhere; a settings form is the one place an
              explicit save reads better, so it says plainly when it has happened. */}
          {result?.saved && (
            <span role="status" className="t-sm text-[var(--ok-700)]">
              Saved
            </span>
          )}
          {result?.error && (
            <span role="alert" className="t-sm text-[var(--err-700)]">
              {result.error}
            </span>
          )}
        </div>
      </form>

      {/* ── Archive ──────────────────────────────────────────────────────────────────── */}
      <section className="mt-9 rounded-[var(--r-lg)] border border-[var(--n-200)] p-4">
        <h2 className="t-lg text-[var(--n-800)]">{archived ? "Archived" : "Archive"}</h2>
        <p className="t-sm mt-1 max-w-[58ch] text-[var(--n-500)]">
          {archived
            ? "This project is out of the working list. Everything in it is still readable, and anything that cited it still resolves."
            : "Takes the project out of the working list without changing anything in it. Finished work a practice keeps — reversible at any time."}
        </p>

        <form
          action={async () => {
            await setArchived(project.id, !archived);
          }}
          className="mt-3"
        >
          <button
            type="submit"
            className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] px-3 text-[var(--n-700)] transition-colors hover:bg-[var(--n-50)]"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            {archived ? (
              <>
                <ArchiveRestore aria-hidden size={14} strokeWidth={1.75} /> Restore project
              </>
            ) : (
              <>
                <Archive aria-hidden size={14} strokeWidth={1.75} /> Archive project
              </>
            )}
          </button>
        </form>
      </section>

      {/* ── Delete ───────────────────────────────────────────────────────────────────── */}
      <DeleteSection project={project} />
    </div>
  );
}

/**
 * Deleting, behind a typed confirmation.
 *
 * §7.7 — a confirmation states the consequence. Typing the name is not ceremony: this is the one
 * control on the page that cannot be undone from the interface, and a button that only needs a
 * stray click is how a project disappears during a scroll.
 */
function DeleteSection({ project }: { project: Project }) {
  const [confirmation, setConfirmation] = useState("");
  const matches = confirmation.trim() === project.name;

  return (
    <section className="mt-6 rounded-[var(--r-lg)] border border-[var(--err-500)]/30 bg-[var(--err-50)]/40 p-4">
      <h2 className="t-lg text-[var(--err-700)]">Delete</h2>
      <p className="t-sm mt-1 max-w-[58ch] text-[var(--n-600)]">
        Removes the project from every list. Its documents and anything that cited them stay on
        record, so nothing already issued becomes unresolvable — but it cannot be undone from here.
        If you only want it out of the way, archive it instead.
      </p>

      <form
        action={async () => {
          await deleteProject(project.id);
        }}
        className="mt-3 flex flex-wrap items-end gap-2.5"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="confirm" className="t-sm text-[var(--n-600)]">
            Type <span className="font-medium text-[var(--n-800)]">{project.name}</span> to confirm
          </label>
          <input
            id="confirm"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="t-base h-8 w-[260px] rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 outline-none focus:border-[var(--err-500)]"
          />
        </div>

        <button
          type="submit"
          disabled={!matches}
          className="t-base flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--err-500)] px-3 font-medium text-white transition-colors hover:bg-[var(--err-700)] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ transitionDuration: "var(--m-fast)" }}
        >
          <Trash2 aria-hidden size={14} strokeWidth={1.75} />
          Delete project
        </button>
      </form>
    </section>
  );
}

function Field({
  name,
  label,
  defaultValue,
  required,
  width,
  grow,
}: {
  name: string;
  label: string;
  defaultValue: string;
  required?: boolean;
  width?: number;
  grow?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 ${grow ? "flex-1" : ""}`} style={width ? { width } : undefined}>
      <label htmlFor={name} className="t-sm text-[var(--n-600)]">
        {label}
        {!required && <span className="ml-1 text-[var(--n-400)]">optional</span>}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="t-base h-8 rounded-[var(--r-sm)] border border-[var(--n-200)] bg-[var(--n-0)] px-2.5 text-[var(--n-800)] outline-none focus:border-[var(--a-500)]"
      />
    </div>
  );
}
