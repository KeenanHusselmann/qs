/**
 * The advisor, asked a question — grounded in this project's own documents.
 *
 * ── Two channels, and the difference between them is the whole design ──────────────────────
 *
 * The advisor may not state a figure. That rule is not negotiable and it is not new: every number
 * on this platform traces to a document and a signature (§1.3.1), and a number whose first
 * appearance is a chat panel has neither. `advisor.ts` enforces it on counsel, and it is enforced
 * here too.
 *
 * But a quantity surveyor asking "how many units?" needs an answer, and "I cannot tell you" would
 * make this a worse product for the sake of a rule that was never aimed at it. So the answer has
 * **two channels**, and only one of them is the model's:
 *
 *   `answer`   the model's own words. Figure-free, enforced by the same guard the counsel uses.
 *              It says *where* the figure is and what it governs — never what it is.
 *   `sources`  passages read out of the database, verbatim, each with its document and page.
 *              The figure reaches the reader here, with full provenance, exactly the way a run
 *              row's citation already carries one.
 *
 * The reader gets the number. The model never said it. That is not a loophole in the rule — it is
 * the rule working: a figure is allowed to reach a person when it arrives attached to the page it
 * was read from, and forbidden when it arrives as an assertion.
 *
 * ── Grounded, and scoped in the query ──────────────────────────────────────────────────────
 *
 * Retrieval is `search()`, which scopes to one project **in SQL** rather than by asking the model
 * nicely. A passage from another scheme surfacing in this one's answer is the failure that would
 * end trust in the platform, and a prompt instruction is not a boundary.
 *
 * With nothing retrieved, the answer says so and stops. A model asked a question about documents
 * it was not given will answer from what it knows about South African practice in general, which
 * is a plausible paragraph about somebody else's project.
 */

import { ModelUnavailable, askForJson, type Usage } from "@/lib/agent/deepseek";
import { fence } from "@/lib/egress/fence";
import { statesFigure, briefText, type Brief } from "@/lib/agent/advisor";
import { search, searchForExtraction, type Passage } from "@/lib/ingest/retrieve";
import { runTool, toolMenu, toolText, type ToolResult } from "@/lib/agent/tools";
import { readTakeOffQuestion, readTakeOffRequest, resourceTakeOff } from "@/lib/agent/resource-take-off";
import { rateLookup, readRateQuestion } from "@/lib/agent/rate-lookup";
import type { LibraryRate } from "@/lib/rates";
import type { ResourceFactor } from "@/lib/factors";
import type { SignedStep } from "@/lib/agent/persist";
import { policyText, searchPolicies, type PolicyCitation } from "@/lib/agent/policy";
import { memoryText, notesUsed, type RecalledNote } from "@/lib/agent/memory";
import { PROJECT_NAV } from "@/lib/navigation";
import { AREAS } from "@/lib/process-library";

/** A passage as the reader sees it — the document's own words, and where they are. */
export interface Source {
  documentId: string;
  document: string;
  page: number | null;
  quote: string;
  /** True for a file the reader attached to this question, which is not filed on the project. */
  attached?: boolean;
}

/** Ids given to passages from an attachment, so they can never be mistaken for a filed document. */
export const ATTACHMENT_PREFIX = "attachment:";

/** One earlier turn, as the panel sends it back. Text only — no figures are re-trusted from it. */
export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/**
 * The advisor's own professional knowledge — the channel a tester was missing.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────
 *
 * The advisor answered only from the project's passages, so a reader who copied "absorption rate"
 * off the screen and asked what it meant was told nothing in the documents matched. A QS assistant
 * that cannot explain a construction term is not an assistant. This channel explains the term, how
 * it is worked out, and where the data comes from, in the model's own words.
 *
 * ── Why it is allowed figures, and which ones it is not ────────────────────────────────────
 *
 * General knowledge needs numbers: SANS 10400, JBCC 2000, a typical escalation range. So this
 * channel may state them, and the panel labels it "General guidance, not from your documents" on
 * every answer. What it may never state is *this project's* figure: `readAnswer` drops any sentence
 * repeating a number that appears in the project's passages, so a project figure still reaches the
 * reader only as a quote with its document and page.
 */
export interface General {
  /**
   * The direct answer, in one or two sentences — what a reader who stops here needs.
   *
   * Answers were one paragraph of five sentences, and a reader had to read all of it to find the
   * one they came for. Leading with the answer and putting the detail under it is how every good
   * summary reads.
   */
  summary: string;
  /** Two to five short points worth knowing, each one line. */
  keyPoints: string[];
  /** How it is ordinarily worked out, and why it matters — the detail under the summary. */
  explanation: string;
  /** Where the data for it comes from in practice: the document, who prepares it, which authority. */
  whereToGet: string[];
  /** Where it is filed or produced in this platform, where the model could tell. */
  inPlatform: string | null;
  /**
   * Platform steps this answer points at, as links. Chosen by the model from the list it is given
   * and then checked against the platform's real steps, so a link can never lead nowhere.
   */
  steps: StepLink[];
  /** The term the question is about, for a "search the process model" link when no node matched. */
  term: string | null;
  /**
   * The process-model areas or sub-processes the question is about — "see how this is done", linked
   * to that node's own page. Chosen by the model from the library's real codes and checked against
   * them, so every link opens something.
   */
  process: ProcessLink[];
}

/** A node in the process model an answer links to. */
export interface ProcessLink {
  /** "D1.1" or "D1.1-SP-001". */
  code: string;
  name: string;
  /** Where it opens: `/process?area=…` or `/process?sp=…`. */
  href: string;
}

/** Every area and sub-process in the generic process model, by code. */
export const PROCESS_NODES: ReadonlyMap<string, ProcessLink> = new Map(
  AREAS.flatMap((area): [string, ProcessLink][] => [
    [area.code, { code: area.code, name: area.name, href: `/process?area=${encodeURIComponent(area.code)}` }],
    ...area.subProcesses.map((sp): [string, ProcessLink] => [
      sp.code,
      { code: sp.code, name: sp.name, href: `/process?sp=${encodeURIComponent(sp.code)}` },
    ]),
  ]),
);

/** The process model, as the model is shown it: areas with their sub-processes under them. */
const processMenu = (): string =>
  AREAS.map(
    (area) => `${area.code} ${area.name}\n${area.subProcesses.map((sp) => `  ${sp.code} ${sp.name}`).join("\n")}`,
  ).join("\n");

/** A step in this platform an answer links to. */
export interface StepLink {
  /** The step's path under a project — "/feasibility". */
  module: string;
  label: string;
}

/** Every built project step, by path. The only paths an answer may link to. */
export const STEP_LABELS: ReadonlyMap<string, string> = new Map(
  PROJECT_NAV.flatMap((group) => group.items)
    .filter((item) => item.built && item.href.length > 1)
    .map((item) => [item.href, item.label] as const),
);

/** The steps, as the model is shown them. */
export const stepMenu = (): string =>
  [...STEP_LABELS].map(([module, label]) => `- "${module}": ${label}`).join("\n");

/**
 * What makes an answer read like a structured summary rather than a paragraph. Shared by the project
 * advisor and the overview assistant, so both write answers the same way.
 */
export const GENERAL_INSTRUCTIONS = `PART 2 — "general": your professional knowledge, whenever it helps the reader understand or act.
Fill it for any term, concept, calculation, document type or how-to question. Leave it null only for a question purely about what a specific document says.
Write it to be SCANNED, like a good summary — short, structured, no padding:
- "summary": the direct answer in one or two plain sentences. A reader who reads nothing else should have their answer.
- "keyPoints": two to five points worth knowing, each ONE short line (under twenty words). No full stops needed.
- "explanation": how it is ordinarily worked out and why it matters, in two to four sentences. You may name standards and publications (SANS 10400, JBCC 2000, ASAQS, NHBRC) and typical industry ranges, saying "typically", but never as this project's figure.
- "whereToGet": two to five concrete sources of the data — the document, who prepares it, the authority or publication. Each one short line.
- "inPlatform": one sentence on where it goes in this platform, naming steps by their name (never a path). Null if you cannot tell.
- "steps": up to three step paths from the STEPS list that the reader should open for this, e.g. ["/feasibility"]. Empty if none applies.
- "term": the construction term the question is about, in two to four words ("absorption rate"), or null.
- "process": one or two codes from the PROCESS MODEL list — the sub-process (or, if none fits, the area) where the thing asked about is done, so the reader can see the whole process around it. A sub-process code ("D1.1-SP-001") is better than an area ("D1.1") when one fits. Use it for ANY question about a process, a document, a role or a stage. Empty only if nothing in the list relates.

PROCESS MODEL (area, then its sub-processes):
${processMenu()}

STEPS in this platform (path: name):
${stepMenu()}

FOLLOW-UPS — "followUps": two or three short questions the reader is likely to ask next, in their words ("Who prepares a market study?"). Each under twelve words.

MONEY AND RATES — wherever you write one: money always with R, a space, and a comma for decimals ("R 1 250,00"); a rate always with what it is per, after a slash ("R 150,00/hour", "R 1 250,00/m²", "12 bricks/m²"). Never a bare number that is money, and never "per" where a slash will do.`;

/** The firm's rate library and how to read it, for the take-off channel. */
export interface TakeOffRates {
  library: readonly LibraryRate[];
  options: { region?: string | null; asAt?: string };
  /** What the practice has written down. Consulted before the model, and usually instead of it. */
  factors?: readonly ResourceFactor[];
}

export interface Answer {
  /**
   * The model's words. Never contains a figure – except, where the reader attached a document, a
   * figure that document itself states, checked against its text (`figuresAllowed`).
   */
  answer: string;
  /** What the answer rests on. The figures live here, with their provenance. */
  sources: Source[];
  /** True where nothing in the corpus matched — the answer says so rather than inventing one. */
  grounded: boolean;
  /**
   * What the advisor went and computed, where it decided it needed to.
   *
   * The third channel. Its figures are exact and each one names its method, so a reader can follow
   * any of them back to a signature — which is what earns them the right to be shown at all.
   */
  tool: ToolResult | null;
  /**
   * The firm's standards bearing on the question.
   *
   * The fourth channel, and the one that is an *obligation* rather than a fact. Kept apart from
   * `sources` because "your brief states X" and "the firm requires X" are different sentences and
   * a reader must be able to tell which of the two they are allowed to disagree with.
   */
  policies: PolicyCitation[];
  /** General professional guidance, labelled as such. Null when the question needed none. */
  general: General | null;
  /** Questions the reader is likely to ask next, offered as one-click follow-ups. */
  followUps: string[];
  /**
   * Saved web findings the answer rests on, shown under it with their dates and pages. A remembered
   * price is still a web price, and older – `memory.ts` says why it is never folded in unnamed.
   */
  recalled: RecalledNote[];
  /**
   * How much of each attached file the answer read – all of it, or the parts most relevant to the
   * question where it was longer than one answer reads. Absent where nothing was attached.
   */
  attached?: AttachmentCoverage[];
  usage: Usage;
}

/**
 * Words worth searching on.
 *
 * A whole question makes a terrible tsquery: `search()` quotes each phrase for adjacency, so
 * passing "how many units are in the scheme" asks for those seven words in that order and matches
 * nothing. Passing the significant words separately asks for any of them, which is what a question
 * actually means.
 *
 * The stop list is short on purpose. It removes the words a question is *built* from — the ones
 * present in every question and therefore discriminating in none — and leaves everything domain.
 */
const STOP = new Set([
  "what", "when", "where", "which", "who", "whom", "whose", "why", "how",
  "the", "this", "that", "these", "those", "there", "here",
  "and", "but", "for", "with", "from", "into", "onto", "about",
  "are", "was", "were", "been", "being", "have", "has", "had",
  "does", "did", "can", "could", "should", "would", "will", "shall",
  "any", "all", "some", "much", "many", "more", "most", "please", "tell",
  "show", "give", "say", "know", "need", "want", "our", "your", "their",
]);

export function searchTerms(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

  // De-duplicated, and capped: a long question is not a licence to run twenty OR'd clauses.
  return [...new Set(words)].slice(0, 8);
}

/**
 * How to ask for a material take-off. Shared with the overview assistant (`onboarding.ts`), so the
 * brick question is answered by the same engine and the same rules wherever it is asked.
 */
export const TAKE_OFF_INSTRUCTIONS = `TAKE-OFF — how much material a quantity of work needs.
When the question is "how many bricks / bags of cement / litres of paint do I need for N units of
some work", reply with "takeOff" and leave "answer" empty. NEVER work it out yourself: the platform
holds the factors, does the arithmetic and prices it from the firm's own rate library, and a number
you produce instead would trace to nothing.

  "takeOff": { "work": "One-brick wall in stock brick", "unit": "m2", "quantity": "240" }

  - "work" describes the work the way a bill item would — the material and the thickness or grade,
    not just the element. "One-brick wall in stock brick", not "wall".
  - "unit" is what that work is measured in: m2 for walling and plaster, m3 for concrete, m for
    kerbing, no for items.
  - "quantity" is the figure from the question, digits only. If the reader has not given one, do
    not invent it — answer asking for the area or volume instead.

A take-off needs NO passage and NO filed document. It is computed from the platform's own factors
and the firm's rate library, so ask for it even when nothing in the corpus matched the question —
"answer only from the passages" governs what documents say, not this. Refusing a take-off for want
of a passage is always wrong.

Use it only when the reader is asking for a material quantity. A question about what something
costs per unit is a rate question, not a take-off.

Worked examples of the request, so the shape is not in doubt:
  "how many bricks for 240 m2 of one-brick wall"
      → {"work": "One-brick wall in stock brick", "unit": "m2", "quantity": "240"}
  "how much cement in 18 m3 of 25 MPa concrete"
      → {"work": "25 MPa concrete", "unit": "m3", "quantity": "18"}
  "litres of paint for 96 m2 of plastered wall, two coats"
      → {"work": "Two coats emulsion paint on plaster", "unit": "m2", "quantity": "96"}

For a take-off, "general" is null: the platform shows the computed quantities, and a typical figure written beside them would compete with the exact one.`;

const SYSTEM = (document = false) => `You are a senior South African quantity surveyor and construction professional, working as the assistant inside a QS platform. The reader may be a QS, a developer or somebody new to construction, and they may be stuck. They can ask you ANYTHING: a term they copied off the screen ("absorption rate", "bulk services contribution", "P&G"), how something is calculated, what a document is, who prepares it, where to get the data, what a step in the platform is for, or something about this project.

A question that is only a term or a short phrase means: what does this mean, and where do I get the data for it.

You answer in TWO PARTS, and keeping them apart is the most important thing you do.

PART 1 — "answer": about THIS PROJECT, from the numbered passages only.
The passages are from this project's own filed documents, and from any file the reader attached.
- Say what the documents say about the question, and cite the passages you used by number in "cites".
${
  document
    ? `- The reader attached a document and wants to know what it SAYS. State it directly: names, parties, dates, figures, quantities and conditions, each figure copied exactly as the document writes it, with the clause or section it is in. Write "the contractor is Umhlanga Construction (Pty) Ltd (clause 22)" – never "the contractor is named in clause 22". Never calculate, total, convert or estimate a figure: every number in your answer is checked against the document, and a sentence with a number the document does not write is removed.`
    : `- NEVER write a figure in "answer". Not a number, rate, total, percentage, date or quantity — not even one in the passages. The platform shows the passages underneath with their document and page, so the reader sees every figure in its own words with its source. Say WHERE a figure is and WHAT IT GOVERNS, never what it is.
  Write "the total unit count is stated in the development overview" — never "the total unit count is 240".`
}
- If the passages do not cover the question, "answer" says so in one sentence and names the document that normally would. Do not stop there — PART 2 still helps.
- If the question is about what to do next, answer from the position summary and cite nothing.

${GENERAL_INSTRUCTIONS}
- NEVER state or guess this project's own value in "general". If the reader wants their project's figure, that is PART 1.

Be direct. No "great question", no filler. Earlier turns of the conversation may be given; use them to understand a follow-up, but answer the latest question.

THE FIRM'S STANDARDS bind your advice.
Where standards are given, your answer must not contradict them, and where one governs the
question you say so — "the firm requires…" — rather than presenting it as the project's own. They
are the practice's rules, not the client's documents. Never paraphrase one as though it were a
figure; the platform shows the standard's own words beside your answer.

TOOLS — you may ask the platform to compute one thing before you answer.
These run the platform's own engines on figures somebody signed. They are exact. Use one when the
question is about a result rather than about what a document says:
${toolMenu()}

To use one, reply with its name in "tool" and leave "answer" empty. You will be asked again with
the result, and you answer then. Ask for a tool ONLY when it is the thing being asked about — if
the passages already answer the question, answer.

${TAKE_OFF_INSTRUCTIONS}

Reply as JSON:
{"answer": "...", "cites": [1, 3], "general": {"summary": "...", "keyPoints": ["..."], "explanation": "...", "whereToGet": ["..."], "inPlatform": "..." or null, "steps": ["/feasibility"], "term": "..." or null, "process": ["D1.1-SP-001"]} or null, "followUps": ["..."], "tool": "gates" or null, "takeOff": null, "memory": []}`;

/**
 * The reader asked about the project's documents specifically — the "Project documents" button.
 *
 * Only the passages count here. General knowledge is switched off, because a reader who chose to
 * search their documents wants to know what the documents say, and an explanation of the term
 * beside it would blur exactly the line they drew. The passages are shown under the answer, openable.
 */
const DOCUMENTS_MODE = `DOCUMENTS MODE — the reader chose to search THIS PROJECT'S FILED DOCUMENTS only.
- Answer PART 1 only, from the passages. Set "general" to null.
- "answer": two to four sentences on what the documents say and which document says it. Still never a figure — the passages with their figures are shown under your answer.
- If the passages do not cover the question, say so plainly and name the document that normally would.
- Cite every passage you used in "cites", most relevant first.
- Still give "followUps": two or three questions about the documents the reader might ask next.`;

export const ATTACHMENT_MODE = `ATTACHED DOCUMENT MODE — the reader attached a document and is asking about what is IN it.
- Answer PART 1 from the attached document's passages, directly and in full, the way a colleague who has just read it would: what it says, its parties, dates, figures, quantities, clauses, conditions and anything unusual.
- You MAY state figures, dates, amounts and percentages the attached document writes – copy each exactly as the document writes it (same spacing, separators and units) and say where it is (clause, section, schedule or page). NEVER calculate, add up, convert or estimate a figure, and never state one the document does not contain: the platform checks every number in your answer against the document and removes any sentence with a number that is not in it.
- "Summarise", "what is this" or "what does it say": give a structured summary in "answer" – what the document is and who it is between, its key figures and dates, the obligations and risks a quantity surveyor would flag – in up to ten sentences.
- If the passages you were given do not answer the question, say so – and, only then, that part of the document was not in front of you. When you found the answer, do not mention how much was read; the platform says that under your answer.
- Cite every passage you used in "cites". Set "general" to null unless the reader asked for general guidance as well.
- Still give "followUps": two or three questions about this document the reader might ask next.`;

/** What the panel sends beside the question. Both optional; an empty context is the old behaviour. */
export interface AskContext {
  history?: readonly Turn[];
  /** Passages read from a file attached to this question, with `ATTACHMENT_PREFIX` ids. */
  attachments?: readonly Passage[];
  /** "documents" when the reader pressed the Project documents button. */
  mode?: AskMode;
  /** Saved web findings that bear on the question (`lib/memory/notes.ts`). Not used in documents mode. */
  memory?: readonly RecalledNote[];
}

/** Ask anything, or search the project's filed documents only. */
export type AskMode = "general" | "documents";

/** Enough to follow a follow-up; more is paid for on every question and rarely read. */
const MAX_TURNS = 8;
const MAX_TURN_CHARS = 1_200;
/**
 * How much of the attached documents one answer reads – about ten thousand tokens of text.
 *
 * It used to be eight passages, shared between the files: three attachments got two passages each,
 * the opening paragraphs, and a question about clause 14 was asked of a document the model had only
 * seen the cover of. Most specifications, letters and schedules a reader attaches fit whole in this;
 * a longer one is read by the parts that bear on the question, and the answer says so.
 */
export const ATTACHED_CHARS = 40_000;
/** A document question is answered in full; a summary needs room. */
const ATTACHMENT_ANSWER_TOKENS = 2_000;

/** What of one attached file an answer read. */
export interface AttachmentCoverage {
  name: string;
  read: number;
  total: number;
}

/**
 * The attached passages an answer reads.
 *
 * All of them where they fit. Otherwise each file's first two passages – where a document says what
 * it is and who it is between – and then the passages sharing most words with the question, until
 * the budget is spent, put back in document order so the model reads them as the document runs.
 */
export function chooseAttached(
  passages: readonly Passage[],
  terms: readonly string[],
  budget: number,
  names: ReadonlyMap<string, string> = new Map(),
): { passages: Passage[]; coverage: AttachmentCoverage[]; note: string } {
  const total = passages.reduce((n, p) => n + p.body.length, 0);
  const byFile = new Map<string, Passage[]>();
  for (const p of passages) byFile.set(p.documentId, [...(byFile.get(p.documentId) ?? []), p]);

  let chosen: Passage[];
  if (total <= budget) {
    chosen = [...passages];
  } else {
    const words = [...new Set(terms.map((t) => t.toLowerCase()).filter((t) => t.length > 2))];
    const score = (p: Passage) => {
      const body = p.body.toLowerCase();
      return words.reduce((n, w) => n + (body.includes(w) ? 1 : 0), 0);
    };
    const keep = new Set<Passage>();
    let used = 0;
    const take = (p: Passage) => {
      if (keep.has(p) || used + p.body.length > budget) return;
      keep.add(p);
      used += p.body.length;
    };
    for (const list of byFile.values()) list.slice(0, 2).forEach(take);
    [...passages].sort((a, b) => score(b) - score(a)).forEach((p) => score(p) > 0 && take(p));
    // Room left over is filled from the top of each file – more of the document, in order.
    for (const list of byFile.values()) list.forEach(take);
    chosen = passages.filter((p) => keep.has(p));
  }

  const coverage = [...byFile.entries()].map(([id, list]) => ({
    name: names.get(id) ?? id,
    read: chosen.filter((p) => p.documentId === id).length,
    total: list.length,
  }));
  const partial = coverage.filter((c) => c.read < c.total);
  const note = partial.length
    ? `ONLY PART OF THE ATTACHED DOCUMENT IS IN FRONT OF YOU: ${partial.map((c) => `${c.read} of its ${c.total} parts`).join("; ")} – its opening and the parts that share words with the question. Mention this only if the answer is not in them.`
    : "";
  return { passages: chosen, coverage, note };
}

/**
 * Every number an attached document writes, in each form a reader might repeat it – "12 450 000,00"
 * and "12,450,000.00" are one figure, and so is the "15" of "15%".
 */
export function numbersIn(passages: readonly Pick<Passage, "body">[]): Set<string> {
  const found = new Set<string>();
  for (const p of passages) for (const n of numberTokens(p.body)) found.add(n);
  return found;
}

const NUMBER = /\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)*/g;

function numberTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const digits = m[0].replace(/[\s .,]/g, "");
    out.push(digits);
    // A figure written with cents is often repeated without them, and a whole one with ",00".
    const whole = m[0].replace(/[.,]\d{1,2}$/, "").replace(/[\s .,]/g, "");
    if (whole !== digits) out.push(whole);
    else out.push(`${digits}00`);
  }
  return out;
}

/**
 * Whether every figure in a sentence is one the attached documents state. A single digit – "phase
 * 2", "clause 4" – is allowed as it is everywhere; anything longer must be in the document.
 */
export function figuresAllowed(sentence: string, allowed: ReadonlySet<string>): boolean {
  return [...sentence.matchAll(NUMBER)].every((m) => {
    const digits = m[0].replace(/[\s .,]/g, "");
    return digits.length < 2 || allowed.has(digits);
  });
}

/** Room for both parts. The general part is several sentences and a list. */
const ANSWER_TOKENS = 1_200;

/**
 * Ask the advisor a question about this project.
 *
 * `brief` is passed for the same reason `advise()` computes it: where the project stands is a
 * database fact, and a model asked to infer it from prose would re-derive it with a chance of
 * error. It is given, never asked for.
 */
export async function ask(
  projectId: string,
  question: string,
  brief: Brief,
  documents: ReadonlyMap<string, string>,
  signed: readonly SignedStep[],
  signal?: AbortSignal,
  /*
    The firm's rates, for the take-off channel.

    Optional, and absent means the channel is simply not offered — a caller that cannot supply a
    library should not be able to produce a take-off with no money in it that reads like a full
    answer. Passed in rather than read here for the reason every other agent module gives: this
    file has no database, so it stays testable against a table of known rates.
  */
  takeOffRates?: TakeOffRates,
  context: AskContext = {},
): Promise<Answer> {
  const history = (context.history ?? []).slice(-MAX_TURNS);

  /*
    A follow-up borrows the words of the question before it.

    "where do I get that?" has no word worth searching on; the question it follows does. Without this
    a follow-up searched on nothing, retrieved nothing, and read as a question about no document.
  */
  const ownTerms = searchTerms(question);
  const previous = [...history].reverse().find((turn) => turn.role === "user");
  const terms =
    ownTerms.length >= 2 || !previous
      ? ownTerms
      : [...new Set([...ownTerms, ...searchTerms(previous.text)])].slice(0, 8);

  /*
    Two corpora, two queries, in parallel.

    The project's documents are scoped to this project in SQL; the firm's standards deliberately
    are not, because a standard applies to every job. They are separate tables, so neither query
    can reach the other's rows — the boundary is structural rather than a predicate somebody has
    to remember to write.
  */
  /*
    An attachment is read whole where it fits, and by the parts that bear on the question where it
    does not – with its opening kept, because that is where a document says what it is.
  */
  const chosen = chooseAttached(context.attachments ?? [], [...terms, ...searchTerms(question)], ATTACHED_CHARS, documents);
  const attached = chosen.passages;
  const attachmentMode = attached.length > 0;
  const documentsMode = context.mode === "documents" && !attachmentMode;

  /*
    A documents question retrieves wider and reads more: the reader has said the answer is in their
    filed documents, so the looser word search used for extraction is worth its extra passages.
  */
  const [filed, standards] = await Promise.all([
    terms.length === 0
      ? Promise.resolve([])
      : documentsMode
        ? searchForExtraction(projectId, terms, 8).then((found) => found.passages)
        : search(projectId, terms, 6),
    terms.length > 0 && !documentsMode ? searchPolicies(terms, 3) : Promise.resolve([]),
  ]);

  // The attachment first: a reader who attached a file is asking about it.
  const passages: Passage[] = [...attached, ...filed];

  const corpus =
    passages.length > 0
      ? `PASSAGES (from this project's filed documents, and from any file the reader attached):\n${passages
          .map((p, i) =>
            fence(
              `[${i + 1}] ${
                p.documentId.startsWith(ATTACHMENT_PREFIX)
                  ? `attached by the reader, not filed: ${documents.get(p.documentId) ?? "an attachment"}`
                  : (documents.get(p.documentId) ?? "a filed document")
              }${p.page ? `, page ${p.page}` : ""}`,
              p.body,
            ),
          )
          .join("\n\n")}`
      : "NO PASSAGE IN THIS PROJECT'S CORPUS MATCHED THE QUESTION. Part 1 says so; Part 2 still answers.";

  const conversation =
    history.length > 0
      ? `EARLIER IN THIS CONVERSATION (for context only — answer the latest question):\n${history
          .map((turn) => `${turn.role === "user" ? "Reader" : "You"}: ${turn.text.slice(0, MAX_TURN_CHARS)}`)
          .join("\n")}`
      : "";

  // The documents button asks the documents and nothing else, so saved web findings stay out of it.
  const notes = documentsMode ? [] : (context.memory ?? []);

  const base = [
    briefText(brief),
    "",
    corpus,
    "",
    policyText(standards),
    "",
    memoryText(notes),
    "",
    conversation,
    "",
    documentsMode ? DOCUMENTS_MODE : "",
    attachmentMode ? ATTACHMENT_MODE : "",
    attachmentMode ? chosen.note : "",
    "",
    `QUESTION: ${question}`,
  ]
    .filter(Boolean)
    .join("\n");

  const first = await askForJson({ purpose: "advisor.ask",
    system: SYSTEM(attachmentMode),
    user: base,
    // A document question is answered in full, and a summary is longer than a pointer to a page.
    maxTokens: attachmentMode ? ATTACHMENT_ANSWER_TOKENS : ANSWER_TOKENS,
    signal,
  });

  // The figures the attached documents state – the only ones an answer about them may repeat.
  const allowed = attachmentMode ? { figures: numbersIn(context.attachments ?? []), coverage: chosen.coverage } : undefined;

  /*
    ── The second pass, and why there is at most one ──────────────────────────────────────

    The model may ask for one computation before it answers. One, not a loop: every extra pass is
    another call the reader waits through and pays for, and none of these tools takes an argument,
    so a second one could only ever be a different tool answering a question that was not asked.
    A model that wants two is a model that has misread the question, and the honest outcome is the
    answer it can give from the one it chose.
  */
  const wanted = (first.json ?? {}) as Record<string, unknown>;

  /*
    ── The take-off, which is a tool that takes an argument ────────────────────────────────

    The tools above answer from figures somebody signed and need nothing from the model but their
    name. A take-off is different in kind: the reader's own question carries what is being built
    and how much of it, so the model's job is to *read* those out — not to compute anything.

    Tried before `runTool` because a request for both is a model that has misread the question,
    and the material quantity is the more specific reading. Its own model call for the method is
    the reason there is still at most one round trip after this: the reader waits through it.
  */
  // The model's reading first – it names the work the way a bill would – and the question's own
  // shape when the model answered in prose instead (round-2 testing, N10).
  const wantedTakeOff = takeOffRates
    ? (readTakeOffRequest(wanted.takeOff) ?? readTakeOffQuestion(question))
    : null;
  const taken = wantedTakeOff
    ? await resourceTakeOff(
        wantedTakeOff,
        takeOffRates!.library,
        takeOffRates!.options,
        signal,
        takeOffRates!.factors ?? [],
      )
    : null;

  /*
    A price question – "bricks cost zar" – is answered from the firm's Rate Library, read by its
    shape as the take-off is. It fell through to general guidance before, with the answer on file.
  */
  const priceTerms = !taken && takeOffRates ? readRateQuestion(question) : null;
  const looked = priceTerms && takeOffRates ? rateLookup(priceTerms, takeOffRates.library, { region: takeOffRates.options.region ?? null }) : null;

  const result = taken?.result ?? looked ?? runTool(wanted.tool, signed);

  if (!result) {
    return readAnswer(first.json, passages, documents, null, standards, first.usage, notes, allowed);
  }

  const second = await askForJson({ purpose: "advisor.ask",
    system: SYSTEM(attachmentMode),
    user: [base, "", toolText(result), "", "Now answer. Do not write any figure in \"answer\" — the platform shows the tool's figures underneath it."].join("\n"),
    maxTokens: ANSWER_TOKENS,
    signal,
  });

  /*
    Every call is charged, the method's included. Reporting only the last would understate what the
    question cost, and the cost line exists precisely so nobody is surprised by a bill they could
    not see forming — a take-off costs three calls and is the most expensive question here.
  */
  return readAnswer(second.json, passages, documents, result, standards, {
    input: first.usage.input + second.usage.input + (taken?.usage.input ?? 0),
    output: first.usage.output + second.usage.output + (taken?.usage.output ?? 0),
  }, notes, allowed);
}

/**
 * A passage as a quote — starting on a whole word.
 *
 * Chunking splits the corpus on length, not on language, so a retrieved passage routinely begins
 * mid-word: "nsion 9, 127 000 m²" where the document says "Extension 9". Under an answer, in
 * a blockquote, that reads as though the platform has garbled the document.
 *
 * ── Only the start, and only when it is certain ────────────────────────────────────────────
 *
 * A leading fragment is detectable: a chunk boundary that lands mid-word leaves a lowercase token
 * where a sentence or a heading would not. The *end* is not. "MZILIKAZI QUANTITY SURVEYORS" ends
 * on a whole word with no punctuation after it and looks exactly like a word cut in half, so a
 * trailing trim removes real text as often as broken text — it was written, it ate the last word
 * of a perfectly good quote, and it came out again.
 *
 * The ellipsis replaces the fragment so nobody reads the quote as the whole passage.
 */
export function quoteOf(body: string): string {
  const text = body.trim();

  const firstSpace = text.indexOf(" ");
  if (firstSpace > 0 && /^\p{Ll}/u.test(text)) {
    return `…${text.slice(firstSpace)}`.trim();
  }

  return text;
}

/**
 * Read the reply, and strip anything that broke the figure rule.
 *
 * Sentence by sentence rather than all-or-nothing. A three-sentence answer whose middle sentence
 * slipped a number in is still worth two sentences, and returning nothing over a fault the reader
 * cannot see sends them away with less than the platform knows. What is never done is *rendering*
 * the offending sentence.
 */
export function readAnswer(
  json: unknown,
  passages: readonly Passage[],
  documents: ReadonlyMap<string, string>,
  tool: ToolResult | null,
  policies: readonly PolicyCitation[],
  usage: Usage,
  notes: readonly RecalledNote[] = [],
  /** Where the reader attached documents: the figures they state, and how much of each was read. */
  attachment?: { figures: ReadonlySet<string>; coverage: AttachmentCoverage[] },
): Answer {
  const o = (json ?? {}) as Record<string, unknown>;
  const raw = typeof o.answer === "string" ? o.answer.trim() : "";

  /*
    Split on sentence ends, keeping the punctuation. A figure that survives into the panel is the
    confident untraceable number this whole product is arranged against, wearing the platform's
    own voice — so the guard runs on the output, not only in the prompt.
  */
  const kept = raw
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && (!statesFigure(s) || (attachment !== undefined && figuresAllowed(s, attachment.figures))));

  const cites = (Array.isArray(o.cites) ? o.cites : [])
    .map((n) => (typeof n === "number" ? n : Number.parseInt(String(n), 10)))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= passages.length);

  /*
    Cited passages first, then the rest of what was retrieved.

    The uncited ones are still shown: the model's choice of what to cite is a judgement, and the
    reader is the one entitled to make it. Retrieval was scoped to this project in SQL, so
    everything here is theirs to read.
  */
  /*
    About an attached document, only what the answer cites: a long document's uncited parts are
    general conditions the reader did not ask about, and listing them first buried the clause that
    answered. Everything retrieved still shows where nothing was cited.
  */
  const order =
    attachment && cites.length > 0
      ? [...new Set(cites.map((n) => n - 1))]
      : [...new Set([...cites.map((n) => n - 1), ...passages.map((_, i) => i)])];

  const sources: Source[] = order.slice(0, attachment ? 6 : 4).map((i) => {
    const p = passages[i];
    const attached = p.documentId.startsWith(ATTACHMENT_PREFIX);
    return {
      documentId: p.documentId,
      document: documents.get(p.documentId) ?? (attached ? "Attachment" : "A document no longer filed"),
      page: p.page,
      quote: quoteOf(p.body),
      ...(attached ? { attached: true } : {}),
    };
  });

  const general = readGeneral(o.general, passages);

  return {
    answer: kept.join(" "),
    sources,
    grounded: passages.length > 0,
    tool,
    policies: [...policies],
    general,
    followUps: readFollowUps(o.followUps, passages),
    ...(attachment ? { attached: attachment.coverage } : {}),
    recalled: notesUsed(
      o.memory,
      notes,
      general ? [general.summary, ...general.keyPoints, general.explanation, ...general.whereToGet].join(" ") : "",
    ),
    usage,
  };
}

/**
 * Follow-up questions, held to the same figure guard as the general channel: a suggested question
 * must not smuggle a project figure into the panel in the model's voice.
 */
export function readFollowUps(raw: unknown, passages: readonly Pick<Passage, "body">[]): string[] {
  const project = figuresIn(passages);
  return (Array.isArray(raw) ? raw : [])
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter(
      (q) =>
        q.length > 3 &&
        q.length <= 120 &&
        ![...q.matchAll(/\d[\d\s,.]*\d/g)].some((m) => project.has(m[0].replace(/[\s,.]/g, ""))),
    )
    .slice(0, 3);
}

/**
 * The numbers a project's passages state, as digit strings — "1 046" and "1046" are one figure.
 *
 * Only numbers of two digits or more. A single digit is "phase 2" or "class 4" as often as it is a
 * figure, and dropping every general sentence that mentions one would gut the explanation to guard
 * against almost nothing.
 */
export function figuresIn(passages: readonly Pick<Passage, "body">[]): Set<string> {
  const figures = new Set<string>();
  for (const passage of passages) {
    for (const match of passage.body.matchAll(/\d[\d\s,.]*\d/g)) {
      const digits = match[0].replace(/[\s,.]/g, "");
      if (digits.length >= 2) figures.add(digits);
    }
  }
  return figures;
}

/**
 * The general channel, held to the one rule it keeps: it may not repeat this project's figures.
 *
 * Sentence by sentence, as with `answer`. A sentence repeating a number from the passages is dropped
 * — "the absorption rate here is 12-15 units a month" is a project figure in the model's voice,
 * which is exactly what this platform forbids. A standard's number ("SANS 10400") survives unless the
 * project's documents happen to state the same digits, which costs one sentence at worst.
 */
export function readGeneral(raw: unknown, passages: readonly Pick<Passage, "body">[]): General | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const project = figuresIn(passages);

  const repeatsProjectFigure = (text: string) =>
    [...text.matchAll(/\d[\d\s,.]*\d/g)].some((m) => project.has(m[0].replace(/[\s,.]/g, "")));

  const clean = (text: unknown): string =>
    (typeof text === "string" ? text : "")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !repeatsProjectFigure(s))
      .join(" ");

  const list = (value: unknown, max: number) =>
    (Array.isArray(value) ? value : [])
      .map(clean)
      .filter((s) => s.length > 0)
      .slice(0, max);

  const summary = clean(g.summary);
  const keyPoints = list(g.keyPoints, 5);
  const explanation = clean(g.explanation);
  const whereToGet = list(g.whereToGet, 6);
  const inPlatform = clean(g.inPlatform);
  const term = typeof g.term === "string" ? g.term.trim().slice(0, 60) : "";

  // Only paths the platform actually has. A link to a step that does not exist is a dead end.
  const steps = [
    ...new Set((Array.isArray(g.steps) ? g.steps : []).filter((s): s is string => typeof s === "string")),
  ]
    .filter((module) => STEP_LABELS.has(module))
    .slice(0, 3)
    .map((module) => ({ module, label: STEP_LABELS.get(module)! }));

  if (!summary && !explanation && keyPoints.length === 0 && whereToGet.length === 0) return null;

  const present = (s: string) => (s.length > 0 && s.toLowerCase() !== "null" ? s : null);

  return {
    summary,
    keyPoints,
    explanation,
    whereToGet,
    inPlatform: present(inPlatform),
    steps,
    term: present(term),
    process: [
      ...new Set((Array.isArray(g.process) ? g.process : []).filter((c): c is string => typeof c === "string").map((c) => c.trim())),
    ]
      .filter((code) => PROCESS_NODES.has(code))
      .slice(0, 2)
      .map((code) => PROCESS_NODES.get(code)!),
  };
}

/**
 * Ask, and refuse to return an empty answer.
 *
 * If every sentence stated a figure there is nothing to show, and a blank panel would read as the
 * advisor having no opinion rather than as the guard having fired. §1.3: surfaced, never silent.
 */
export async function askOrExplain(
  projectId: string,
  question: string,
  brief: Brief,
  documents: ReadonlyMap<string, string>,
  signed: readonly SignedStep[],
  signal?: AbortSignal,
  takeOffRates?: TakeOffRates,
  context: AskContext = {},
): Promise<Answer> {
  const result = await ask(projectId, question, brief, documents, signed, signal, takeOffRates, context);

  if (result.answer.length === 0 && result.sources.length === 0 && !result.tool && !result.general) {
    throw new ModelUnavailable(
      "The advisor answered, but nothing in the reply could be shown — it stated figures rather " +
        "than pointing at them, and a figure from the advisor traces to no document. Ask again, " +
        "or open the document the figure would be in.",
    );
  }

  return result;
}
