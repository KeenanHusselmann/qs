/**
 * Print the sheet.
 *
 * A client component for one reason: printing is `window.print()`, and the page around it is a
 * server component that reads signed figures out of the database. This is the only interactive
 * thing on the report, so it is the only part that ships JavaScript.
 *
 * It prints the page rather than a generated file. §7.6 asks that the preview *be* the document —
 * so what the browser puts on paper is the same sheet the reader is looking at, and there is no
 * second renderer to disagree with the first.
 */

"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      data-action="print"
      onClick={() => window.print()}
      className="t-sm flex h-8 items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--n-800)] px-3 font-medium text-white transition-colors hover:bg-[var(--n-900)]"
      style={{ transitionDuration: "var(--m-fast)" }}
    >
      <Printer aria-hidden size={14} strokeWidth={2} />
      Print
    </button>
  );
}
