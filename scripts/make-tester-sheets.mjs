#!/usr/bin/env node
/**
 * Build the tester workbook and the Ridgeview test pack.
 *
 *     node scripts/make-tester-sheets.mjs
 *
 *     node scripts/make-tester-sheets.mjs --round=3
 *
 * Writes `testing/QS Platform UAT Testing – round 2.xlsx` (or round 3, whose content is in
 * `lib/uat-round3.mjs`) and `testing/Ridgeview test pack.zip`.
 *
 * The shape follows the round-1 workbook (`testing/QS Platform UAT Testing.xlsx`, Luke Johannisen,
 * September 2026): a How to use sheet with the tester's details and an acceptance block, tests in
 * plain columns – What we are testing · How to test · What should happen · Result · Comments – and an
 * Issues sheet. Round 1's 43 core checks are kept as a regression sheet (`lib/uat-core.json`), and
 * its seven findings open the Issues sheet, each pointing at the test that confirms its fix.
 *
 * ── Why a generator and not a hand-kept spreadsheet ────────────────────────────────────────
 *
 * The expected figures in the junior QS scenarios are the Ridgeview scheme's, and those live in
 * `lib/test-scheme.mjs`. Typing them into a spreadsheet by hand is how a tester ends up marking a
 * correct platform "Fail" against a stale number. So every scheme figure below is read from the
 * scheme, and re-running this after the scheme changes keeps the sheet honest.
 *
 * ── Why the workbook is written by hand ────────────────────────────────────────────────────
 *
 * An .xlsx is a zip of XML, and jszip is already in the tree. A spreadsheet library would be a
 * dependency for one script. What testers need from it is small: wrapped text, a header that stays
 * put, a filter, and a Status column that only accepts the five statuses.
 */

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import JSZip from "jszip";

import { SCHEME as S, money, number } from "./lib/test-scheme.mjs";
import { round3 } from "./lib/uat-round3.mjs";

/** Round 1's core acceptance checks, as they were run – re-run as a regression sheet. */
const CORE = JSON.parse(readFileSync(new URL("./lib/uat-core.json", import.meta.url), "utf8"));

const OUT = "testing";
const APP = "https://qs-management-platform-lilac.vercel.app";
const PACK = "Ridgeview test pack.zip";
/** The commit this workbook was made from – what "Version or build" is pre-filled with. */
const BUILD = (() => {
  try {
    return execSync("git log -1 --format=%h·%ad --date=short", { encoding: "utf8" }).trim().replace("·", " · ");
  } catch {
    return "";
  }
})();
/** Where the workbook and the test pack live for testers – a shared Google Drive folder. */
const DRIVE = "https://drive.google.com/drive/folders/10qbcgswWzmHUmi83ruoDbpx3GLE2hvea?usp=drive_link";

const R = (amount, decimals = 0) => money(amount, decimals).replace(/ /g, " ");
const N = (value, decimals = 0) => number(value, decimals).replace(/ /g, " ");
const steps = (...lines) => lines.map((line, i) => `${i + 1}. ${line}`).join("\n");
const bullets = (...lines) => lines.map((line) => `• ${line}`).join("\n");

const item = (id) => S.bill.flatMap((s, si) => s.items.map((it, ii) => ({ ...it, ref: `${si + 1}.${ii + 1}` }))).find((x) => x.ref === id);

// ── The columns ─────────────────────────────────────────────────────────────────────────────

const STATUSES = ["Pass", "Fail", "Blocked", "Needs review", "Not tested"];
const SEVERITIES = ["Minor", "Major", "Critical"];
const ISSUE_STATUSES = ["Open", "Fixed – confirm", "Fixed", "Not a defect", "Won't fix"];

/** What a tester fills in, the same on every sheet – round 1's columns, plus a place for evidence. */
const TESTER_COLUMNS = [
  { key: "status", title: "Result", width: 14, status: true },
  { key: "actual", title: "Comments — what you actually saw", width: 44 },
  { key: "evidence", title: "Screenshot / recording link", width: 28 },
];

const FIX_COLUMNS = [
  { key: "id", title: "ID", width: 7 },
  { key: "area", title: "Area", width: 16 },
  { key: "title", title: "What we are testing", width: 34 },
  { key: "pre", title: "Before you start", width: 28 },
  { key: "data", title: "Test data", width: 28 },
  { key: "steps", title: "How to test", width: 52 },
  { key: "expected", title: "What should happen", width: 52 },
  ...TESTER_COLUMNS,
];

const NEW_COLUMNS = FIX_COLUMNS;

const SCENARIO_COLUMNS = [
  { key: "id", title: "ID", width: 7 },
  { key: "stage", title: "QS stage", width: 20 },
  { key: "title", title: "What we are testing", width: 32 },
  { key: "role", title: "As a junior QS I want to…", width: 34 },
  { key: "pre", title: "Before you start", width: 28 },
  { key: "data", title: "Test data", width: 30 },
  { key: "steps", title: "How to test", width: 56 },
  { key: "expected", title: "What should happen — figures to check", width: 60 },
  { key: "repro", title: "Your professional check (optional)", width: 40 },
  ...TESTER_COLUMNS,
];

const CORE_COLUMNS = [
  { key: "id", title: "ID", width: 7 },
  { key: "area", title: "Area", width: 16 },
  { key: "title", title: "What we are testing", width: 34 },
  { key: "how", title: "How to test", width: 56 },
  { key: "expected", title: "What should happen", width: 56 },
  { key: "round1", title: "Round 1 result", width: 14 },
  ...TESTER_COLUMNS,
];

// ── Sheet 1 – fixes to confirm ─────────────────────────────────────────────────────────────

const RIDGEVIEW = "Project “Ridgeview Gardens” (or a TEST copy) with the Ridgeview test pack filed";

const FIXES = [
  {
    id: "R01", area: "Project setup", title: "A loading screen shows while a project is being created",
    pre: "Signed in, on Projects", data: "Project name e.g. “TEST – Loading screen”",
    steps: steps("Click Add project.", "Enter a name, click Next.", "Pick Feasibility & Inception, click Next.", "Click Create."),
    expected: "“Creating the project…” covers the dialog straight away and stays until the project overview opens. The dialog cannot be closed while it is creating.",
    repro: "After clicking Create nothing visible happened until the overview appeared.",
  },
  {
    id: "R02", area: "Advisor", title: "The advisor explains any construction term, not a fixed template",
    pre: "Any project open, advisor panel open", data: "“What is retention?”  “What does absorption rate mean?”  a term copied off the dashboard, e.g. “Cost per m² GFA”",
    steps: steps("Make sure “Ask anything” is selected under the chat box.", "Ask each question.", "Paste the copied term on its own and send."),
    expected: bullets("A short direct answer in bold, then key points", "“How it works” and “Where to get the data”", "“In this platform” with links to the right steps", "Two or three “Ask next” follow-up questions", "Different, relevant content for each term"),
    repro: "Answers were fixed, generic text.",
  },
  {
    id: "R03", area: "Job card", title: "Next step no longer jumps back to an earlier step",
    pre: `${RIDGEVIEW}; Feasibility Estimate and Cost Plan signed off`, data: "Ridgeview Gardens",
    steps: steps("Open the project overview and note the Job card’s Next move.", "Open Valuations from the sidebar, then return to the overview.", "Open the step named in Next move, then return."),
    expected: "Next move names the earliest step still open, in phase order (for example Bill of Quantities once the cost plan is signed). It never names a signed step and does not change just because you visited another page.",
    repro: "Pressing Next on step 1 while working on step 4 sent the user to step 2.",
  },
  {
    id: "R04", area: "Advisor", title: "Chat box takes attachments and is bigger",
    pre: "Any project, advisor open", data: "Any PDF or Word file under 4 MB (e.g. “Project brief.pdf” from the test pack); a long paragraph of text",
    steps: steps("Click the paperclip and attach the file.", "Drag a second file onto the chat box.", "Paste the long paragraph.", "Ask “What does this document say about the unit count?”"),
    expected: "Files show as removable chips (maximum 3). The box grows as you type. The answer reads the attachment and offers to file it in the project.",
    repro: "No attachments; the box was one small line.",
  },
  {
    id: "R05", area: "Extraction", title: "Figures stated in the document’s own words are extracted",
    pre: "New TEST project at Feasibility & Inception", data: "A Word document stating “The total unit count is 240” and “absorption rate (12–15 units/month)”, filed as Project brief (and another as Market study)",
    steps: steps("File the document(s) in the Project Corpus.", "Open Feasibility Estimate and run it."),
    expected: "Total unit count = 240 and Absorption rate = 12–15 units/month, each with the quote it came from. Not “No passage in the filed documents mentions this”.",
    repro: "Tester feedback: 240 units and the absorption rate were ignored.",
  },
  {
    id: "R06", area: "Requirements", title: "A document does not need the platform’s exact wording to tick a requirement",
    pre: "TEST project at Feasibility & Inception", data: "A sales outlook document that states selling prices and an absorption rate but never says “market study”, filed as Market study",
    steps: steps("File the document as Market study.", "Open Feasibility Estimate.", "Reload the page once or twice (the document is read in the background)."),
    expected: "“Market data” ticks, with a quote from your document as the evidence. A document of the wrong kind (e.g. a cost plan filed as a programme) must NOT tick it.",
    repro: "Uploads for Feasibility only counted when the specific wording was used.",
  },
  {
    id: "R07", area: "Process model", title: "Process model drills down through the generic BPMN levels",
    pre: "Signed in", data: "–",
    steps: steps("Open Process model from the sidebar.", "Click a phase, then a domain, an area, a sub-process, then a task.", "Use the breadcrumb to go back up.", "Search for “variation”."),
    expected: "Each level lists the level below with its description. A sub-process shows its BPMN flow including the decision point. A task shows inputs, outputs and who does it. Nothing on it is specific to one project.",
    repro: "Buttons were specific to the platform, not the generic process levels.",
  },
  {
    id: "R08", area: "Overview assistant", title: "The main overview’s chat box grows with the text", pre: "Signed in, home overview (/)", data: "Several lines of text",
    steps: steps("Type or paste several lines into the assistant’s box."), expected: "The box grows up to about a third of the screen, then scrolls inside itself.", repro: "The box stayed one line high.",
  },
  {
    id: "R09", area: "Advisor", title: "No white band covers the bottom of the chat box", pre: "Any project page, advisor open", data: "Screen 1366×768 and 1440×900",
    steps: steps("Open a project page with the advisor open.", "Scroll the page to the bottom."), expected: "The chat box and “Enter to send” line are fully visible. No white strip covers them and the page never shows blank space below the app.", repro: "A white footer band covered the bottom of the chat box inside projects.",
  },
  {
    id: "R10", area: "Advisor", title: "The chat box has one clean focus outline", pre: "Advisor open", data: "–",
    steps: steps("Click into the chat box."), expected: "One blue ring around the whole box. No second green outline inside it.", repro: "Box outlines looked doubled and messy.",
  },
  {
    id: "R11", area: "Advisor", title: "Widening the advisor does not overflow the page", pre: "Advisor open with an answer showing", data: "Screen 1280 px wide",
    steps: steps("Click the widen (maximise) icon in the advisor header.", "Click it again to narrow."), expected: "The panel widens; nothing on the page or in the panel spills sideways or needs a horizontal scroll.", repro: "Content overflowed when the advisor was enlarged.",
  },
  {
    id: "R12", area: "Advisor", title: "The brick question is offered and answered", pre: "Advisor, new conversation (pencil icon)", data: "Suggested question “How many bricks for 240 m² of one-brick wall?”",
    steps: steps("Start a new conversation.", "Click the brick suggestion."), expected: "A take-off card with the number of bricks and the mortar, each line showing its rate and source from the firm’s rate library, written as R …/unit.", repro: "The brick question was not among the suggestions.",
  },
  {
    id: "R13", area: "Advisor", title: "Thinking dots animate smoothly", pre: "Advisor open", data: "Any question; repeat with Windows Settings → Accessibility → Animation effects OFF",
    steps: steps("Ask a question and watch the three dots while it thinks.", "Turn animation effects off and ask again."), expected: "Dots pulse smoothly in sequence. With animations off they fade gently – no flicker or strobing.", repro: "Dots glitched instead of animating.",
  },
  {
    id: "R14", area: "Advisor", title: "An explicit Project documents mode", pre: RIDGEVIEW, data: "“What is the contract sum?”",
    steps: steps("Select “Project documents” under the chat box.", "Ask the question.", "Click a source under the answer."),
    expected: "The answer says which document states it (Signed contract) and lists the passages it read. Clicking a source opens that document.", repro: "No way to ask the documents specifically.",
  },
  {
    id: "R15", area: "Formatting", title: "Money shows R and rates show a slash", pre: "Advisor and Bill of Quantities", data: "Brick question (R12); Ridgeview bill",
    steps: steps("Read money and rates in an advisor answer, the take-off card and the bill."), expected: "Money as R 1 250,00 (space thousands, comma decimals). Rates with their unit after a slash: R 385,00/m², R 150,00/hour. No bare money figures.", repro: "Money and rates were shown inconsistently.",
  },
  {
    id: "R16", area: "Project overview", title: "Overview is short, advisor opens on arrival, new robot logo", pre: "Screen at least 1024 px wide", data: "Any project",
    steps: steps("Open a project from Projects."), expected: "No KPI tiles. The Job card is the page. The advisor panel is open. The advisor and Job card use the construction-robot (hard hat) mark.", repro: "Overview repeated the dashboard KPIs.",
  },
  {
    id: "R17", area: "Advisor", title: "Process questions link to the process model", pre: "Advisor, Ask anything", data: "“How does the variation order process work under JBCC?”",
    steps: steps("Ask the question.", "Click a link under “See the full process”."), expected: "Links to the relevant sub-processes (e.g. D1.6-SP-001 Proposed Variation Estimate). The link opens the Process model at that sub-process.", repro: "The advisor never pointed to the process model.",
  },
  {
    id: "R18", area: "Project overview", title: "Only the Job card – no “Where this project stands” board", pre: "Any project", data: "Ridgeview Gardens",
    steps: steps("Open the project overview."), expected: "One Job card with status line, Next move and Phases. No separate stage board below it.", repro: "Large stage cards made the page long.",
  },
  {
    id: "R19", area: "Job card", title: "The Job card no longer has an Ask button", pre: "Project overview", data: "–",
    steps: steps("Look at the Job card header.", "Close the advisor, then open it from its tab on the right edge."),
    expected: "No Ask button on the Job card. The advisor opens from its own tab and the chat box works as normal.",
    repro: "Ask appeared to do nothing, and was then removed as unnecessary.",
  },
  {
    id: "R20", area: "Search", title: "Search pop-up border does not overflow", pre: "Any page", data: "–",
    steps: steps("Press Ctrl+K or click Search in the top bar."), expected: "The search input sits cleanly in its row; no green border running outside it.", repro: "A green border overflowed the input.",
  },
  {
    id: "R21", area: "Job card", title: "Each phase says what is still outstanding", pre: RIDGEVIEW, data: "Ridgeview Gardens",
    steps: steps("On the Job card click the Design & Documentation tile."),
    expected: "The phase opens under the tiles: “Design & Documentation needs · N outstanding”, then five deliverables, each marked Signed off, Filed or Outstanding. Work the platform does not track says “Not tracked in the platform yet”.",
    repro: "The phase read 0/1 as if it were one step from done.",
  },
  {
    id: "R22", area: "Advisor", title: "The Web button clearly shows on and off", pre: "Advisor open", data: "–",
    steps: steps("Click Web.", "Attach a file.", "Remove the file and click Web again."), expected: "Off: outlined “Web”. On: filled blue “Web on” and the box says the question leaves the platform. With a file attached Web is switched off and disabled.", repro: "Web stayed grey and never looked enabled.",
  },
  {
    id: "R23", area: "Advisor", title: "A new answer opens at its start", pre: "Advisor open", data: "Two long questions, e.g. “What is a bill of quantities?” then “What does practical completion mean under JBCC?”",
    steps: steps("Ask the first question, wait.", "Ask the second."), expected: "Each time the panel shows your question and the top of the answer – not the bottom or the follow-ups.", repro: "Answers opened scrolled to the bottom.",
  },
  {
    id: "R24", area: "Advisor", title: "Web answers are structured, with tables", pre: "Advisor open", data: "Web on; “What cement types and 50 kg bag prices are available in South Africa?”",
    steps: steps("Turn Web on and ask."), expected: "“From the web, not the practice”, a summary, key points, a price table, a caveat box and numbered sources (first four, then “N more sources”).", repro: "Web output was one dense paragraph.",
  },
  {
    id: "R25", area: "Advisor", title: "The advisor remembers what a web search found", pre: "R24 done", data: "“cement cost zar”",
    steps: steps("Start a new conversation (pencil icon).", "Leave Web OFF and ask the question.", "Open “What was found…” in the Remembered box."),
    expected: "The answer uses the earlier findings and shows “Remembered from a web search · <date>” with the price table and sources. Before this fix it said it could not find anything.",
    repro: "With web search off the advisor had no memory of an earlier search.",
  },
  {
    id: "R26", area: "Bill of Quantities", title: "The bill drafts completely and can be signed", pre: `${RIDGEVIEW}, including “Bill of quantities.pdf”`, data: "Specification.pdf, Bill of quantities.pdf, Contract instruction.pdf",
    steps: steps("Open Bill of Quantities.", "Click Draft again and wait.", "Scroll the rows and the section totals."),
    expected: `26 items, every one with a quantity and a rate; total ${R(S.billTotal, 2)}. No rows from the Contract instruction (no “Omit: vinyl…”). “Sign off as …” is enabled.`,
    repro: "16 of 18 items had no quantity or rate and sign-off was impossible.",
  },
  {
    id: "R27", area: "Sign-off", title: "Sign-offs show the person’s name, not their email", pre: "A person with a name under Settings → People signs in", data: "Any signable step",
    steps: steps("Open a step and look at the sign-off button.", "Sign it off.", "Check the step, Project Data and the dashboards."), expected: "“Sign off as <Name>”, then “Signed off by <Name>” everywhere. No email addresses as the signer.", repro: "Sign-offs showed email addresses.",
  },
  {
    id: "R28", area: "Job card", title: "The Job card fits the screen without scrolling", pre: "Any project", data: "Screens 1366×768, 1440×900, 1600×1000",
    steps: steps("Open the overview at each size.", "Open the phase with the most items."), expected: "The page does not scroll; the phase list scrolls inside the card. The card is wider than before.", repro: "The Job card made the page scroll.",
  },
  {
    id: "R29", area: "Requirements", title: "A hand tick stays ticked", pre: "TEST project, step page with a declarable requirement and nothing filed for it", data: "E.g. Project Inputs → Stakeholder register",
    steps: steps("Tick the requirement.", "Wait five seconds.", "Reload the page.", "Untick it and reload."), expected: "The tick stays at every point, and the untick stays too.", repro: "Tick appeared, disappeared, then appeared again.",
  },
  {
    id: "R30", area: "Phases", title: "An earlier phase can be brought back", pre: "TEST project created at Close-out & Final Account", data: "–",
    steps: steps("On the Job card click the Construction & Delivery tile (it reads “Not run”).", "Click “Run Construction & Delivery too”."), expected: "The tile becomes an active phase with its deliverables counted; its steps are no longer marked as outside the project in the sidebar.", repro: "No option to re-activate a previous phase.",
  },
  {
    id: "R31", area: "Dashboard", title: "Project code, client and stages moved to the dashboard", pre: "Any project", data: "Ridgeview Gardens",
    steps: steps("Open the project’s Dashboard."), expected: "Under the title: “RVG-001 · Ridgeview Housing Development Company (Pty) Ltd” and “Runs every stage · Change”. The overview shows only the name.", repro: "Moved to keep the overview short.",
  },
  {
    id: "R32", area: "Projects", title: "An archived project can always be found", pre: "A TEST project you can archive", data: "Project name e.g. “TEST – Archive me”",
    steps: steps("Open the project, go to Project Details and click Archive project.", "Go to Projects and type the project’s exact name in the Find box.", "Press Ctrl+K and type the name again.", "Open the project from either place.", "Click Restore project on the grey Archived line."),
    expected: bullets("Projects: the Archived section opens by itself and lists the project with an “Archived” label", "The message above says no working project matches but an archived one does", "Ctrl+K lists it with “Archived” in front of its code", "Every page of the project shows a grey “Archived” line with a Restore project button", "After Restore it is back in the working list"),
    repro: "Once archived the project had no label and could not be found by searching – “almost as though it was deleted”.",
  },
  {
    id: "R33", area: "Bill of Quantities", title: "Quantities written with a comma are read", pre: "New TEST project at Design & Documentation", data: "A Word or PDF bill with lines such as “Plaster to internal walls 12,940 m² @ R 385,00” and “Brick paving 1,250 m²”",
    steps: steps("File the document as a Bill of quantities in the Project Corpus.", "Open Bill of Quantities and click Draft.", "In any row measured in m², type 2,500 in the Quantity cell.", "In a row measured in t (tonnes), type 1,250 in the Quantity cell."),
    expected: bullets("12,940 m² reads as 12 940 and 1,250 m² as 1 250 – not blank", "Typed 2,500 on an m² row reads as 2 500", "On a tonnes row 1,250 is refused with a message, because 1,25 t and 1 250 t are both ordinary – type 1 250 or 1,25", "Quantities written 12 940 (the South African form) read as before"),
    repro: "Any quantity over 999 written with a comma was left blank as ambiguous, so the bill had to be typed by hand.",
  },
];

// ── Sheet 2 – new changes ─────────────────────────────────────────────────────────────────

const NEW = [
  {
    id: "N01", area: "Project setup", title: "Switch earlier phases on while creating a project", pre: "Projects page", data: "“TEST – Phases at setup”",
    steps: steps("Add project, enter the name, Next.", "Pick Close-out & Final Account.", "Click “Run it too” on Design & Documentation and Construction & Delivery.", "Next, Create."),
    expected: "Those two rows read “also run”. On the new project’s Job card: Design & Documentation, Construction & Delivery and Close-out are active; the others read “Not run”.",
    repro: "A project could only run its starting phase and everything after it.",
  },
  {
    id: "N02", area: "Project setup", title: "A cancelled choice does not carry into the next project", pre: "Projects page", data: "–",
    steps: steps("Add project, name, Next, pick Construction & Delivery, click “Run it too” on Feasibility.", "Press Esc to cancel.", "Add project again, pick Construction & Delivery, create."),
    expected: "The new project runs Construction & Delivery onward only; Feasibility reads “Not run”.", repro: "Found while building N01.",
  },
  {
    id: "N03", area: "Job card", title: "Phases show only their titles until one is opened", pre: "Any project", data: "–",
    steps: steps("Open the project overview.", "Click a phase tile.", "Click the same tile again."),
    expected: "On arrival only the phase titles show – no counts, no open list. A click opens that phase’s deliverables and steps; a second click folds it.",
    repro: "The phases showed too much information on load.",
  },
  {
    id: "N04", area: "Job card", title: "A phase that is not run still shows its steps", pre: "TEST project at Construction & Delivery", data: "–",
    steps: steps("Click the Feasibility & Inception tile.", "Open one of the listed steps."), expected: "The panel says the project does not run it, lists its deliverables and its steps under “Steps set aside, and still reachable”, and the step opens normally.", repro: "Set-aside steps used to sit in a separate list under the card.",
  },
  {
    id: "N05", area: "Advisor memory", title: "Forget a remembered web finding", pre: "R25 done", data: "“cement cost zar”",
    steps: steps("In the Remembered box open “What was found…”.", "Click “Forget this – it is wrong or out of date”.", "New conversation, ask again with Web off."), expected: "It says “Forgotten”. The next answer does not show that remembered finding.", repro: "New.",
  },
  {
    id: "N06", area: "Advisor memory", title: "Findings are shared across the practice, never mixed into Project documents mode", pre: "R24 done in project A", data: "A different project B",
    steps: steps("In project B ask “cement cost zar” with Web off.", "Switch to Project documents and ask the same."), expected: "Ask anything shows the remembered finding from project A. Project documents mode does not use it and answers only from B’s documents.", repro: "New.",
  },
  {
    id: "N07", area: "Bill of Quantities", title: "A bill drafted from a specification explains why nothing is measured", pre: "TEST project with only Specification.pdf filed", data: "Specification.pdf",
    steps: steps("Open Bill of Quantities and draft.", "Reload the page."), expected: "22 items (one per specification clause), each with a unit and no quantity or rate. An amber notice says the documents describe the work without measuring it and what to do. It is still there after the reload.", repro: "Empty cells looked like the extraction had failed.",
  },
  {
    id: "N08", area: "Bill of Quantities", title: "Totals and summary lines are not proposed as items", pre: "Ridgeview with Bill of quantities.pdf", data: "Bill of quantities.pdf",
    steps: steps("Draft the bill.", "Look for rows named “Total of …”, “Summary” or the bill total."), expected: "None of them appear as items. Section totals in the grid are calculated from the items and match the PDF’s section totals.", repro: "A totals line proposed as an item would double-count a section.",
  },
  {
    id: "N09", area: "Bill of Quantities", title: "Measure by hand and price from the rate library", pre: "N07 project", data: "Any three items; the firm rate library",
    steps: steps("Type quantities for three items (with a reason).", "Select them and apply rates from the library (Pricing).", "Try to sign off."), expected: "Typed figures show as corrections by you. Library rates apply where the unit matches. Sign-off is refused and names every item still without a quantity or rate.", repro: "New route to a signable bill without a measured document.",
  },
  {
    id: "N10", area: "Advisor", title: "Brick take-off uses the practice’s own rates and factors", pre: "Advisor open", data: "Brick suggestion (R12)",
    steps: steps("Ask the brick question.", "Open Settings → Rate library and compare the brick and mortar rates."), expected: "Each priced line names its rate source and date and matches the rate library entry.", repro: "New.",
  },
  {
    id: "N11", area: "Process model", title: "Search the process model", pre: "Process model page", data: "“retention”, “tender”",
    steps: steps("Type a term into the process model search."), expected: "Matching areas, sub-processes and tasks are listed and each opens at its level.", repro: "New.",
  },
  {
    id: "N12", area: "Project Management", title: "Raise one of each kind of item", pre: "Any TEST project", data: "Titles of your choosing; a location for the snag; a reference for the instruction and the submittal; a likelihood and impact for the risk",
    steps: steps("Open Project Management from the project sidebar.", "Click New item and create a Task, an RFI, a Snag, an Instruction to action, a Risk and a Submittal.", "Try to save an RFI without a question."),
    expected: "Each kind shows its own fields (an RFI asks for the question and who it is raised to; a risk for likelihood and impact and shows a rating). Items are numbered #1, #2… and never renumbered. The RFI without a question is refused and the field is named.",
    repro: "New module.",
  },
  {
    id: "N13", area: "Project Management", title: "Board: drag between columns, add in a column", pre: "N12 done", data: "–",
    steps: steps("Drag a card from To do to Waiting on others.", "Reload the page.", "Click + on the Done column and create an item."),
    expected: "The card moves at once and is still there after the reload. The item created from a column’s + starts in that column. Done items show a done date in the dialog.",
    repro: "New module.",
  },
  {
    id: "N14", area: "Project Management", title: "List and Timeline", pre: "N12 done, with start and due dates on two items and one item overdue", data: "–",
    steps: steps("Open List; click the Due heading twice.", "Open Timeline.", "Click a bar and a diamond."),
    expected: "The list sorts by due date up and down; overdue dates are red; done rows are struck through. The timeline shows a bar from start to due, a diamond for a due date only, a red line for today, items without dates listed under “Not scheduled”. Clicking opens the item.",
    repro: "New module.",
  },
  {
    id: "N15", area: "Project Management", title: "Assign to a person or a contact; My work", pre: "A contact exists under Contacts", data: "Yourself; one contact",
    steps: steps("Assign one item to yourself and one to a contact.", "Open My items in the project.", "Open My work from the main sidebar."),
    expected: "The assignee list offers People and Contacts. My items shows only yours. My work lists your items across every project with the project named; clicking one opens it in its project.",
    repro: "New module.",
  },
  {
    id: "N16", area: "Project Management", title: "Comments and deep links", pre: "N12 done", data: "A comment",
    steps: steps("Open an item and post a comment.", "Copy the address bar (…/work?view=list&item=N) and open it in a new tab."),
    expected: "The comment shows with your name and time; the card shows a comment count. The link opens the same item directly.",
    repro: "New module.",
  },
  {
    id: "N17", area: "Job card", title: "“Plan it for me” is a table that feeds the board", pre: "Ridgeview Gardens or any project with a Next move", data: "–",
    steps: steps("Click Plan it for me on the Job card.", "Read the table.", "Click Add to board on one row, then Add … to the board for the rest.", "Click Open Project Management."),
    expected: "A one-sentence position, then a table: numbered actions with why, a link to the step each is done on, an owner role, a due suggestion in working days and a priority. Nothing in the action text is a figure. Added rows show “Item #N” linking to the board; the board holds them as To do with the plan’s reason and the suggested owner in the description.",
    repro: "The plan was a plain list with no links and nothing to do with it.",
  },
  {
    id: "N18", area: "Shell", title: "No Back button above pages", pre: "Any page", data: "–",
    steps: steps("Open a project page and a step page."), expected: "No “← Projects” button above the page. The breadcrumb and sidebar are the way back.", repro: "Redundant, removed.",
  },
  {
    id: "N19", area: "Platform", title: "Smoke test after the security update (Next.js 16.3.5)", pre: "Production site", data: "Any small PDF",
    steps: steps("Sign in and out.", "Upload a document to a TEST project.", "Open a document from the corpus.", "Open the project’s Report page and download the PDF."), expected: "Everything works as before; no error pages.", repro: "Security patches for critical advisories.",
  },
];

// ── Sheet 3 – junior QS scenarios ─────────────────────────────────────────────────────────

const t1 = S.typologies[0], t2 = S.typologies[1], t3 = S.typologies[2];
const lowest = S.lowestTender;
const pctOver = ((S.varianceAgainstBudget / S.contractSum) * 100).toFixed(2).replace(".", ",");
const tenderVsEstimate = (((lowest.corrected - S.billTotal) / S.billTotal) * 100).toFixed(1).replace(".", ",");

const SCENARIOS = [
  {
    id: "S01", stage: "Inception – project set-up", title: "Open a project and file the inception pack",
    role: "set up a new scheme and see what is still needed before I can estimate",
    pre: "Signed in", data: "Test pack: Appointment letter, Project brief, Title deed, Zoning certificate, Record of decision, Market study, Site development plan",
    steps: steps("Create “TEST – <your initials> Ridgeview” at Feasibility & Inception; code RVG-001.", "Open Project Corpus and drag in the seven PDFs.", "Confirm each is classified as its own kind, then File.", "Open the overview and each Feasibility step."),
    expected: "Seven documents filed under their own kinds. The Job card’s Next move moves to a Feasibility step. On the step pages the matching requirements tick with a quote from the right document.",
    repro: "Are any requirements ticked off a document that does not really cover them?",
  },
  {
    id: "S02", stage: "Feasibility – estimate", title: "Run the feasibility estimate and check every extracted figure",
    role: "extract the scheme parameters and prove each one against its source before signing",
    pre: "S01 done", data: "Project brief, Market study, Zoning certificate, Title deed",
    steps: steps("Open Feasibility Estimate and click Run.", "For every field open its citation and compare with the PDF.", "Correct one field with a reason (then put it back).", "Sign off."),
    expected: bullets(
      `Target household income band: ${R(S.incomeBandLow)} – ${R(S.incomeBandHigh)} per month`,
      `Erf number and extent: ${S.erf}, ${N(S.erfExtent)} m²`,
      `Total unit count: ${N(S.units)}`,
      `Unit mix: ${t1.units} × ${t1.name} ${t1.area} m²; ${t2.units} × ${t2.name} ${t2.area} m²; ${t3.units} × ${t3.name} ${t3.area} m²`,
      `Average unit area: ${S.averageUnitArea} m²`,
      `Achievable selling price: ${R(S.averageSellingPrice)} per unit`,
      `Absorption rate: ${S.absorption} units per annum`,
      `Bulk services contribution: ${R(S.bulkContribution)}`,
      `Permitted use and density: ${S.zoning}, ${S.permittedDensity} dwelling units per hectare`,
      `Subsidy quantum: ${R(S.subsidyQuantum)} (FLISP)`,
      `Programme duration: ${S.programmeMonths} months`,
      "Signed off by your name, with the date",
    ),
    repro: `Check the scheme fits the zoning: ${N(S.erfExtent)} m² = ${N(S.erfExtent / 10000, 1)} ha × ${S.permittedDensity} du/ha = ${N(S.permittedUnits)} units permitted ≥ ${N(S.units)} proposed. GFA ${N(S.gfa)} m² = ${N(S.units)} × ${S.averageUnitArea} m².`,
  },
  {
    id: "S03", stage: "Feasibility – cost plan", title: "Build the elemental cost plan on the signed feasibility",
    role: "confirm the cost plan carries the signed scheme figures and reconciles",
    pre: "S02 signed off", data: "QS cost plan.pdf",
    steps: steps("File QS cost plan.pdf.", "Open Cost Plan; note the fields marked as carried.", "Run and check each figure against the PDF.", "Sign off."),
    expected: bullets(
      "Unit count, average unit area and erf are “carried from Feasibility Estimate”, not read again",
      `Estimate class: ${S.estimateClass}`,
      `Total construction cost: ${R(S.constructionCost)}`,
      ...S.elements.map((e) => `${e.label}: ${R(e.amount)}`),
      "Dashboard afterwards: cost per m² GFA R 9 293,34 and cost per unit R 446 080,31",
    ),
    repro: `Add the eight elements: they must total ${R(S.constructionCost)}. ${R(S.constructionCost)} ÷ ${N(S.gfa)} m² = R 9 293,34/m².`,
  },
  {
    id: "S04", stage: "Design & Documentation – BoQ", title: "Draft the bill from the measured bill and spot-check it",
    role: "turn the measured bill into platform rows and prove it before sign-off",
    pre: "S03 done (the project runs Design & Documentation)", data: "Specification.pdf, Bill of quantities.pdf",
    steps: steps("File both PDFs.", "Open Bill of Quantities and click Draft the bill.", "Spot-check the items listed on the right against the PDF.", "Compare each section total with the PDF’s summary page."),
    expected: bullets(
      "26 items in 8 sections, every item with its unit, quantity and rate and a citation to Bill of quantities.pdf",
      ...["1.1", "1.4", "4.2", "7.1", "8.1"].map((ref) => { const it = item(ref); return `${ref} ${it.description.slice(0, 48)}… ${N(it.quantity)} ${it.unit} @ ${R(it.rate, 2)} = ${R(it.amount, 2)}`; }),
      `Bill total ${R(S.billTotal, 2)}`,
    ),
    repro: `The bill excludes contingency (${R(21_300_000)}) and escalation (${R(18_700_000)}), so it sits below the cost plan’s ${R(S.constructionCost)}. Is the difference explained?`,
  },
  {
    id: "S05", stage: "Design & Documentation – BoQ", title: "Correct, omit and sign off the bill",
    role: "make corrections with a reason and see the sign-off gate protect the bill",
    pre: "S04 drafted, not signed", data: "Item 2.2 and item 8.2",
    steps: steps("Change item 2.2’s quantity to 75 500 with the reason “Re-measured internal walls”.", "Omit item 8.2.", "Add a row by hand (“Sundry making good”, unit m², quantity 120, no rate) and try to sign off.", "Give the new row a rate of R 85,00 and sign off."),
    expected: "2.2 shows your correction, the reason and your name, and its amount recalculates (75 500 × R 420,00 = R 31 710 000,00). 8.2 is struck through and left out of the total. Sign-off is refused while the new row has no rate, and names it. With the rate added (120 × R 85,00 = R 10 200,00) it signs and the figures freeze.",
    repro: "Recalculate the new total by hand: does it match the grid?",
  },
  {
    id: "S06", stage: "Design & Documentation – BoQ", title: "Bill from a specification only, measured by hand",
    role: "produce a bill when only the specification exists",
    pre: "New TEST project at Design & Documentation", data: "Specification.pdf only; the firm rate library",
    steps: steps("File Specification.pdf and draft the bill.", "Read the notice above the grid.", "Enter quantities for three items with reasons.", "Apply library rates to them (Pricing)."),
    expected: "22 items, each with a unit and no quantity; the notice explains why. Your quantities and the library rates fill in and amounts calculate. Sign-off stays refused until every item is measured and priced (or omitted).",
    repro: "Are the proposed units (m³, m², m, kg, no) the ones you would measure these items in?",
  },
  {
    id: "S07", stage: "Procurement – tender analysis", title: "Analyse the tenders and confirm the recommendation",
    role: "check the arithmetic correction and that the right tenderer is recommended",
    pre: "S04 or S05 bill signed off (Tender Analysis waits for it)", data: "Tender return.pdf, Adjudication report.pdf",
    steps: steps("File both PDFs.", "Open Tender Analysis and run it.", "Check each field against the PDFs.", "Sign off."),
    expected: bullets(
      "Four tenderers",
      ...S.tenders.map((t) => `${t.name}: ${R(t.sum)}${t.correction ? ` + correction ${R(t.correction)} = ${R(t.corrected)}` : ""}`),
      `Lowest and recommended: ${lowest.name}, ${R(lowest.corrected)} after correction`,
      "Qualification: Summit Civils & Building on the municipal bulk water connection",
      `Validity ${S.tenderValidity} days; closing ${S.tenderClosing}`,
    ),
    repro: `Lowest corrected tender vs the pre-tender estimate (bill): ${R(lowest.corrected)} against ${R(S.billTotal)} = ${tenderVsEstimate}% above. Would you raise that with the client?`,
  },
  {
    id: "S08", stage: "Construction – contract", title: "Capture the contract particulars",
    role: "record the contract data every later valuation relies on",
    pre: "S07 signed off", data: "Signed contract.pdf",
    steps: steps("File Signed contract.pdf.", "Open Contract, run and check each field.", "Sign off."),
    expected: bullets(
      `Contract form: ${S.contractForm}`,
      `Contractor: ${S.contractor}`,
      `Contract sum: ${R(S.contractSum)}`,
      `Retention ${S.retentionPercent}%, limited to ${S.retentionLimitPercent}% = ${R(S.retentionLimit)}`,
      `Practical completion: ${S.practicalCompletion}`,
      `Penalty: ${R(S.penaltyPerDay)}/day`,
      `Advance payment: ${R(S.advancePayment)}`,
      `Date signed: ${S.contractSigned}`,
    ),
    repro: `Contract sum must equal the recommended tender (${R(lowest.corrected)}). Retention limit = ${S.retentionLimitPercent}% × ${R(S.contractSum)}.`,
  },
  {
    id: "S09", stage: "Construction – valuations", title: "Check interim valuation No. 07",
    role: "verify a payment certificate before it goes to the principal agent",
    pre: "S08 signed off", data: "Measurement record.pdf",
    steps: steps("File Measurement record.pdf.", "Open Valuations and run it.", "Check each field and recalculate the certificate by hand.", "Sign off."),
    expected: bullets(
      `Contract sum ${R(S.contractSum)} and retention ${S.retentionPercent}% carried from Contract`,
      `Certificate ${S.certificateNumber}, period ending ${S.valuationPeriodEnd}`,
      `Work executed ${R(S.workExecuted)}; materials on site ${R(S.materialsOnSite)}; variations ${R(S.variationValue)}; dayworks ${R(S.dayworks)}`,
      `Previously certified ${R(S.previouslyCertified)}`,
    ),
    repro: `Gross = ${R(S.workExecuted)} + ${R(S.materialsOnSite)} + ${R(S.variationValue)} + ${R(S.dayworks)} = R 128 094 500. Net before retention = gross − ${R(S.previouslyCertified)} = R 31 374 500. Work executed is 25,3% of the contract sum.`,
  },
  {
    id: "S10", stage: "Construction – variations", title: "Assess variation VO-04 (vinyl to porcelain)",
    role: "check a variation’s valuation before it is approved",
    pre: "S08 signed off", data: "Contract instruction.pdf",
    steps: steps("File Contract instruction.pdf.", "Open Variations and run it.", "Check the fields, then recalculate the three valuation lines."),
    expected: bullets(
      `Variation ${S.variationNumber}; instruction ${S.instructionRef} of ${S.instructionDate}`,
      "Description: vinyl replaced by 600 × 600 mm porcelain tiling in 464 two-bedroom units",
      "Reason: client-instructed specification upgrade",
      `Net value ${R(S.variationValue)}; no extension of time; approved ${S.variationApproved}`,
    ),
    repro: "KNOWN TEST-DATA ISSUE: the instruction’s own lines (R −5 759 354, R 8 751 226, R 236 000) add to R 3 227 872, not the stated net R 3 180 000, and 14 959 m² × R 385,00 = R 5 759 215. Record this as a finding in the document – it is not a platform defect.",
  },
  {
    id: "S11", stage: "Construction – cost reporting", title: "Review cost report No. 5",
    role: "confirm the forecast and the variance the client will read",
    pre: "S08 and S09 signed off", data: "Cost report.pdf",
    steps: steps("File Cost report.pdf.", "Open Cost Report and run it.", "Check each field and the variance arithmetic.", "Sign off."),
    expected: bullets(
      `Report date ${S.reportDate}`,
      `Forecast final cost ${R(S.forecastFinalCost)}`,
      `Variance ${R(S.varianceAgainstBudget)} over (${pctOver}%)`,
      `Committed cost ${R(S.committedCost)}; approved variations to date ${R(S.variationsToDate)}`,
      "Risks: bulk water claim R 2 400 000; CPAP escalation R 3 100 000; unexpended provisional sums R 6 800 000",
    ),
    repro: `Variance = forecast ${R(S.forecastFinalCost)} − contract sum ${R(S.contractSum)} = ${R(S.varianceAgainstBudget)}.`,
  },
  {
    id: "S12", stage: "Any stage – advisor", title: "Use the advisor the way a junior QS would",
    role: "get unstuck without leaving the platform",
    pre: "Ridgeview with the test pack filed", data: "Questions listed in the steps",
    steps: steps(
      "Ask anything: “What is the difference between a provisional sum and a prime cost sum?”",
      "Ask anything: “Where do I get a bulk services contribution?”",
      "Project documents: “What retention applies on this contract?”",
      "Ask anything: “How is a variation valued if there is no contract rate?” then open the process link.",
    ),
    expected: "Structured answers with links to the right steps. The documents question cites Signed contract.pdf (10%, limited to 5%). The variation question links to the variation sub-process in the process model.",
    repro: "Is anything the advisor says wrong for South African practice? Note it.",
  },
  {
    id: "S13", stage: "Engagement change", title: "The practice is appointed for an earlier phase",
    role: "add an earlier phase when our appointment grows, without losing work",
    pre: "TEST project created at Construction & Delivery, with at least one document filed", data: "Specification.pdf, Bill of quantities.pdf",
    steps: steps("On the Job card open Design & Documentation (Not run).", "Click “Run Design & Documentation too”.", "File the specification and bill, draft the bill."),
    expected: "The phase becomes active with its five deliverables. Documents already filed stay filed and nothing already signed changes. The bill drafts as in S04.",
    repro: "Nothing already signed should change when a phase is added.",
  },
  {
    id: "S14", stage: "Construction – project management", title: "Run the site-meeting actions on the board",
    role: "keep the RFIs, snags and instructions from a site meeting in one place and know what is overdue",
    pre: "Ridgeview at Construction with Contract signed off", data: "Site meeting minutes of your own: two RFIs to the engineer, three snags in Block C, one instruction CI-018 to price, one risk (bulk water)",
    steps: steps("Raise each as its own kind of item, assign the RFIs to the engineer (a contact) and the snags to the contractor.", "Give every item a due date; make one already past.", "Move what is with others to Waiting on others.", "Open Timeline and My work."),
    expected: "The board shows the meeting’s work by column with owners; the overdue item is red and counted in the header; the timeline shows the programme of it; My work shows only what is yours. Nothing on the board changes any signed figure.",
    repro: "Would this board replace the spreadsheet you keep for site meetings? What is missing?",
  },
  {
    id: "S15", stage: "Governance – sign-off", title: "Signed figures are frozen and traceable",
    role: "trust that a signed figure cannot quietly change",
    pre: "S02 signed off", data: "Feasibility Estimate",
    steps: steps("Open the signed Feasibility Estimate and try to edit a field.", "Open the Dashboard and Project Data.", "Open Cost Plan and look at a carried figure."),
    expected: "Signed fields cannot be edited (running again creates a new draft). Signatures show your name and date. The cost plan’s carried figure names the signed step it came from.",
    repro: "Could anyone change a signed figure without a new sign-off?",
  },
  {
    id: "S16", stage: "Requirements – declaring", title: "Declare a requirement you hold outside the platform",
    role: "vouch for something I have on paper without uploading it",
    pre: "TEST project, Project Inputs page", data: "Stakeholder register (declarable)",
    steps: steps("Tick Stakeholder register.", "Reload.", "Check how it looks next to a requirement ticked by a document."),
    expected: "It stays ticked and shows as declared by you (outlined), not as evidenced by a document (filled). Requirements that cannot be declared (e.g. Client mandate) never clear the gate on a tick alone.",
    repro: "Is it obvious which ticks rest on a document and which on a person?",
  },
];

// ── Which round ───────────────────────────────────────────────────────────────────────────
// Round 2 is kept exactly as issued; round 3 brings its own fixes, modules, scenarios and issues.
const ROUND = process.argv.includes("--round=3") ? 3 : 2;
const R3 = ROUND === 3 ? round3({ steps, bullets, R, N, S }) : null;
const DATA = R3
  ? { fixes: R3.fixes, news: R3.news, scenarios: R3.scenarios, issues: R3.issues }
  : { fixes: FIXES, news: NEW, scenarios: SCENARIOS, issues: null };

// ── How to use ────────────────────────────────────────────────────────────────────────────

// ── Writing the workbook ───────────────────────────────────────────────────────────────────
//
// Built for testers who are not technical. Each sheet is a short list of category bands that open
// with the + at the left edge; the columns say what to do, what you should see, and what to write
// down; the Result cell colours itself; and the first sheet counts progress as the sheets fill in.

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters; a stray one makes Excel refuse the whole file.
    .replace(/[ --]/g, "");

const colName = (index) => {
  let n = index + 1, name = "";
  while (n > 0) { const r = (n - 1) % 26; name = String.fromCharCode(65 + r) + name; n = Math.floor((n - 1) / 26); }
  return name;
};

/**
 * Style ids in styles.xml: 0 default · 1 header · 2 wrapped body · 3 result cell · 4 title ·
 * 5 label · 6 category band · 7 intro line · 8 centred number · 9 input box.
 */
const text = (ref, value, style) => `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;

/** The first three rows every test sheet shares: a title, one line of instruction, the headings. */
const TOP_ROWS = 3;

/**
 * One test sheet: a title, an instruction line, the headings, and the tests under category bands.
 *
 * The category column itself is not shown – the band says it – and its tests sit one outline level
 * down so the band folds them. Every band but the first starts folded, so a tester opens the sheet
 * to a list of headings rather than a wall of text.
 */
function tableSheet({ title, intro, columns, rows, groupKey }) {
  const shown = columns.filter((c) => c.key !== groupKey);
  const lastCol = colName(shown.length - 1);
  const resultCol = colName(shown.findIndex((c) => c.status));

  const groups = [];
  for (const row of rows) {
    const key = row[groupKey];
    const group = groups.find((g) => g.key === key);
    if (group) group.rows.push(row);
    else groups.push({ key, rows: [row] });
  }

  const out = [];
  out.push(`<row r="1" ht="26" customHeight="1">${text("A1", title, 4)}</row>`);
  out.push(`<row r="2" ht="20" customHeight="1">${text("A2", intro, 7)}</row>`);
  out.push(`<row r="3" ht="30" customHeight="1">${shown.map((c, i) => text(`${colName(i)}3`, c.title, 1)).join("")}</row>`);

  const merges = [`A1:${lastCol}1`, `A2:${lastCol}2`];
  let n = TOP_ROWS;
  groups.forEach((group, g) => {
    const folded = g > 0;
    n += 1;
    const band = `${group.key}  ·  ${group.rows.length} ${group.rows.length === 1 ? "test" : "tests"}${folded ? "   (click + at the left to open)" : ""}`;
    out.push(`<row r="${n}" ht="22" customHeight="1"${folded ? ' collapsed="1"' : ""}>${text(`A${n}`, band, 6)}</row>`);
    merges.push(`A${n}:${lastCol}${n}`);
    for (const row of group.rows) {
      n += 1;
      out.push(
        `<row r="${n}" outlineLevel="1"${folded ? ' hidden="1"' : ""}>${shown
          .map((c, i) => text(`${colName(i)}${n}`, c.status ? (row.status ?? "") : (row[c.key] ?? ""), c.status ? 3 : 2))
          .join("")}</row>`,
      );
    }
  });
  const lastRow = n;

  return {
    resultRange: `${resultCol}${TOP_ROWS + 1}:${resultCol}${lastRow}`,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><outlinePr summaryBelow="0"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="2" ySplit="${TOP_ROWS}" topLeftCell="C${TOP_ROWS + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15" outlineLevelRow="1"/>
<cols>${shown.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join("")}</cols>
<sheetData>${out.join("")}</sheetData>
<autoFilter ref="A${TOP_ROWS}:${lastCol}${lastRow}"/>
<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>
<conditionalFormatting sqref="${resultCol}${TOP_ROWS + 1}:${resultCol}${lastRow}">
<cfRule type="containsText" dxfId="0" priority="1" operator="containsText" text="Pass"><formula>NOT(ISERROR(SEARCH("Pass",${resultCol}${TOP_ROWS + 1})))</formula></cfRule>
<cfRule type="containsText" dxfId="1" priority="2" operator="containsText" text="Fail"><formula>NOT(ISERROR(SEARCH("Fail",${resultCol}${TOP_ROWS + 1})))</formula></cfRule>
<cfRule type="containsText" dxfId="2" priority="3" operator="containsText" text="Blocked"><formula>NOT(ISERROR(SEARCH("Blocked",${resultCol}${TOP_ROWS + 1})))</formula></cfRule>
<cfRule type="containsText" dxfId="3" priority="4" operator="containsText" text="Needs review"><formula>NOT(ISERROR(SEARCH("Needs review",${resultCol}${TOP_ROWS + 1})))</formula></cfRule>
</conditionalFormatting>
<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Result" error="Pick a result from the list." sqref="${resultCol}${TOP_ROWS + 1}:${resultCol}${lastRow}"><formula1>"${STATUSES.join(",")}"</formula1></dataValidation></dataValidations>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`,
  };
}

/** The first sheet: how to test, in plain words, and a progress table that fills itself in. */
function startSheet(tests) {
  const lines = [
    ["title", "User Acceptance Testing"],
    ["intro", R3 ? R3.intro : "QS Platform — acceptance checklist, round 2. Thank you for testing. You do not need to be technical: each sheet says what to do and what should happen. If something looks wrong, that is exactly what we want to hear."],
    [],
    ["label", "Before you start", "Fill these in once. They apply to everything you test in this workbook."],
    ["input", "Tested by", ""],
    ["input", "Role / company", ""],
    ["input", "Date tested", ""],
    ["input", "Web address tested", APP],
    ["input", "Browser used", ""],
    ["input", "Version or build", BUILD],
    [],
    ["label", "How to use this sheet"],
    ["", "The documents", `Everything you need is in the shared Google Drive folder: ${DRIVE}`],
    ["", "Test documents", `Download “${PACK}” from that folder and unzip it. ${R3 ? R3.packNote : "It holds 16 PDFs for a made-up scheme called Ridgeview Gardens. Every name and figure in them is invented."}`],
    ["", "Sign in", "Use the login you were given. Never type it into this workbook."],
    ...(R3 ? [["", "Test rates", R3.extraBeforeStart]] : []),
    ["", "Your projects", "Name every project you create “TEST – <your initials> – <what>” so we can clean up afterwards. The site is shared: never change or sign off a project that is not yours."],
    ["", "The sheets", R3 ? R3.sheetsNote : "0 – Core checks (round 1’s tests, run again). 1 – Fixes to confirm (what round 1 reported, now fixed). 2 – New changes (new things to try). 3 – Junior QS scenarios (real work from start to finish; do S01 to S11 in order)."],
    ["", "Sections", "Each sheet is split into sections with a green band. Click the + at the far left of a band to open its tests, and − to close it. Only the first section is open when you start."],
    ["", "How to fill it in", "For each test, do what “How to test” says, then compare what you see with “What should happen”. Choose a Result, and say what you actually saw in Comments."],
    ["", "If it fails", "Choose Fail, write what you saw in Comments, and add a line on the Issues sheet. A screenshot helps – paste a link to it, or its file name."],
    ["", "If you cannot test it", "Choose Blocked – for example when an earlier test failed and this one depends on it. Say which test blocked it in Comments."],
    ["", "One tester, one file", "If more than one person is testing, each takes their own copy of this file. Combine them at the end."],
    [],
    ["label", "What the Result column means"],
    ["", "Pass", "It did what “What should happen” says."],
    ["", "Fail", "It did not. Say what you saw in Comments, and log it on the Issues sheet."],
    ["", "Blocked", "You could not test it, usually because an earlier test failed."],
    ["", "Needs review", "It worked, but something looked wrong or you are not sure. Say what in Comments."],
    ["", "Not tested", "Skipped on purpose – say why in Comments."],
    [],
    ["label", "Good to know"],
    ["", "Ticks can take a moment", "A requirement that a document covers in its own words can take a reload or two to tick – the document is read in the background. A tick you make by hand should appear at once."],
    ["", "The advisor is an AI", "Its answers vary from run to run. Test that they are structured, relevant and correctly formatted – not word for word."],
    ["", "One known oddity in the test data", "The VO-04 contract instruction’s three lines do not add up to its stated net value. That is the document, not the platform – see S10."],
    [],
    ["label", "Progress", "Fills in as the sheets are completed."],
  ];

  const rows = [];
  let n = 0;
  for (const line of lines) {
    n += 1;
    if (line.length === 0) { rows.push(`<row r="${n}"/>`); continue; }
    const [kind, a, b] = line;
    if (kind === "title") rows.push(`<row r="${n}" ht="28" customHeight="1">${text(`A${n}`, a, 4)}</row>`);
    else if (kind === "intro") rows.push(`<row r="${n}">${text(`A${n}`, a, 7)}</row>`);
    else if (kind === "input") rows.push(`<row r="${n}" ht="20" customHeight="1">${text(`A${n}`, a, 5)}${text(`B${n}`, b, 9)}</row>`);
    else if (kind === "label") rows.push(`<row r="${n}" ht="22" customHeight="1">${text(`A${n}`, a, 6)}${b ? text(`B${n}`, b, 2) : ""}</row>`);
    else rows.push(`<row r="${n}">${text(`A${n}`, a, 5)}${text(`B${n}`, b, 2)}</row>`);
  }
  const merges = [`A1:G1`, `A2:G2`];

  // The progress table. COUNTIF over each sheet's Result column – Excel and Google Sheets both work
  // it out on open, so the tester never touches a formula.
  n += 1;
  const heads = ["Sheet", "Tests", "Pass", "Fail", "Blocked", "Needs review", "Not run"];
  rows.push(`<row r="${n}" ht="22" customHeight="1">${heads.map((h, i) => text(`${colName(i)}${n}`, h, 1)).join("")}</row>`);
  for (const sheet of tests) {
    n += 1;
    const range = `'${sheet.name.replace(/'/g, "''")}'!${sheet.resultRange}`;
    const count = (what) => `<c r="__" s="8"><f>COUNTIF(${range},"${what}")</f></c>`;
    const cells = [
      text(`A${n}`, sheet.name, 5),
      `<c r="B${n}" s="8"><v>${sheet.count}</v></c>`,
      ...["Pass", "Fail", "Blocked", "Needs review", "Not run"].map((what, i) => count(what).replace("__", `${colName(i + 2)}${n}`)),
    ];
    rows.push(`<row r="${n}">${cells.join("")}</row>`);
  }
  n += 1;
  const all = (what) => tests.map((t) => `COUNTIF('${t.name.replace(/'/g, "''")}'!${t.resultRange},"${what}")`).join("+");
  rows.push(`<row r="${n}">${text(`A${n}`, "All sheets", 5)}<c r="B${n}" s="8"><v>${tests.reduce((sum, t) => sum + t.count, 0)}</v></c>${["Pass", "Fail", "Blocked", "Needs review", "Not tested"]
    .map((what, i) => `<c r="${colName(i + 2)}${n}" s="8"><f>${all(what)}</f></c>`)
    .join("")}</row>`);

  n += 2;
  rows.push(`<row r="${n}" ht="22" customHeight="1">${text(`A${n}`, "Acceptance", 6)}${text(`B${n}`, "For whoever signs the round off.", 2)}</row>`);
  const acceptance = [
    ["Tests passed", `<c r="B__" s="8"><f>${all("Pass")}</f></c>`],
    ["Tests failed", `<c r="B__" s="8"><f>${all("Fail")}</f></c>`],
    ["Accepted by", text("B__", "", 9)],
    ["Signature and date", text("B__", "", 9)],
  ];
  const acceptanceMerges = [`B${n}:G${n}`];
  for (const [label, cell] of acceptance) {
    n += 1;
    rows.push(`<row r="${n}" ht="20" customHeight="1">${text(`A${n}`, label, 5)}${cell.replace("__", String(n))}</row>`);
    if (cell.startsWith("<c r=\"B__\" t=")) acceptanceMerges.push(`B${n}:G${n}`);
  }

  // Every explanation line spans the table's width; the label lines with a note beside them too.
  const allMerges = [
    ...merges,
    ...lines.map((l, i) => (l[0] === "" || l[0] === "input" || (l[0] === "label" && l[2]) ? `B${i + 1}:G${i + 1}` : null)).filter(Boolean),
    ...acceptanceMerges,
  ];

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0" showGridLines="0" tabSelected="1"/></sheetViews>
<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="7" width="13" customWidth="1"/></cols>
<sheetData>${rows.join("")}</sheetData>
<mergeCells count="${allMerges.length}">${allMerges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6">
<font><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="15"/><color rgb="FF2E4B15"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF5A6470"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF2E4B15"/><name val="Calibri"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4A7722"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF7F8FA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8F1DC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFDF6E3"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFE1E5EA"/></left><right style="thin"><color rgb="FFE1E5EA"/></right><top style="thin"><color rgb="FFE1E5EA"/></top><bottom style="thin"><color rgb="FFE1E5EA"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<dxfs count="4">
<dxf><font><b/><color rgb="FF1F6E3A"/></font><fill><patternFill><bgColor rgb="FFDCEFDC"/></patternFill></fill></dxf>
<dxf><font><b/><color rgb="FF9B2C26"/></font><fill><patternFill><bgColor rgb="FFFBE3E1"/></patternFill></fill></dxf>
<dxf><font><color rgb="FF444B54"/></font><fill><patternFill><bgColor rgb="FFE9ECEF"/></patternFill></fill></dxf>
<dxf><font><b/><color rgb="FF8A5F0E"/></font><fill><patternFill><bgColor rgb="FFFFF1CC"/></patternFill></fill></dxf>
</dxfs>
</styleSheet>`;

/**
 * The Issues sheet – round 1's seven findings first, each pointing at the test that confirms the fix
 * or saying plainly that it is still open, then thirty blank numbered lines for round 2.
 */
const ROUND_ONE_ISSUES = [
  ["1", "R29", "Checkbox tick flickers – appears, disappears, reappears (Site & Zoning and every step page).", "Minor", "Fixed – confirm", "The tick was saved but the step page was not refreshed. Confirm in R29."],
  ["2", "–", "An archived project becomes untraceable – not found by exact name in search, no “Archived” label.", "Major", "Fixed – confirm", "Archived projects are found by the Projects filter and Ctrl+K, labelled Archived, and every page of one says so with a Restore button. Confirm in R32."],
  ["3", "R06", "Content check too lenient – a random image accepted as Concept drawings; filler text accepted as Market data; a title-only document accepted as QS cost plan.", "Minor", "Fixed – confirm", "A document must now be of an accepted kind AND cover the requirement in its text (read by the model where the wording differs). Drawings are accepted by kind because a drawing has no text to read. Confirm in R06."],
  ["4", "R03", "Advisor “next step” did not track, and jumped back to step 2 when working on step 4.", "Minor", "Fixed – confirm", "Where the job is now lives on the Job card and is computed from the records, not from clicks. Confirm in R03."],
  ["5", "R05", "Figure extraction missed data the document stated (240 units; absorption 12–15 units/month).", "Major", "Fixed – confirm", "Extraction now searches the words of a field, not only its fixed phrases. Confirm in R05."],
  ["6", "–", "Comma-formatted numbers not read – “12,940 m²” left blank as ambiguous.", "Minor", "Fixed – confirm", "A quantity in m, m², m³, nr, kg and similar whole units is now read as thousands (nobody measures 12,94 m²), and otherwise the document’s own figures decide – R 385,00 means its comma is a decimal. Only a figure neither can settle, such as 1,250 t, is still left for the QS. Confirm in R33."],
  ["7", "R06", "Correctly labelled plain-prose documents rejected because they did not use the platform’s wording.", "Major", "Fixed – confirm", "Same fix as issue 3. Confirm in R06."],
];

function issuesSheet() {
  const columns = [
    { title: "No.", width: 6 },
    { title: "Test ID", width: 9 },
    { title: "What went wrong (and what you expected instead)", width: 60 },
    { title: "How bad", width: 12 },
    { title: "Status", width: 16 },
    { title: "Screenshot / notes", width: 50 },
  ];
  const lastCol = colName(columns.length - 1);
  const out = [
    `<row r="1" ht="26" customHeight="1">${text("A1", "Issues found", 4)}</row>`,
    `<row r="2" ht="20" customHeight="1">${text("A2", R3 ? R3.issuesIntro : "One line per problem, referencing the test it came from. Round 1’s findings are listed first with what was done about them.", 7)}</row>`,
    `<row r="3" ht="30" customHeight="1">${columns.map((c, i) => text(`${colName(i)}3`, c.title, 1)).join("")}</row>`,
  ];
  let n = 3;
  const listed = DATA.issues ?? ROUND_ONE_ISSUES;
  for (const [no, test, what, severity, status, notes] of listed) {
    n += 1;
    out.push(`<row r="${n}">${[no, test, what, severity, status, notes].map((v, i) => text(`${colName(i)}${n}`, v, i === 3 || i === 4 ? 3 : 2)).join("")}</row>`);
  }
  for (let i = 0; i < 30; i++) {
    n += 1;
    out.push(`<row r="${n}">${columns.map((_, c) => text(`${colName(c)}${n}`, c === 0 ? String(listed.length + i + 1) : "", c === 3 || c === 4 ? 3 : 2)).join("")}</row>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join("")}</cols>
<sheetData>${out.join("")}</sheetData>
<mergeCells count="2"><mergeCell ref="A1:${lastCol}1"/><mergeCell ref="A2:${lastCol}2"/></mergeCells>
<dataValidations count="2">
<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="D4:D${n}"><formula1>"${SEVERITIES.join(",")}"</formula1></dataValidation>
<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="E4:E${n}"><formula1>"${ISSUE_STATUSES.join(",")}"</formula1></dataValidation>
</dataValidations>
</worksheet>`;
}

const TESTS = [
  {
    name: "0. Core checks",
    count: CORE.length,
    ...tableSheet({
      title: "0. Core checks – round 1’s tests, run again",
      intro: "The basic acceptance checks from round 1 (42 of 43 passed). Run them again on the new build so we know nothing has gone backwards.",
      columns: CORE_COLUMNS,
      rows: CORE,
      groupKey: "area",
    }),
  },
  {
    name: "1. Fixes to confirm",
    count: DATA.fixes.length,
    ...tableSheet({
      title: "1. Fixes to confirm",
      intro: R3 ? R3.fixesIntro : "Things testers reported that should now be fixed. Open a section with the + at the left, follow the steps, and tell us what happened.",
      columns: FIX_COLUMNS,
      rows: DATA.fixes,
      groupKey: "area",
    }),
  },
  {
    name: R3 ? R3.newName : "2. New changes",
    count: DATA.news.length,
    ...tableSheet({
      title: R3 ? R3.newTitle : "2. New changes",
      intro: R3 ? R3.newIntro : "New things added to the platform. Try each one and tell us whether it does what the sheet says.",
      columns: NEW_COLUMNS,
      rows: DATA.news,
      groupKey: "area",
    }),
  },
  {
    name: "3. Junior QS scenarios",
    count: DATA.scenarios.length,
    ...tableSheet({
      title: "3. Junior QS scenarios",
      intro: R3 ? R3.scenariosIntro : "Real QS work from inception to the cost report, using the Ridgeview test pack. Do S01 to S11 in order; the rest stand alone. Check every figure against the documents.",
      columns: SCENARIO_COLUMNS,
      rows: DATA.scenarios,
      groupKey: "stage",
    }),
  },
];

const SHEETS = [
  { name: "How to use", xml: startSheet(TESTS) },
  ...TESTS.map((t) => ({ name: t.name, xml: t.xml })),
  { name: "Issues", xml: issuesSheet() },
];

const zip = new JSZip();
zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${SHEETS.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`);
zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${SHEETS.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
<calcPr fullCalcOnLoad="1"/>
</workbook>`);
zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${SHEETS.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${SHEETS.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
zip.file("xl/styles.xml", STYLES);
SHEETS.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml));

mkdirSync(OUT, { recursive: true });
const workbook = join(OUT, R3 ? R3.fileName : "QS Platform UAT Testing – round 2.xlsx");
writeFileSync(workbook, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

// ── The test pack ─────────────────────────────────────────────────────────────────────────
const pack = new JSZip();
for (const file of readdirSync("fixtures/ridgeview").filter((f) => f.endsWith(".pdf")).sort()) {
  pack.file(`Ridgeview test pack/${file}`, readFileSync(join("fixtures/ridgeview", file)));
}
writeFileSync(join(OUT, PACK), await pack.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

console.log(`${workbook}: ${CORE.length} core checks, ${DATA.fixes.length} fixes, ${DATA.news.length} new, ${DATA.scenarios.length} scenarios, ${(DATA.issues ?? ROUND_ONE_ISSUES).length} earlier issues`);
console.log(`${join(OUT, PACK)}: ${readdirSync("fixtures/ridgeview").filter((f) => f.endsWith(".pdf")).length} PDFs`);
