/**
 * Measuring the drawings – the take-off agent (D1.2). PLATFORM.md §1.3.2, §5.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────
 *
 * A bill drafted from a specification copies figures that are already written down. A detailed
 * design does not write its quantities down – it prints dimensions, spacings, sections and notes,
 * and a quantity surveyor measures from them. Until this, drawings were filed, counted and never
 * measured, so a project with a full design and no specification drafted a bill of nothing.
 *
 * ── How it measures ────────────────────────────────────────────────────────────────────────
 *
 * The model reads the drawings' text – dimension strings, schedules, sections, general notes –
 * and does the part that needs a quantity surveyor's judgement: which elements there are, how
 * each is measured under the Standard System, which figures it rests on. It names every figure
 * with the drawing's own words (or states it as an assumption where the drawing leaves it to the
 * engineer) and writes each dimension as working over those names. It does no arithmetic.
 *
 * `domain/drawing-takeoff.ts` then checks every quote against the text that was sent, refuses what
 * cannot be traced, and evaluates the working. What survives is written as dimension sheets.
 */

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { documents, passages } from "@/db/schema";
import { checkTakeoff, type CheckedTakeoff, type ProposedItem, type ProposedParameter } from "@/domain/drawing-takeoff";
import { CARRIES_WITH_IT, HOW_TO_MEASURE, prose, WHICH_DRAWING } from "@/domain/rubric";
import { addUsage, askForJson, type Usage } from "@/lib/agent/deepseek";
import { fence } from "@/lib/egress/fence";
import { locateQuote } from "@/lib/agent/grounding";
import { isSpatial } from "@/lib/ingest/document-class";

/** Enough for a drawing set's notes and dimension strings; a longer set is read in part and says so. */
const MAX_CHARS = 60_000;

const SYSTEM = `You are a South African quantity surveyor measuring a take-off from a project's drawings, to produce an elemental bill of quantities under the Standard System of Measuring Building Work (ASAQS) and SANS 1200.

You are given the TEXT of the drawings – dimension strings, schedules, sections, legends and general notes – as extracted from the PDF. Dimension strings often run together ("3000300030002990" is 3000, 3000, 3000, 2990). Figures in drawings are in millimetres unless marked (m, m²).

Measure EVERY element of work the drawings describe, in elemental order: earthworks (excavation, backfill, carting away), concrete (footings, bases), masonry (foundation walling below ground, superstructure walling, piers/columns, brickforce, damp-proof course, movement joints, openings), precast items (copings, caps), finishes (plaster, paint – each face that is finished), and anything else shown. Measure net as fixed, walls in m² (length × height, each thickness separately), footings and excavation in m³, DPC/coping/joints/brickforce in m, counted items in no.

${prose(WHICH_DRAWING)}

${prose(CARRIES_WITH_IT)}

${prose(HOW_TO_MEASURE)}

You do NO arithmetic. Instead:

1. "parameters": the figures – lengths, heights, widths, thicknesses, spacings, counts – each with a short snake_case name. NEVER an area or a volume: those are built in the item lines.
   - A figure the drawings print: give "figure" exactly as printed ("292,69", "2500", "105,40"), its "unit" as printed ("mm" or "m" or "no"), and "quote": copy the drawing text around the figure CHARACTER FOR CHARACTER, at least 15 characters – including any run-together digits and missing spaces exactly as they appear ("2500100 230 360690Wall Height50", "DPC @ MIN. 150mm ABOVE NGL"). Do not add spaces, do not tidy it.
   - A figure worked out from others (a count of piers per run, a net panel length): give "expression" over parameter names only, e.g. "floor(L_nw / pier_centres) + 1", with "figure": null and "quote": null. Allowed: + - * / ( ) and ceil floor round min max. Units are converted for you – a figure in mm is used in metres in every expression – so never divide by 1000.
   - A figure the drawings leave open ("to engineer's details", "to be confirmed on site") that the measurement still needs: give a typical value as "figure", its "unit", "quote": null and "assumption": one sentence saying why this value and that it must be confirmed. Never present an assumption as read.
2. "items": each bill item – "section" (the trade or element heading it goes under in the bill), "element" (the cost plan element it belongs to – exactly one of substructure, superstructure, finishes, fittings, services, external, preliminaries, provisional: foundations, footings, excavation, backfill and walling below ground are substructure; walls, piers, columns, openings and copings above ground are superstructure; plaster and paint are finishes), "description" (a bill description a contractor can price, and it must carry what decides the rate: the concrete grade and aggregate, the brick and mortar class, the plaster class, thickness and finish, the paint system, the DPC material and width, the joint filler and sealant, the size of every pier, cap, coping and lintel. No query references or review notes – those go in "gaps". Masonry below the damp course is described as the unit the engineer requires there, not as the superstructure brick), "unit" (m, m2, m3, no), and "lines": dimension lines, each { "location", "times", "dimensions", "deduct" }. "times" and every entry of "dimensions" are expressions over parameter names. The only numbers you may write in an expression are 1, 2, 3 and 4 (for example 2 faces); every other number must be a parameter.
   A line in m has exactly 1 dimension [length]; in m2 exactly 2 [length, height or width]; in m3 exactly 3 [length, width, depth]; in no exactly 0 – the count goes in "times".

A worked example, for a different garden wall (do not copy its figures):
parameters: L = "48,20" m, quote "GARDEN WALL LENGTH = 48,20 m"; h = "1800" mm, quote "WALL HEIGHT 1800mm ABOVE NGL"; c = "3000" mm, quote "PIERS @ 3000 CENTRES"; p = "460" mm, quote "460x460 PIER"; fw = "600" mm, quote "600 WIDE CONCRETE FOOTING"; piers = expression "floor(L / c) + 1"; panel = expression "L - piers * p"; ft = "200" mm, assumption "Footing thickness is to the engineer; 200 mm is typical – confirm."; t = "230" mm, quote "230MM BRICK WALL"; fd = "600" mm, assumption "Foundation depth is to the engineer; 600 mm is typical for a 1,8 m wall – confirm."
items:
 {"section":"Masonry","description":"One-brick walling in 14 MPa bricks, class II mortar, in superstructure","unit":"m2","lines":[{"location":"Panels between piers","times":"1","dimensions":["panel","h"],"deduct":false}]}
 {"section":"Masonry","description":"460 x 460 mm brick piers","unit":"no","lines":[{"location":null,"times":"piers","dimensions":[],"deduct":false}]}
 {"section":"Finishes","description":"Cement plaster to both faces of walling","unit":"m2","lines":[{"location":"Both faces","times":"2","dimensions":["panel","h"],"deduct":false}]}
 {"section":"Earthworks","description":"Excavate trench for strip footing","unit":"m3","lines":[{"location":null,"times":"1","dimensions":["L","fw","fd"],"deduct":false}]}
 {"section":"Earthworks","description":"Backfill to trenches with selected excavated material","unit":"m3","lines":[{"location":"Trench","times":"1","dimensions":["L","fw","fd"],"deduct":false},{"location":"Ddt footing","times":"1","dimensions":["L","fw","ft"],"deduct":true},{"location":"Ddt walling below ground","times":"1","dimensions":["panel","t","fd - ft"],"deduct":true}]}

Do not include preliminaries or provisional sums as measured items – the quantity surveyor prices those – but DO name them in "gaps" where the documents show the site needs them (a surveyor's pegging certificate, a utility's supervision, the engineer's inspections, cube tests, geotechnical work, service diversions). Do not repeat an item.

3. "gaps": what the documents require or imply that you could NOT measure, each one sentence – work whose figure is not on any sheet ("the bar schedule is not in the text supplied"), work another discipline must confirm, and the preliminaries and provisional sums above. An omission nobody is told about is the expensive kind: a bill that silently leaves out the reinforcement adds up perfectly and is a fifth short. [] only where there is genuinely nothing.

Reply with json in exactly this shape:
{"parameters":[{"name":string,"label":string,"figure":string|null,"unit":string,"quote":string|null,"expression":string|null,"assumption":string|null}],
 "items":[{"section":string,"element":string,"description":string,"unit":string,"lines":[{"location":string|null,"times":string|null,"dimensions":[string],"deduct":boolean}]}],
 "gaps":[string]}`
  /* One prompt on every platform. This file is stored with LF and checked out with CRLF on
     Windows, so the literal above carries whichever the checkout has, while the rubric sections
     interpolated into it always carry LF - a dev machine would otherwise send a mixed prompt that
     production never sees. Normalising here costs nothing and makes the bytes the same
     everywhere. */
  .replace(/\r\n/g, "\n");

/**
 * The prompt as assembled, for the rubric's parity test.
 *
 * Exported so `domain/rubric.test.ts` can prove the agent is given the rubric's exact words rather
 * than a paraphrase of them. Nothing else should read it: the prompt is an implementation detail
 * of this module, and the rubric is the thing other code is meant to depend on.
 */
export const SYSTEM_FOR_TEST = SYSTEM;

export interface DrawingPassage {
  documentId: string;
  documentName: string;
  documentKind: string;
  page: number | null;
  body: string;
}

export interface Measurement extends CheckedTakeoff {
  usage: Usage;
  /** What the drawings require that the measurement could not reach - named, never dropped. */
  gaps: string[];
  drawings: { id: string; name: string }[];
  /** True where the drawings ran past what one measurement reads. */
  partial: boolean;
}

/** The project's drawings, and any written documents beside them, as the text the model is shown. */
export async function drawingPassages(projectId: string, only?: readonly string[]): Promise<DrawingPassage[]> {
  const rows = await db
    .select({ documentId: documents.id, documentName: documents.filename, documentKind: documents.kind, page: passages.page, body: passages.body, seq: passages.seq })
    .from(passages)
    .innerJoin(documents, eq(documents.id, passages.documentId))
    .where(and(eq(passages.projectId, projectId), isNull(documents.deletedAt)))
    .orderBy(asc(documents.createdAt), asc(passages.seq));
  /*
    A chosen subset, where one was chosen.

    The written documents beside the drawings are kept whatever the choice: a specification is not
    a sheet somebody picks, it is what the sheets are measured against, and dropping it would
    change how the chosen drawings are read.
  */
  const wanted = only && only.length > 0 ? new Set(only) : null;
  const kept = wanted ? rows.filter((r) => !isSpatial(r.documentKind) || wanted.has(r.documentId)) : rows;

  // Drawings first: they are what is measured; a specification beside them only describes it.
  return [...kept.filter((r) => isSpatial(r.documentKind)), ...kept.filter((r) => !isSpatial(r.documentKind))];
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, "");

/**
 * The figure found in the drawings by the characters on either side of it.
 *
 * Text extracted from a drawing runs dimension strings together ("2500100 230 360690Wall
 * Height50"), and a model retyping that rarely gets every character. What proves a figure came
 * from the drawing is the figure with its immediate neighbours – at least eight characters of the
 * drawing's own context beside it, found verbatim in a passage that was sent. Spaces are ignored
 * on both sides, since the extraction itself is inconsistent about them.
 */
export function nearFigure<P extends { body: string }>(quote: string, figure: string, sent: readonly P[]): P | null {
  const q = squash(quote);
  const f = squash(figure);
  const at = q.indexOf(f);
  if (at < 0 || f === "") return null;
  const bodies = sent.map((p) => squash(p.body));
  for (const [left, right] of [[12, 12], [16, 0], [0, 16], [8, 8], [10, 0], [0, 10]] as const) {
    const window = q.slice(Math.max(0, at - left), at + f.length + right);
    if (window.length - f.length < 8) continue;
    const i = bodies.findIndex((b) => b.includes(window));
    if (i >= 0) return sent[i]!;
  }
  return null;
}

/** The model's reply read defensively – a field of the wrong type is dropped, not trusted. */
function readReply(json: unknown): { parameters: ProposedParameter[]; items: ProposedItem[]; gaps: string[] } {
  const body = (json ?? {}) as { parameters?: unknown[]; items?: unknown[] };
  const parameters = (Array.isArray(body.parameters) ? body.parameters : []).map((raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      name: asText(p.name) ?? "",
      label: asText(p.label) ?? asText(p.name) ?? "",
      figure: asText(p.figure),
      unit: asText(p.unit) ?? "",
      quote: asText(p.quote),
      expression: asText(p.expression),
      assumption: asText(p.assumption),
    };
  });
  const items = (Array.isArray(body.items) ? body.items : []).map((raw) => {
    const i = (raw ?? {}) as Record<string, unknown>;
    return {
      section: asText(i.section),
      element: asText(i.element),
      description: asText(i.description) ?? "",
      unit: asText(i.unit) ?? "",
      lines: (Array.isArray(i.lines) ? i.lines : []).map((l) => {
        const line = (l ?? {}) as Record<string, unknown>;
        return {
          location: asText(line.location),
          times: asText(line.times),
          dimensions: (Array.isArray(line.dimensions) ? line.dimensions : []).map((d) => String(d)),
          deduct: line.deduct === true,
        };
      }),
    };
  });
  /*
    What the measurement could not reach.

    Reported rather than dropped. A bill that silently leaves out the reinforcement adds up
    perfectly and is a fifth short – which is how the boundary-wall bill passed its own arithmetic
    and failed a quantity surveyor's review.
  */
  const source = (json ?? {}) as { gaps?: unknown[] };
  const gaps = (Array.isArray(source.gaps) ? source.gaps : []).flatMap((g) => {
    const text = asText(g);
    return text ? [text] : [];
  });
  return { parameters, items, gaps };
}

export async function measureDrawingsFor(projectId: string, signal?: AbortSignal, only?: readonly string[]): Promise<Measurement> {
  const all = await drawingPassages(projectId, only);
  // The drawings filed, from the documents themselves – a drawing whose text is not extracted yet
  // is still a drawing, and "none filed" would be the wrong thing to tell the person who filed it.
  const filed = await db
    .select({ id: documents.id, name: documents.filename, kind: documents.kind })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), isNull(documents.deletedAt)));
  const chosen = only && only.length > 0 ? new Set(only) : null;
  const drawings = filed
    .filter((d) => isSpatial(d.kind) && (chosen === null || chosen.has(d.id)))
    .map(({ id, name }) => ({ id, name }));
  const drawingIds = new Set(drawings.map((d) => d.id));

  const sent: DrawingPassage[] = [];
  let used = 0;
  for (const p of all) {
    if (used + p.body.length > MAX_CHARS) break;
    sent.push(p);
    used += p.body.length;
  }
  const partial = sent.length < all.length;

  if (drawings.length === 0 || !sent.some((p) => drawingIds.has(p.documentId))) {
    return { parameters: [], items: [], refused: [], gaps: [], usage: { input: 0, output: 0 }, drawings, partial: false };
  }

  const user = sent.map((p, i) => fence(`[${i + 1}] ${p.documentName}${p.page ? `, sheet ${p.page}` : ""} (${p.documentKind})`, p.body)).join("\n\n");
  const locate = (quote: string, figure: string) => {
    const found = locateQuote(quote, sent);
    if (found) return { documentId: found.passage.documentId, page: found.passage.page };
    const near = nearFigure(quote, figure, sent);
    return near ? { documentId: near.documentId, page: near.page } : null;
  };
  const drawingText = `Measure the take-off from these drawings. Reply in json.

${user}`;

  const first = await askForJson({ purpose: "measure.drawings", system: SYSTEM, user: drawingText, maxTokens: 8_000, timeoutMs: 240_000, signal });
  const firstReply = readReply(first.json);
  let checked = checkTakeoff(firstReply, locate);
  let gaps = firstReply.gaps;
  let usage: Usage = { ...first.usage };

  /*
    One repair round. A refusal says exactly what was wrong – a figure with no quote, a line with
    the wrong number of dimensions, a name that was never defined – which is what a checker would
    hand back to the person who measured it. So the model is shown its own take-off and the
    refusals, once, and asked to correct them. The corrected take-off is checked from scratch, and
    kept only if it measures more and is refused less; a repair is never taken on trust either.
  */
  if (checked.refused.length > 0) {
    const refusals = checked.refused.map((r) => `- ${r.what}: ${r.reason}`).join("\n");
    const second = await askForJson({ purpose: "measure.drawings",
      system: SYSTEM,
      user: `${drawingText}

Your previous take-off was:
${JSON.stringify(first.json)}

The checker refused these, and every line that depended on them:
${refusals}

Correct them – quote figures exactly, state unlabelled figures as assumptions, write derived figures as expressions, give each line the right number of dimensions – and reply with the whole corrected take-off in the same json shape.`,
      maxTokens: 8_000,
      timeoutMs: 240_000,
      signal,
    }).catch(() => null);
    if (second) {
      // `addUsage`, so a take-off measured by the stronger model is priced at its own rates.
      usage = addUsage(usage, second.usage);
      const secondReply = readReply(second.json);
      const repaired = checkTakeoff(secondReply, locate);
      if (repaired.items.length > checked.items.length || (repaired.items.length === checked.items.length && repaired.refused.length < checked.refused.length)) {
        checked = repaired;
        gaps = secondReply.gaps;
      }
    }
  }

  return { ...checked, gaps, usage, drawings, partial };
}
