/**
 * The directory — who the practice does the work with and for.
 *
 * ── Grouped by kind, because that is how it is used ────────────────────────────────────────
 *
 * Nobody opens a directory to browse it. They open it to find a contractor, or the municipality,
 * or the client they are about to address a report to — so the entries are grouped by what they
 * are, in the order the work touches them, rather than alphabetically across the whole practice.
 *
 * ── The gap is the useful part ─────────────────────────────────────────────────────────────
 *
 * A client entry carries the projects that name it. And the page opens with the clients named on
 * projects that are *not* on file — a gap nothing else on the platform would ever mention, because
 * projects work perfectly well without a directory entry. That is exactly what makes the omission
 * invisible, and why it is stated first.
 */

import Link from "next/link";
import { AlertTriangle, FolderOpen, Mail, Phone, Users } from "lucide-react";

import { requireSession } from "@/lib/auth";
import { clientsNotFiled, directory } from "@/lib/contacts";
import { CONTACT_KINDS, KIND_LABEL, KIND_NOTE } from "@/lib/contact-kinds";
import { FileContactForm } from "@/components/contacts/file-contact-form";

export default async function ContactsPage() {
  await requireSession();
  const [entries, missing] = await Promise.all([directory(), clientsNotFiled()]);

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 py-6">
      <header>
        <h1 className="t-xl text-[var(--n-800)]">Contacts</h1>
        <p className="t-md mt-1 max-w-[80ch] text-[var(--n-600)]">
          The organisations this practice works with and for. A client entry carries the projects
          that name it, read from the project itself — the directory does not keep its own copy of
          who a job is for.
        </p>
      </header>

      {/*
        The gap, first. Projects run perfectly well with no directory entry behind their client,
        which is why nothing else would ever raise it.
      */}
      {missing.length > 0 && (
        <div
          data-region="clients-not-filed"
          className="rounded-[var(--r-lg)] border border-[var(--warn-500)] bg-[var(--warn-50)] px-4 py-3"
        >
          <p className="t-sm flex items-center gap-1.5 font-medium text-[var(--warn-700)]">
            <AlertTriangle aria-hidden size={13} strokeWidth={2} />
            {missing.length} {missing.length === 1 ? "client is" : "clients are"} named on a project
            but not in the directory
          </p>
          <p className="t-sm mt-1 text-[var(--n-700)]">{missing.join(" · ")}</p>
          <p className="t-sm mt-1.5 text-[var(--n-600)]">
            The projects are unaffected — a job does not need a directory entry to run. But there is
            nobody to address a report to, and nothing else on this platform would mention it.
          </p>
        </div>
      )}

      <FileContactForm />

      {CONTACT_KINDS.map((kind) => {
        const group = entries.filter((entry) => entry.kind === kind);

        return (
          <section
            key={kind}
            data-region={`contacts-${kind}`}
            className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)]"
          >
            <div className="flex items-baseline gap-2 border-b border-[var(--n-200)] bg-[var(--n-50)] px-4 py-2.5">
              <Users aria-hidden size={14} strokeWidth={2} className="text-[var(--a-700)]" />
              <h2 className="t-base font-semibold text-[var(--n-800)]">{KIND_LABEL[kind]}s</h2>
              <span className="t-sm num text-[var(--n-500)]">{group.length}</span>
              <span className="t-sm ml-2 min-w-0 flex-1 truncate text-[var(--n-500)]">
                {KIND_NOTE[kind]}
              </span>
            </div>

            {group.length === 0 ? (
              /* §7.5 — an empty surface says what would fill it, in this kind's own terms. */
              <p className="t-sm px-4 py-4 text-[var(--n-600)]">
                None filed. {KIND_NOTE[kind]}
              </p>
            ) : (
              <ul>
                {group.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--n-100)] px-4 py-2.5 last:border-b-0"
                  >
                    <span className="min-w-[220px]">
                      <span className="t-sm block font-medium text-[var(--n-800)]">
                        {entry.organisation}
                      </span>
                      {entry.person && (
                        <span className="t-xs block text-[var(--n-600)]">
                          {entry.person}
                          {entry.role ? ` · ${entry.role}` : ""}
                        </span>
                      )}
                    </span>

                    <span className="t-sm flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 text-[var(--n-600)]">
                      {entry.email && (
                        <a
                          href={`mailto:${entry.email}`}
                          className="inline-flex items-center gap-1 hover:text-[var(--a-700)]"
                        >
                          <Mail aria-hidden size={11} strokeWidth={2} />
                          {entry.email}
                        </a>
                      )}
                      {entry.phone && (
                        <span className="num inline-flex items-center gap-1">
                          <Phone aria-hidden size={11} strokeWidth={2} />
                          {entry.phone}
                        </span>
                      )}
                    </span>

                    {/* The link that stops this being an address book. */}
                    {entry.projects.length > 0 && (
                      <span className="flex flex-wrap items-baseline gap-2">
                        {entry.projects.map((project) => (
                          <Link
                            key={project.id}
                            href={`/projects/${project.id}`}
                            className="t-xs inline-flex items-center gap-1 rounded-[var(--r-sm)] bg-[var(--a-50)] px-1.5 py-0.5 font-medium text-[var(--a-700)] hover:bg-[var(--a-100)]"
                          >
                            <FolderOpen aria-hidden size={10} strokeWidth={2} />
                            {project.name}
                          </Link>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <p className="t-sm text-[var(--n-500)]">
        A removed entry is kept, not deleted — a supplier the practice has stopped using is still
        who a rate came from three years ago, and a directory that forgets them makes that rate
        untraceable.
      </p>
    </div>
  );
}
