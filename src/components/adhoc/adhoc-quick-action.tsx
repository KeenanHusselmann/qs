/**
 * The quick action – a new ad hoc request from any page (November meeting: "so users don't have to
 * go through Projects first").
 *
 * In the top bar, not floating over the page. It floated first, pinned to the bottom-right of the
 * main area, and `checks/viewport.mjs` caught it covering real controls – the bill's Omit button,
 * Build up the rate on Pricing, links on the dashboard – at 1024, 1280 and 1440 wide. A button that
 * sits on top of another is the one thing that suite exists to forbid. The top bar is on every page
 * too, and covers nothing.
 */

"use client";

import { usePathname } from "next/navigation";

import { AdhocRequestDialog } from "@/components/adhoc/adhoc-request-dialog";

export function AdhocQuickAction() {
  const pathname = usePathname();
  // Home and the Ad hoc requests page carry their own, larger entry to the same thing.
  if (pathname === "/" || pathname.startsWith("/my-work")) return null;
  return (
    <div data-region="adhoc-quick-action">
      <AdhocRequestDialog trigger="fab" />
    </div>
  );
}
