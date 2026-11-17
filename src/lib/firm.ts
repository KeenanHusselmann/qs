/**
 * Mzilikazi Property Services — who the practice is, in its own words.
 *
 * ── Where this came from ───────────────────────────────────────────────────────────────────
 *
 * Read from the practice's public site (mziprop.co.za) on 28 August 2026. The site is a React
 * single-page app, so the copy lives in its JavaScript bundle rather than in the served HTML —
 * worth knowing if it ever needs checking again, because fetching the page returns a 2,7 KB shell
 * and nothing else.
 *
 * It is quoted, not paraphrased. This is the practice describing itself, and a platform that
 * restated it in its own words would be putting words in a client's mouth on their own screen.
 *
 * ── Why it is here rather than in the page ─────────────────────────────────────────────────
 *
 * One place to correct. The main page is not the only surface that will want the practice's
 * positioning — a report cover and a printed footer both want the name and the line under it — and
 * three copies of a company's own description is how two of them go stale.
 *
 * Nothing here is a figure the platform computes. Everything on the main page that *is* a figure
 * comes from the database.
 */

export const FIRM = {
  name: "Mzilikazi Property Services",
  legalName: "Mzilikazi Property Services (Pty) Ltd",

  /** The line the practice leads with. */
  positioning:
    "A leading property development firm specializing in design, procurement, construction and " +
    "operation services across South Africa and beyond.",

  vision:
    "To be Africa's most trusted property development partner, pioneering sustainable " +
    "infrastructure that creates lasting value for communities and stakeholders.",

  mission:
    "To deliver innovative, sustainable property solutions that transform communities across " +
    "Africa, while maintaining the highest standards of quality and cost-effectiveness.",

  values:
    "Integrity, excellence, innovation and sustainability guide every decision we make. We are " +
    "committed to transparent partnerships and ethical business practices.",

  /** The practice's own headline numbers. Stated by the firm, not computed here. */
  scale: [
    { figure: "50+", label: "Professionals" },
    { figure: "100+", label: "Years combined experience" },
    { figure: "4", label: "Continents" },
  ],

  contact: {
    email: "info@mziprop.co.za",
    address: "1 Impala Road, Chislehurston, 2196",
    hours: "Mon – Fri, 08:30 – 17:00",
    site: "https://mziprop.co.za",
  },
} as const;

/**
 * The practice's six service lines, and how much of each this platform reaches today.
 *
 * `covers` is the honest half. The platform is a quantity surveying and cost management tool: it
 * covers the cost spine of a development and touches the rest only where cost does. Presenting it
 * as though it served all six equally would be the demo-driven claim §14 warns about, and the
 * first QS to open Property Operations would find out.
 */
export const SERVICE_LINES: readonly {
  name: string;
  summary: string;
  covers: "core" | "partial" | "none";
}[] = [
  {
    name: "Design & Architecture",
    summary: "Architectural design and planning, interior layout optimisation, cost analysis and optimisation.",
    covers: "partial",
  },
  {
    name: "Procurement & Supply Chain",
    summary: "Vendor management and selection, supply chain coordination, procurement compliance.",
    covers: "core",
  },
  {
    name: "Construction & Engineering",
    summary: "Project planning and scheduling, on-site management, quality control, safety compliance.",
    covers: "core",
  },
  {
    name: "Property Operations",
    summary: "Facility management, tenant relations, financial management and reporting.",
    covers: "none",
  },
  {
    name: "Strategic Advisory",
    summary: "Aligning business goals with development objectives on significant infrastructure projects.",
    covers: "partial",
  },
  {
    name: "Stakeholder Engagement",
    summary: "Bridging conflicts, identifying service gaps and improving communication between parties.",
    covers: "none",
  },
];

/** Where the practice's work is, from its stated areas of expertise. */
export const EXPERTISE: readonly { name: string; summary: string }[] = [
  {
    name: "Housing development",
    summary:
      "Large-scale housing and human settlements across South Africa, with particular focus on " +
      "affordable housing delivery.",
  },
  {
    name: "Infrastructure delivery",
    summary:
      "Infrastructure planning and delivery for public and private sector clients, spanning bulk " +
      "services and civil engineering.",
  },
  {
    name: "Governance",
    summary:
      "Governance and regulatory compliance for property development, ensuring projects meet all " +
      "standards and requirements.",
  },
];
