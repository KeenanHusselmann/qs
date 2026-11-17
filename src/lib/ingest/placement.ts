/**
 * Where a document lands — PLATFORM.md §1.3.2, §1.3.3.
 *
 * A kind on its own ("Signed mandate") tells a reader nothing about what it unlocks. The same fact
 * arranged as **step → requirement → file** tells them everything: which part of the work this
 * document belongs to, which requirement it satisfies, and what else is sitting alongside it.
 *
 * That is the arrangement the import screen shows, and it is not a display convenience — it is the
 * chain the platform actually runs on. A document is filed as a kind; the kind satisfies a
 * criterion; the criterion belongs to a module. Deriving the grouping from that chain rather than
 * from a hand-written map means the screen cannot describe a filing the engine would not perform.
 */

import { DEFAULT_CRITERIA } from "@/lib/entry-criteria";
import { PROJECT_NAV } from "@/lib/navigation";

/** Where the import screen puts files it cannot place. Never a guess. */
export const UNPLACED = "__unplaced__";

export interface Placement {
  /** Project-relative module href, or UNPLACED. */
  module: string;
  moduleLabel: string;
  criterionId: string | null;
  criterionLabel: string;
}

const NAV_LABELS = new Map(
  PROJECT_NAV.flatMap((g) => g.items).map((i) => [i.href, i.label] as const),
);

/**
 * The first criterion a kind satisfies, and the module that owns it.
 *
 * First, not all: a kind can appear on several criteria — a project brief satisfies both the
 * developer brief and the feasibility estimate's concept parameters — and the file is one file.
 * It is filed once into the corpus and every criterion that wants it will find it there (§1.3.2),
 * so this picks somewhere sensible to *show* it rather than listing it three times.
 */
export function placementFor(kind: string): Placement {
  const criterion = DEFAULT_CRITERIA.find((c) => c.acceptedEvidence.includes(kind));

  if (!criterion) {
    return {
      module: UNPLACED,
      moduleLabel: "Not yet placed",
      criterionId: null,
      criterionLabel: "Choose what each of these is",
    };
  }

  return {
    module: criterion.module,
    moduleLabel: NAV_LABELS.get(criterion.module) ?? criterion.module,
    criterionId: criterion.id,
    criterionLabel: criterion.label,
  };
}

/** Module order as the sidebar has it, so the screen reads in the order the work happens. */
export function moduleOrder(module: string): number {
  if (module === UNPLACED) return -1; // What needs a decision comes first.
  const items = PROJECT_NAV.flatMap((g) => g.items);
  const index = items.findIndex((i) => i.href === module);
  return index === -1 ? 999 : index;
}

/**
 * Extensions that are kept but cannot be read.
 *
 * CAD files are the case that matters. A .dwg is Autodesk's proprietary binary — there is no
 * reader for it that does not mean a paid licence, a GPL obligation, or sending a client's drawings
 * to a third party. The issued PDF of the same drawing parses fine and is the document a QS would
 * defend anyway: it carries the revision and the title block.
 *
 * So they are held back from the import list rather than filling it with rows that can only fail.
 * The count is still reported — silently dropping a reader's files would be worse than the clutter.
 */
export const UNREADABLE_EXTENSIONS = ["dwg", "dxf", "rvt", "rfa", "ifc", "skp", "3ds", "step", "stp"];

/**
 * Files that are not documents at all.
 *
 * A real submission folder carries the working directory of whoever drew the drawings, and a
 * stormwater model ships with `PlotCfgs/DWG To PDF.pc3` and `IBU.ctb` beside it. Those are a
 * plotter configuration and a pen-thickness table: settings for a printer, not evidence of
 * anything. `.bak` and `.sv$` are AutoCAD's own backups of files that are already present.
 *
 * They were offered for classification, which is the platform asking a quantity surveyor what kind
 * of construction document a printer driver is. There is no right answer, so eleven rows sat in
 * "Tell us what these are" that nobody could ever clear.
 *
 * Distinct from the list above: a `.dwg` is a real drawing this platform cannot read yet and holds
 * on to. These carry nothing and are simply not brought in.
 */
export const NOT_DOCUMENTS = ["pc3", "ctb", "stb", "pmp", "pcp", "shx", "lin", "pat", "cui", "dwt", "bak", "sv$", "dwl", "dwl2", "ini", "db", "ds_store", "lnk", "tmp"];

export const isUnreadable = (filename: string) =>
  UNREADABLE_EXTENSIONS.includes(extensionOf(filename));

export const isNotADocument = (filename: string) => NOT_DOCUMENTS.includes(extensionOf(filename));

const extensionOf = (filename: string) => filename.toLowerCase().split(".").pop() ?? "";
