/**
 * Settings — administration, and nothing that decides a figure.
 *
 * ── What moved, and why ────────────────────────────────────────────────────────────────────
 *
 * This page used to open with the ten financial assumptions: the prime rate, the bond term, the
 * instalment-to-income share, escalation, commission. They are gone from here — they live under
 * **Rate Library → Assumptions**, with the rest of the practice's cost data.
 *
 * The split is between *what the practice's numbers are* and *how the practice is administered*.
 * A prime lending rate is not a preference: it sets an affordability ceiling, decides six gates and
 * prints a verdict on a client's report, and it belongs beside the rates a bill is priced from. Who
 * may sign in is administration and belongs here.
 *
 * §2.6 is the reason to be careful about what else lands on this page — "settings are a failure to
 * decide". Everything here should be a fact about the practice that the platform cannot derive.
 */

import Link from "next/link";
import { ArrowRight, BookOpen, ListChecks, SlidersHorizontal, Workflow } from "lucide-react";

import { requireSession } from "@/lib/auth";
import { People } from "@/components/settings/people";
import { TwoStep } from "@/components/settings/two-step";
import { canManagePeople, findActive, listPeople, operatorEmail } from "@/lib/users";

export default async function SettingsPage() {
  const session = await requireSession();
  const me = await findActive(session.email);

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 py-6">
      <header>
        <h1 className="t-xl text-[var(--n-800)]">Settings</h1>
        {/* `--n-600` rather than `--n-500`: on the `--n-50` canvas that measures 4,45:1 against
            §7.8's 4,5. */}
        <p className="t-md mt-1 max-w-[80ch] text-[var(--n-600)]">
          Who works here, and what they may do. The figures the platform assumes on the
          practice&rsquo;s behalf are cost data, and they live with the rates.
        </p>
      </header>

      <People
        people={await listPeople()}
        operator={operatorEmail()}
        canManage={await canManagePeople(session.email)}
        you={session.email}
      />

      {/* Your own two-step sign-in (audit C7) – after People, which is everyone's. */}
      <TwoStep enabled={Boolean(me?.totpEnabledAt)} available={Boolean(me)} />

      {/*
        A signpost, not a redirect.

        The assumptions were on this page for months and somebody will come here looking for them.
        A page that simply no longer has them teaches nothing; a line saying where they went, and
        why, teaches the split once.
      */}
      <Link
        href="/rates"
        className="t-base flex items-center gap-3 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] px-4 py-3 transition-colors hover:border-[var(--a-300)]"
        style={{ transitionDuration: "var(--m-fast)" }}
      >
        <SlidersHorizontal aria-hidden size={16} strokeWidth={1.75} className="shrink-0 text-[var(--n-500)]" />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-[var(--n-800)]">
            Looking for the prime rate, escalation or the bond term?
          </span>
          <span className="t-sm mt-0.5 block text-[var(--n-600)]">
            They are under Rate Library → Assumptions, with the rest of the practice&rsquo;s cost
            data. They decide what a report says, so they sit with the figures rather than with the
            administration.
          </span>
        </span>
        <ArrowRight aria-hidden size={16} strokeWidth={2} className="shrink-0 text-[var(--n-400)]" />
      </Link>

      {/*
        The reference pages, read once rather than daily. Each had a row in the sidebar until the
        simplification of 16 Nov 2026; they are here so they can still be found without spending the
        menu on them.
      */}
      <section data-region="reference" className="flex flex-col gap-2">
        <h2 className="t-base font-semibold text-[var(--n-800)]">The practice&rsquo;s standards</h2>
        {REFERENCE.map(({ href, icon: Icon, title, about }) => (
          <Link
            key={href}
            href={href}
            className="t-base flex items-center gap-3 rounded-[var(--r-lg)] border border-[var(--n-200)] bg-[var(--n-0)] px-4 py-3 transition-colors hover:border-[var(--a-300)]"
            style={{ transitionDuration: "var(--m-fast)" }}
          >
            <Icon aria-hidden size={16} strokeWidth={1.75} className="shrink-0 text-[var(--n-500)]" />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-[var(--n-800)]">{title}</span>
              <span className="t-sm mt-0.5 block text-[var(--n-600)]">{about}</span>
            </span>
            <ArrowRight aria-hidden size={16} strokeWidth={2} className="shrink-0 text-[var(--n-400)]" />
          </Link>
        ))}
      </section>
    </div>
  );
}

const REFERENCE = [
  { href: "/policies", icon: BookOpen, title: "Policies", about: "The standards the practice files and the platform's advice is given under." },
  { href: "/rubric", icon: ListChecks, title: "Drafting rubric", about: "What every bill and report is checked against before it is issued." },
  { href: "/process", icon: Workflow, title: "Process model", about: "The practice's process, stage by stage – how each step is done and in what order." },
] as const;
