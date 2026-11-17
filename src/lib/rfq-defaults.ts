/**
 * What an RFQ asks of every response unless the QS says otherwise – the checks a quotation is held
 * to before its price is worth comparing. Plain values, so the page can offer them without reaching
 * for the database.
 */
export const DEFAULT_REQUIREMENTS: readonly string[] = [
  "Addressed to the client and the project",
  "Dated, with a reference",
  "Validity period",
  "Professional registration",
  "Professional indemnity insurance",
  "B-BBEE status",
  "Fees calculated on the current ECSA fee guideline (2025)",
  "Signed by an authorised person",
];

/**
 * The facts every response should agree on, because a price comparison rests on them. Where two
 * responses state one differently, the platform says so and asks all of them to confirm it.
 */
export const DEFAULT_FACTS: readonly string[] = ["Site extent", "Construction estimate the price rests on", "Fee guideline and edition"];
