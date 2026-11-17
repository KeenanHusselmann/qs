/**
 * Round 3 of user acceptance testing – what was built after round 2, and what round 2 reported.
 *
 * Read by `make-tester-sheets.mjs --round=3`, which writes the workbook in round 2's shape. Every
 * expected figure below is computed from the Ridgeview scheme (`test-scheme.mjs`) and the
 * platform's own rules – retention and VAT rounded once to the cent – so re-running this after the
 * scheme changes keeps the sheet honest, exactly as round 2's generator does.
 */

/** Minor units, rounded half away from zero – the platform's one rounding rule. */
const cents = (rand) => Math.round(rand * 100);
const pct = (centsValue, percent) => Math.round((centsValue * percent) / 100);

export function round3({ steps, bullets, R, S }) {
  const RIDGEVIEW3 =
    "Your round-2 Ridgeview TEST project, with Contract and Valuations signed off (round-2 scenarios S08 and S09). No such project yet? Create “TEST – <initials> – Ridgeview R3” at Construction & Delivery, file Signed contract.pdf and Measurement record.pdf, then run and sign Contract, then Valuations.";

  // ── Payment certificate 07, by the platform's rules ────────────────────────────────────────
  const gross = cents(S.workExecuted) + cents(S.variationValue) + cents(S.dayworks) + cents(S.materialsOnSite);
  const retentionAtRate = pct(gross, S.retentionPercent);
  const limit = cents(S.retentionLimit);
  const retention = Math.min(retentionAtRate, limit);
  const net = gross - retention;
  const dueEx = net - cents(S.previouslyCertified);
  const vat = Math.round(dueEx * 0.15);
  const due = dueEx + vat;
  const released = Math.round(retention / 2);
  const Rc = (c) => R(c / 100, 2);

  // ── The claim that makes practical completion on time ─────────────────────────────────────
  const penalty = S.penaltyPerDay;

  const fixes = [
    {
      id: "F01", area: "Bill of Quantities", title: "A typed quantity stays put while the amount is worked out",
      pre: "A bill in draft (not signed) on a TEST project", data: "Any item row – type a new quantity, e.g. 864",
      steps: steps("Click a Qty cell, type a new quantity and press Enter.", "Watch the cell and the Amount column for the next two seconds.", "Immediately type a quantity in the next row as well."),
      expected: bullets("The figure you typed stays in the cell – it never flicks back to the old one", "The Amount cell says “calculating…” until the new amount appears", "The second edit is kept too"),
      repro: "Round 2: about a second’s delay with no sign of work, and the old value showed meanwhile.",
    },
    {
      id: "F02", area: "Bill of Quantities", title: "Bill cells look like something you can type in",
      pre: "A bill in draft", data: "–",
      steps: steps("Move the mouse over a description, unit, quantity and rate cell without clicking."),
      expected: "Each cell shows a light border and a text cursor on hover, and the accent border when clicked. An empty quantity or rate cell is an amber box.",
      repro: "Round 2: “the field doesn’t look like a typing box”.",
    },
    {
      id: "F03", area: "Advisor", title: "The brick take-off comes back with quantities, rates and sources",
      pre: "Rate Library has the simulated test rates loaded (see How to use)", data: "Suggested question “How many bricks for 240 m² of one-brick wall?”",
      steps: steps("Open the advisor on any project (or the assistant on the Overview).", "Start a new conversation and click the brick suggestion. Ask it three times."),
      expected: bullets("Every time: a take-off card, not general text", "Stock brick about 26 000 no, with the factor per m², waste, rate, source and date", "Cement, sand and labour lines, each saying where its factor came from", "An estimated cost total"),
      repro: "Round 2 N10: generic guidance, nothing from the rate library.",
    },
    {
      id: "F04", area: "Advisor", title: "A price question is answered from the Rate Library",
      pre: "Simulated test rates loaded", data: "“bricks cost zar”, then “What is the price of cement?”",
      steps: steps("On the Overview, open the assistant and ask “bricks cost zar”.", "Inside a project, ask the advisor “What is the price of cement?”."),
      expected: bullets("A card titled “Rates for … in the firm's Rate Library”", "Bricks: stock, face (two ranges), paving, cement and maxi bricks – each with its rate per brick, “Simulated test data – not a supplier quote”, region and date", "No bricklayer in the brick answer; no cement plaster in the cement answer"),
      repro: "Round 2: general information instead of the rates on file.",
    },
    {
      id: "F05", area: "Project Management", title: "Links in comments open with one click",
      pre: "Any TEST project with a board item", data: "The item’s own address, and https://www.example.com",
      steps: steps("Open an item and post a comment containing both links.", "Click each link."),
      expected: "Both are underlined links. The platform link opens the item in place; the outside link opens in a new tab.",
      repro: "Round 2: links were plain text and had to be copied.",
    },
    {
      id: "F06", area: "Project Management", title: "The comment count opens only the thread",
      pre: "F05 done", data: "–",
      steps: steps("On the board, click the speech-bubble count on the card.", "Click “Open item” in the small window."),
      expected: "A small window with just the comments opens, with a box to reply. “Open item” then opens the full item.",
      repro: "Round 2: comments could only be read by opening the whole item.",
    },
    {
      id: "F07", area: "Forms", title: "A refused form keeps what you typed",
      pre: "Any TEST project", data: "Claims → Lodge a claim, with a description but no days",
      steps: steps("Open Claims, click Lodge a claim, type a description, leave Days claimed empty, click Lodge.", "Type 21 in Days claimed and click Lodge again."),
      expected: "The first attempt says “A claim for time says how many days” and your description is still there. The second lodges the claim.",
      repro: "Found in testing: a refused save wiped the form.",
    },
    {
      id: "F08", area: "Bill of Quantities", title: "Bill and Pricing columns fit on a smaller screen",
      pre: "A bill with rows", data: "Browser window about 1024 px wide, then 1280 px with the advisor open",
      steps: steps("Open Bill of Quantities and Pricing at each width."),
      expected: "The headers Item ref, Unit and Amount (R) fit their columns; the description takes the remaining space.",
      repro: "Found in testing: headers overflowed at narrower widths.",
    },
  ];

  const news = [
    // ── Programme ──
    {
      id: "N01", area: "Programme", title: "Read the contractor’s programme from its document", pre: RIDGEVIEW3, data: "Construction programme.pdf (test pack)",
      steps: steps("Open Construction → Programme.", "Upload Construction programme.pdf against “Contractor’s programme”.", "Click “Read the programme” and wait."),
      expected: bullets("13 activities, each with the line it was read from", "Dates read day first: Site establishment 21 Sep 2026 – 30 Oct 2026", "Site handover and Practical completion shown as milestones", "Summary: 18 Sep 2026 – 18 Sep 2029, 1 097 days; bars drawn on the right"),
      repro: "New (D2.5).",
    },
    {
      id: "N02", area: "Programme", title: "Type or paste a programme instead", pre: "Any TEST project", data: "Rows copied from Excel: activity, start, finish – include one line with “wk 14” as its date",
      steps: steps("Open Programme on a project with no programme document; click “Type the programme in instead”.", "Add one activity with the form.", "Open “Paste activities from a spreadsheet”, paste the rows, click Add these."),
      expected: "The typed and pasted activities appear. The “wk 14” line is refused by name – it is not a date – and the others are added.",
      repro: "New.",
    },
    {
      id: "N03", area: "Programme", title: "Sign the baseline, then it cannot change", pre: "N01 done", data: "–",
      steps: steps("Correct one finish date, then Sign off.", "Try to edit a date afterwards."),
      expected: "“Baseline signed by <you>”. The grid becomes read-only; the dates are frozen.",
      repro: "New.",
    },
    {
      id: "N04", area: "Programme", title: "Record progress and see slippage", pre: "N03 done", data: "As at 31 Jan 2027: Site establishment 100%; Bulk earthworks 60% now finishing 26 Feb 2027",
      steps: steps("Click Record progress, set the date, enter the figures and a note, and save."),
      expected: bullets("Bulk earthworks shows 60% and “+28 days” in red", "The baseline dates do not change", "The summary shows progress as at 31 Jan 2027 and the new expected finish"),
      repro: "New.",
    },
    // ── Cash Flow ──
    {
      id: "N05", area: "Cash Flow", title: "The contract sum phased over the programme", pre: "Contract signed, N03 signed, Valuations (certificate 07) signed", data: "–",
      steps: steps("Open Cost planning → Cash Flow."),
      expected: bullets(`Contract sum ${R(S.contractSum, 2)}, programme and certificates shown as the three sources`, `Certified to date ${Rc(gross)} (certificate 07’s gross)`, "A month-by-month table – forecast, certified, variance, expected – whose totals equal the contract sum", "A chart with three lines"),
      repro: "New (D1.7).",
    },
    {
      id: "N06", area: "Cash Flow", title: "Without a programme it says it is using an S-curve", pre: "A TEST project with a signed contract but no programme", data: "–",
      steps: steps("Open Cash Flow."),
      expected: "The note says the forecast is an S-curve over the contract dates, and to sign the Programme for a better one. With no contract signed, it says nothing can be phased yet and why.",
      repro: "New.",
    },
    // ── Claims ──
    {
      id: "N07", area: "Claims", title: "Record a notice", pre: RIDGEVIEW3, data: "Notice of delay from the contractor, received 5 Oct 2029, event 20 Sep 2029, clause 29.1, “Late issue of landscaping drawings”",
      steps: steps("Open Construction → Claims, click Record a notice, fill it in, save."),
      expected: "Notice 1 on the register with its kind, party, dates and status Received.",
      repro: "New (D6.1).",
    },
    {
      id: "N08", area: "Claims", title: "Lodge a claim and assess it", pre: "N07 done", data: "Extension of time, 21 days claimed, under notice 1; award 14 days with a reason",
      steps: steps("Lodge a claim for 21 days under notice 1.", "Click Assess, award 14 days, write the reason, click “Record as <you>”.", "Try to open and change the claim."),
      expected: bullets("The notice now reads “Claim lodged”", "The claim shows Awarded, 14 days, by you", `Revised completion moves from 18 Sep 2029 to 2 Oct 2029`, "The claim can no longer be changed – “This assessment is frozen”"),
      repro: "New.",
    },
    {
      id: "N09", area: "Claims", title: "Penalty exposure against the revised date", pre: "N04 and N08 done", data: "–",
      steps: steps("Look at the four figures at the top of Claims."),
      expected: `Contract completion 18 Sep 2029 (from the signed contract); revised completion; what the programme expects; and penalty exposure at ${R(penalty, 2)} per day – or “none” if the programme finishes on or before the revised date.`,
      repro: "New.",
    },
    // ── Certificates ──
    {
      id: "N10", area: "Certificates", title: "Issue payment certificate 07", pre: "Valuations signed (certificate 07)", data: "–",
      steps: steps("Open Valuations and click “Issue payment certificate”.", "Click Download and open the PDF.", "Go back: the button now offers only the download."),
      expected: bullets(`Gross valuation ${Rc(gross)}`, `Less retention at ${S.retentionPercent}% ${Rc(retention)}${retention < retentionAtRate ? " (limited)" : ""}`, `Net valuation ${Rc(net)}`, `Less previously certified ${Rc(cents(S.previouslyCertified))}`, `Amount due excluding VAT ${Rc(dueEx)}; VAT ${Rc(vat)}; amount due ${Rc(due)}`, "It cannot be issued twice while the first copy is current"),
      repro: "New.",
    },
    {
      id: "N11", area: "Certificates", title: "Issue the certificate of practical completion", pre: "Handover signed (scenario S06)", data: "–",
      steps: steps("Open Handover and click “Issue certificate of practical completion”.", "Download and open it."),
      expected: bullets("Practically complete on 2 Oct 2029; defects liability period 90 calendar days", "Contract date 18 Sep 2029, extensions awarded, revised date", `Retention held on certificate 07 ${Rc(retention)}; half released ${Rc(released)}`, `The list of outstanding work, valued at ${R(S.outstandingValue, 2)}`, "A line on the occupation certificate"),
      repro: "New.",
    },
    // ── Take-off ──
    {
      id: "N12", area: "Take-off", title: "Measure a wall on a dimension sheet", pre: "A TEST project", data: "Item: One-brick wall, Block A, m². Lines: 4 × 36,00 × 2,70; deduct 12 × 1,20 × 1,50",
      steps: steps("Open Measurement → Take-off.", "Add the item, then add the two lines (tick Ddt on the second)."),
      expected: "Lines of 388,80 and (21,60); total 367,20 m².",
      repro: "New (D1.2).",
    },
    {
      id: "N13", area: "Take-off", title: "An unclear dimension is refused, not guessed", pre: "N12 done", data: "Length 1,250 × 2,70",
      steps: steps("Add a line with length 1,250."),
      expected: "Refused in words: “1,250” could be a thousands separator or a decimal comma. The total does not change. (Type 1,25 or 1 250.)",
      repro: "New.",
    },
    {
      id: "N14", area: "Take-off", title: "Send the measured quantity to the bill", pre: "N12 done, and the project has a bill in draft", data: "–",
      steps: steps("Choose a bill row under “Feeds bill row” (or leave “A new row”).", "Click Send 367,20 m² to the bill.", "Open Bill of Quantities."),
      expected: "The row carries 367,20 with “measured” under its amount. Add another line to the sheet: it now says the bill is behind the sheet. A signed bill cannot receive quantities.",
      repro: "New.",
    },
    // ── Site Meetings ──
    {
      id: "N15", area: "Site Meetings", title: "Minute a site meeting and send its actions to the board", pre: "A TEST project", data: "Three minutes, two of them actions (e.g. Contractor, by a date; Architect)",
      steps: steps("Open Construction → Site Meetings and open the minutes for meeting 1.", "Add the three minutes.", "Click “Send 2 actions to the board”, then open Project Management."),
      expected: "Minutes numbered 1.1, 1.2, 1.3. Two tasks appear on the board; each action links to its task and cannot be sent twice.",
      repro: "New.",
    },
    {
      id: "N16", area: "Site Meetings", title: "Issue the minutes; open actions carry forward", pre: "N15 done", data: "–",
      steps: steps("Click “Issue the minutes” and download.", "Click New meeting and open meeting 2."),
      expected: "A PDF with the heading, who was present, the numbered minutes and the action column. Meeting 2 starts with the open actions under “Matters arising”.",
      repro: "New.",
    },
    // ── Compliance ──
    {
      id: "N17", area: "Compliance", title: "The statutory and H&S register", pre: "A TEST project", data: "Occupation certificate approved 25 Oct 2029, reference OC 2029/0412",
      steps: steps("Open Construction → Compliance.", "Mark the occupation certificate Approved without a date and save; then add the date and reference.", "Give the H&S plan a “needed by” date in the past."),
      expected: bullets("12 requirements grouped by when they are needed, each with its regulation", "Approved without a date is refused", "The H&S plan is flagged “Overdue by … days” and counted at the top"),
      repro: "New.",
    },
    // ── FIDIC ──
    {
      id: "N18", area: "FIDIC", title: "A FIDIC job uses FIDIC’s names and time bar", pre: "A TEST project whose signed contract form reads FIDIC (e.g. correct Contract form to “FIDIC Conditions of Contract for Construction, 1999” before signing)", data: "A notice with an event date 30+ days before it was received",
      steps: steps("Issue a payment certificate.", "On Claims, record the late notice."),
      expected: "The certificate is an “Interim Payment Certificate” signed off for “The Engineer”. The notice shows “… days – outside the 28-day bar (Sub-Clause 20.1)” in red.",
      repro: "New.",
    },
    // ── Rate Library ──
    {
      id: "N19", area: "Rate Library", title: "Load and withdraw the simulated test rates", pre: "Rate Library", data: "–",
      steps: steps("Open Rate Library. If it says “Testing without real rates?”, click Load simulated test rates.", "Look at the rows.", "Do NOT withdraw them unless asked – other testers use them."),
      expected: "26 rates – bricks and blocks, walling, cement, sand, stone, concrete, steel and labour – each with source “Simulated test data – not a supplier quote”.",
      repro: "New – test data for the advisor, pricing and take-off.",
    },
  ];

  const scenarios = [
    {
      id: "S01", stage: "Construction – programme", title: "Approve the contractor’s programme as the baseline",
      role: "hold the contractor to an approved programme from site handover",
      pre: RIDGEVIEW3, data: "Construction programme.pdf",
      steps: steps("Read the programme (N01).", "Check every activity’s dates against the PDF.", "Sign off the baseline."),
      expected: bullets("13 activities, dates matching the PDF exactly", "Baseline 18 Sep 2026 – 18 Sep 2029", "Contract completion shown as 18 Sep 2029 – the programme finishes on it"),
      repro: "Does the programme finish on the contract date? Would you approve it as submitted?",
    },
    {
      id: "S02", stage: "Construction – progress", title: "Walk the job at the end of January 2027",
      role: "record where the works stand and see what is behind",
      pre: "S01 signed", data: "As at 31 Jan 2027: Site establishment 100%; Bulk earthworks 60% finishing 26 Feb 2027; Services 5%",
      steps: steps("Record progress as at 31 Jan 2027 with those figures.", "Read the Programme summary and the Cash Flow."),
      expected: bullets("Earthworks +28 days in red; overall progress stated as a percentage", "Cash Flow’s expected line moves later where the programme has slipped; certified to date is certificate 07’s gross"),
      repro: "Is 28 days on earthworks critical to completion? What would you ask the contractor for?",
    },
    {
      id: "S03", stage: "Construction – payment", title: "Certify payment certificate 07",
      role: "issue the certificate the contractor is paid on, and check every line",
      pre: "Valuations signed (certificate 07)", data: "Measurement record.pdf",
      steps: steps("Issue payment certificate 07 (N10).", "Recalculate it by hand from the measurement record."),
      expected: bullets(`Gross ${Rc(gross)} = work executed ${R(S.workExecuted, 2)} + variations ${R(S.variationValue, 2)} + dayworks ${R(S.dayworks, 2)} + materials ${R(S.materialsOnSite, 2)}`, `Retention ${S.retentionPercent}% ${Rc(retention)} (limit ${R(S.retentionLimit, 2)})`, `Amount due ${Rc(due)} including VAT of ${Rc(vat)}`),
      repro: "The measurement record deducts previously certified before retention; the platform applies retention to the gross first, as a JBCC certificate does. Which is right for this contract?",
    },
    {
      id: "S04", stage: "Construction – claims", title: "Assess an extension-of-time claim",
      role: "decide how many days the contractor is entitled to, and why",
      pre: "S01 signed", data: "Notice and claim as N07–N08: 21 days claimed for late landscaping drawings",
      steps: steps("Record the notice and lodge the claim.", "Look at the programme: which activity does the delay affect?", "Award what you can justify (the test expects 14) with a reason."),
      expected: bullets("Revised completion 2 Oct 2029", "Assessment frozen under your name", "Penalty exposure recalculated against the revised date"),
      repro: "Is 14 of 21 days defensible? What would the contractor need to show for the other seven?",
    },
    {
      id: "S05", stage: "Construction – site", title: "Run a site meeting from agenda to board",
      role: "keep the minutes and make sure every action is followed up",
      pre: "A TEST project", data: "Present: principal agent, contractor, architect. Minutes on progress, the recovery programme, and the landscaping drawings.",
      steps: steps("Minute the meeting (N15) with at least two actions.", "Send the actions to the board and assign them there.", "Issue the minutes and check the PDF."),
      expected: "Numbered minutes, actions on the board with their due dates, and a PDF that reads as issued minutes.",
      repro: "Would these minutes stand as a record in a dispute?",
    },
    {
      id: "S06", stage: "Close-out – practical completion", title: "Certify practical completion",
      role: "confirm the works are complete, what is outstanding, and what retention is released",
      pre: "S03 and S04 done", data: "Practical completion certificate.pdf",
      steps: steps("Open Handover, file Practical completion certificate.pdf against its requirement, run it and check the figures.", "Sign off.", "Issue the certificate of practical completion (N11)."),
      expected: bullets("Completion 2 Oct 2029; defects liability 90 calendar days; outstanding work R 186 400,00", "Against the revised date of 2 Oct 2029 it is on time – no penalty", `Half the retention released: ${Rc(released)}`, "Without the 14-day award it would be 14 days late: " + R(penalty * 14, 2)),
      repro: "Would you certify practical completion with that snag list outstanding?",
    },
    {
      id: "S07", stage: "Close-out – compliance", title: "Close out the statutory file",
      role: "make sure the building may lawfully be occupied and the H&S file is handed over",
      pre: "A TEST project", data: "Occupation certificate OC 2029/0412; electrical COC; H&S file",
      steps: steps("Update the at-completion requirements on Compliance with dates and references.", "Re-issue the practical completion certificate after the occupation certificate is approved (withdraw the first in Reports → Issued documents)."),
      expected: "Approved items show their dates and references. The new completion certificate states the occupation certificate’s date and reference; the first one said it did not permit occupation.",
      repro: "Which of the twelve would you not sign a completion certificate without?",
    },
    {
      id: "S08", stage: "Design – measurement", title: "Measure the brickwork and price it",
      role: "take off a wall from the drawings and see it priced from the rate library",
      pre: "A TEST project with a draft bill; simulated rates loaded", data: "As N12; rate “One-brick wall in stock brick, complete” R 685,00/m²",
      steps: steps("Measure the wall on a dimension sheet (N12) and send it to the bill.", "Open Pricing and apply the library rate to that row."),
      expected: "The bill row reads 367,20 m² measured, at R 685,00/m² = R 251 532,00.",
      repro: "Is the deduction for openings right under the standard system of measuring?",
    },
  ];

  const issues = [
    ["1", "F01", "Bill: about a second’s delay before the amount updated, with no sign of work; unclear whether a quick second edit was kept.", "Minor", "Fixed – confirm", "The typed figure now stays and the amount says “calculating…”; a second edit is queued. Confirm in F01."],
    ["2", "F02", "Bill: cells did not look editable.", "Minor", "Fixed – confirm", "Border and text cursor on hover. Confirm in F02."],
    ["3", "F03", "N10: brick suggestion gave general guidance, not rates and sources.", "Major", "Fixed – confirm", "The take-off is read from the question itself when the model answers in prose. Confirm in F03."],
    ["4", "F04", "Overview assistant: “bricks cost zar” gave general information.", "Major", "Fixed – confirm", "Price questions are answered from the Rate Library; simulated test rates added. Confirm in F04."],
    ["5", "F05", "Project Management: a link in a comment had to be copied and pasted.", "Minor", "Fixed – confirm", "Links are clickable. Confirm in F05."],
    ["6", "F06", "Project Management: reading comments meant opening the whole item.", "Minor", "Fixed – confirm", "The card’s comment count opens the thread alone. Confirm in F06."],
  ];

  return {
    label: "round 3",
    fileName: "QS Platform UAT Testing – round 3.xlsx",
    intro:
      "QS Platform — acceptance checklist, round 3. This round covers what was built after round 2: the construction programme, cash flow, claims, payment and completion certificates, take-off, site meetings and compliance. You do not need to be technical: each sheet says what to do and what should happen.",
    sheetsNote:
      "0 – Core checks (round 1’s tests, run again). 1 – Fixes to confirm (what round 2 reported, now fixed). 2 – New modules (one section per module). 3 – Junior QS scenarios (construction to close-out on the Ridgeview project; do S01 to S04 and S06 in order).",
    packNote: "It holds 18 PDFs for a made-up scheme called Ridgeview Gardens – two are new this round: Construction programme.pdf and Practical completion certificate.pdf. Every name and figure in them is invented.",
    extraBeforeStart: "Open Rate Library once and click “Load simulated test rates” if it offers to. The advisor and pricing tests need them.",
    fixesIntro: "What round 2 reported, now fixed. Open a section with the + at the left, follow the steps, and tell us what happened.",
    newName: "2. New modules",
    newTitle: "2. New modules",
    newIntro: "Everything built since round 2, one section per module. Each test says what to prepare, what to do and what you should see.",
    scenariosIntro: "Real principal-agent and QS work from programme approval to practical completion, on the Ridgeview project. Do S01–S04 and S06 in order; the rest stand alone. Check every figure against the documents.",
    issuesIntro: "One line per problem, referencing the test it came from. Round 2’s reports are listed first with what was done about them.",
    fixes,
    news,
    scenarios,
    issues,
  };
}
