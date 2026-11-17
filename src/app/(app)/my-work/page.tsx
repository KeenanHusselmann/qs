import { requireSession } from "@/lib/auth";
import { loadAdhocRows } from "@/lib/adhoc-load";
import { AdhocList } from "@/components/adhoc/adhoc-list";

/**
 * The ad hoc requests, open and answered (November meeting: "here's the input, this is what I
 * need"). The "ad hoc request screen" the quick action and the assistant link back to.
 *
 * It also listed the project-management items assigned to the signed-in person. That board was
 * removed in the simplification of 16 Nov 2026, so the page is now the requests alone.
 */
export default async function MyWorkPage() {
  await requireSession();
  const adhoc = await loadAdhocRows();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-8 py-6">
      <h1 className="t-xl text-[var(--n-800)]">Ad hoc requests</h1>
      <AdhocList rows={adhoc} today={today} />
    </div>
  );
}
