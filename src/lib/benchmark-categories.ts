/**
 * Which of the published guide's categories the practice benchmarks against – November meeting.
 *
 * The guide prints 25 categories, and the Benchmarks page compared every project against all of
 * them: a block of walk-up flats was offered airport terminals, prisons and stadiums as "the nearest
 * band". Raymond's words: most categories don't apply – not airports, not private dwellings; offices,
 * retail and parking might. Which ones apply is the practice's decision, not the platform's, so it is
 * a setting – stored as an assumption (appended, never overwritten, with who set it and from when) –
 * and this is its default until somebody sets it.
 *
 * Pure, so the page, the action and the tests share one reading of it.
 */

import { BUILDING_RATE_CATEGORIES } from "@/lib/published-cost-data";

/** The `assumptions.key` the choice is stored under. Not one of `ASSUMPTION_SPECS`, which are numbers. */
export const BENCHMARK_CATEGORIES_KEY = "benchmark.categories";

/** The meeting's answer: residential work, and the offices, retail and parking that come with it. */
export const DEFAULT_BENCHMARK_CATEGORIES: readonly string[] = [
  "Residential",
  "Residential ancillaries",
  "Student residential",
  "Offices",
  "Retail",
  "Parking",
];

/**
 * A stored choice, read back: a JSON list of category names, kept only where the guide still has
 * that category. Null for anything unreadable or empty – the default applies rather than a page
 * that benchmarks against nothing.
 */
export function readCategories(stored: string | null | undefined): string[] | null {
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return null;
    const known = parsed.filter((c): c is string => typeof c === "string" && BUILDING_RATE_CATEGORIES.includes(c));
    return known.length > 0 ? [...new Set(known)] : null;
  } catch {
    return null;
  }
}
