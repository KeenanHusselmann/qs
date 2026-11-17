/**
 * An icon for every place in the nav — PLATFORM.md §4.1, §7.1.
 *
 * ── Why this exists, and why it is not in `navigation.ts` ──────────────────────────────────
 *
 * The sidebar had no icons. Expanded that reads as a plain list; **collapsed to 56px it rendered
 * `label.slice(0, 2)`** — a rail of "Da / Pr / Ap / Ra / Be", which is not navigation, it is a word
 * game. §4.1 specifies the collapsed rail as a first-class state, and a rail only works if each row
 * carries a mark somebody can recognise without reading.
 *
 * `navigation.ts` stays pure data: it is imported by `chain.ts`, `dashboard.ts` and
 * `command-search.ts`, all of which run on the server and none of which should pull a React icon
 * library in to answer a question about process order. So the mapping lives here, beside the only
 * component that draws them.
 *
 * ── Keyed by href, and asserted complete ───────────────────────────────────────────────────
 *
 * A missing icon is invisible in review and obvious in production — a blank square in the rail. The
 * unit test walks both navs and fails on any href without one, so adding a module without an icon
 * cannot ship quietly. That is the same shape as `check-modules.mjs`: a list typed by hand needs a
 * check that it is complete, or it silently is not.
 */

import {
  BookCheck,
  FileSearch,
  UserRound,
  ShieldCheck,
  Users,
  Compass,
  House,
  BarChart3,
  Banknote,
  Building2,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  Columns3,
  FileCheck2,
  FileSignature,
  Gauge,
  FileStack,
  FolderOpen,
  Handshake,
  LayoutDashboard,
  Layers,
  ListChecks,
  ListTree,
  MapPin,
  Receipt,
  Ruler,
  Scale,
  Settings,
  Tag,
  TrendingUp,
  type LucideIcon,
  Workflow,
} from "lucide-react";

/**
 * Every nav href, to the mark that stands for it.
 *
 * Chosen for what a QS would recognise rather than for variety: a ruler for measurement, a
 * handshake for tender, a signature for the contract, a key for handover. Several match the icons
 * the Mzilikazi reference build uses for the same items, because a reader who has seen that one
 * should not have to relearn them.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  // ── Platform ──
  "/": House,
  "/start": Compass,
  "/dashboard": LayoutDashboard,
  "/projects": FolderOpen,
  "/my-work": UserRound,
  // The firm's process architecture. A branching flow, because that is what the model is —
  // phases into domains into areas, each feeding the next.
  "/process": Workflow,
  // A shield: these are the standards advice is held to, not a document library.
  "/policies": ShieldCheck,
  // A ruled book: the standard the platform measures its own output against, rule by rule.
  "/rubric": BookCheck,
  "/contacts": Users,
  "/rates": Tag,
  "/benchmarks": BarChart3,
  "/settings": Settings,

  // ── What a project has ──
  "": Building2,
  "/corpus": FileStack,

  // ── Set up ──
  "/inputs": ClipboardList,
  // A clipboard being checked off: every bill item read against the design and marked.
  "/review": ListChecks,
  "/site": MapPin,

  // ── Cost planning ──
  "/feasibility": Calculator,
  "/cost-plan": Layers,
  // Columns side by side: estimates compared element by element.
  "/estimates": Columns3,
  // A gauge: the detailed estimate read against the budget, and how far it has moved.
  "/cost-control": Gauge,
  "/cash-flow": BarChart3,

  // ── Measurement ──
  "/take-off": Ruler,
  "/bill": ListTree,
  "/pricing": Banknote,

  // ── Procurement ──
  "/tender": Handshake,
  "/tender-analysis": Scale,
  "/rfq": FileSearch,
  "/contract": FileSignature,

  // ── Construction ──
  "/valuations": Receipt,
  "/variations": ClipboardCheck,
  "/cost-report": TrendingUp,

  // ── Close-out ──
  "/final-account": FileCheck2,
};

/**
 * The mark for a nav href.
 *
 * Falls back rather than throwing: a nav item with no icon is a gap in this file, and a blank rail
 * row is a better failure than a crashed shell. The test below is what stops it reaching anybody.
 */
export const iconFor = (href: string): LucideIcon => ICONS[href] ?? Building2;

/** Whether an href has a mark of its own — what the completeness test asserts. */
export const hasIcon = (href: string): boolean => href in ICONS;
