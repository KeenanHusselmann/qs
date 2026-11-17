"use client";

/**
 * Load or withdraw the simulated test rates – one act each, and said to be simulated in words.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";

import { loadSimulatedRates, withdrawSimulatedRates } from "@/app/(app)/rates/actions";

export function SimulatedRatesControl({ loaded, total = 0 }: { loaded: number; total?: number }) {
  const router = useRouter();
  const [pending, act] = useTransition();
  const [said, setSaid] = useState<string | null>(null);

  return (
    <div data-region="simulated-rates" className="flex flex-wrap items-center gap-2">
      <span className="t-xs flex items-center gap-1 text-[var(--n-500)]">
        <FlaskConical aria-hidden size={12} />
        {loaded > 0 ? `${loaded} simulated test rates on file` : "Testing without real rates?"}
      </span>
      <button
        type="button"
        data-action={loaded > 0 ? "withdraw-simulated" : "load-simulated"}
        disabled={pending}
        onClick={() =>
          act(async () => {
            if (loaded > 0) {
              const r = await withdrawSimulatedRates();
              setSaid(`${r.withdrawn} simulated rates withdrawn.`);
            } else {
              const r = await loadSimulatedRates();
              setSaid(`${r.loaded} simulated rates loaded – each labelled "Simulated test data – not a supplier quote".`);
            }
            router.refresh();
          })
        }
        className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-50"
      >
        {pending ? "Working…" : loaded > 0 ? "Withdraw simulated rates" : "Load simulated test rates"}
      </button>
      {loaded > 0 && total > loaded && (
        <button
          type="button"
          data-action="load-simulated-new"
          disabled={pending}
          onClick={() =>
            act(async () => {
              const r = await loadSimulatedRates();
              setSaid(`${r.loaded} new simulated rates loaded.`);
              router.refresh();
            })
          }
          className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--n-200)] px-2.5 font-medium text-[var(--n-700)] hover:bg-[var(--n-50)] disabled:opacity-50"
        >
          Load the {total - loaded} new {total - loaded === 1 ? "one" : "ones"}
        </button>
      )}
      {said && (
        <span role="status" className="t-xs text-[var(--n-600)]">
          {said}
        </span>
      )}
    </div>
  );
}
