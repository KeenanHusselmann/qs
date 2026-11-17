"use client";

/** Settings › Two-step sign-in – for the person signed in (audit C7). */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { confirmMyTwoStep, startMyTwoStep, turnOffMyTwoStep } from "@/app/(app)/settings/two-step-actions";

const field = "t-sm h-8 w-32 rounded-[var(--r-md)] border border-[var(--n-200)] px-2 font-mono tracking-widest outline-none focus:border-[var(--a-500)]";
const button = "t-sm h-8 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white hover:bg-[var(--n-900)] disabled:opacity-50";

export function TwoStep({ enabled, available }: { enabled: boolean; available: boolean }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [setup, setSetup] = useState<{ key: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const done = (outcome: { ok: boolean; reason?: string }) => {
    setRefusal(outcome.ok ? null : (outcome.reason ?? "That did not work."));
    if (outcome.ok) {
      setSetup(null);
      setCode("");
      router.refresh();
    }
  };

  return (
    <section data-region="two-step" className="mt-8">
      <header className="flex items-center gap-2">
        <ShieldCheck aria-hidden size={16} strokeWidth={1.75} className="shrink-0 text-[var(--n-500)]" />
        <h2 className="t-lg font-semibold text-[var(--n-800)]">Two-step sign-in</h2>
        <span data-two-step={enabled ? "on" : "off"} className={`t-xs rounded-[var(--r-sm)] px-1.5 py-0.5 font-medium ${enabled ? "bg-[var(--ok-50)] text-[var(--ok-700)]" : "bg-[var(--n-100)] text-[var(--n-600)]"}`}>
          {enabled ? "On" : "Off"}
        </span>
      </header>
      <p className="t-sm mt-1 max-w-[70ch] text-[var(--n-500)]">A code from an authenticator app after your password – so a stolen password alone does not get in.</p>

      {!available ? (
        <p className="t-sm mt-3 text-[var(--n-500)]">The environment credential has no account to add it to.</p>
      ) : enabled ? (
        <form className="mt-3 flex flex-wrap items-center gap-2" action={() => act(async () => done(await turnOffMyTwoStep(code)))}>
          <input aria-label="Current code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="Code" className={field} />
          <button type="submit" disabled={pending} data-action="two-step-off" className={button}>Turn off</button>
        </form>
      ) : setup ? (
        <div className="mt-3 flex flex-wrap items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made on the server; nothing to optimise. */}
          <img src={setup.qr} alt="QR code for your authenticator app" width={160} height={160} className="rounded-[var(--r-md)] border border-[var(--n-200)]" />
          <div className="flex flex-col gap-2">
            <p className="t-sm text-[var(--n-700)]">Scan this with your authenticator app, or enter the key:</p>
            <code data-region="two-step-key" className="t-sm rounded-[var(--r-sm)] bg-[var(--n-50)] px-2 py-1 font-mono tracking-wider text-[var(--n-800)]">{setup.key.match(/.{1,4}/g)?.join(" ")}</code>
            <form className="flex items-center gap-2" action={() => act(async () => done(await confirmMyTwoStep(code)))}>
              <input aria-label="Code from the app" data-input="two-step-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="6 digits" className={field} />
              <button type="submit" disabled={pending} data-action="two-step-confirm" className={button}>Confirm</button>
            </form>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={pending}
          data-action="two-step-start"
          onClick={() =>
            act(async () => {
              const outcome = await startMyTwoStep();
              if (outcome.ok) setSetup({ key: outcome.key, qr: outcome.qr });
              else setRefusal(outcome.reason);
            })
          }
          className={`${button} mt-3`}
        >
          Turn on
        </button>
      )}
      {refusal && <p role="alert" className="t-sm mt-2 text-[var(--err-700)]">{refusal}</p>}
    </section>
  );
}
