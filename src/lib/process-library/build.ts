/**
 * Terse constructors for the catalogue files, so a sub-process reads as its content rather than as
 * repeated field names. They add nothing but shape.
 */

import type { Gateway, Reference, RoleCode, SubProcess, Task } from "./types";

export function task(
  code: string,
  name: string,
  performer: RoleCode,
  does: string,
  inputs: readonly string[],
  outputs: readonly string[],
  extra: { with?: readonly RoleCode[]; references?: readonly Reference[] } = {},
): Task {
  return { code, name, performer, does, inputs, outputs, ...extra };
}

export function sub(
  code: string,
  name: string,
  owner: RoleCode,
  detail: {
    purpose: string;
    trigger: string;
    outcome: string;
    tasks: readonly Task[];
    gateway?: Gateway;
    references?: readonly Reference[];
  },
): SubProcess {
  return { code, name, owner, ...detail };
}

export const SOURCES = {
  PROCSA: "PROCSA development team matrix",
  SACQSP: "SACQSP Guideline Tariff 2024 (GG 52152)",
  FIDPM: "National Treasury FIDPM (2019)",
  JBCC: "JBCC 6.2 Guide to Completion and Payment",
  JBCC_PBA: "JBCC Principal Building Agreement",
  NBR: "National Building Regulations and Building Standards Act 103 of 1977",
  SANS10400: "SANS 10400 — The application of the National Building Regulations",
  CR2014: "Construction Regulations 2014 (OHS Act 85 of 1993)",
  NHBRC: "Housing Consumers Protection Measures Act 95 of 1998 (NHBRC)",
  SPLUMA: "Spatial Planning and Land Use Management Act 16 of 2013",
  NEMA: "NEMA Environmental Impact Assessment Regulations 2014",
  CIDB_SFU: "CIDB Standard for Uniformity in Construction Procurement",
  SSMBW: "ASAQS Standard System of Measuring Building Work",
  ASAQS_EST: "ASAQS Guide to Elemental Cost Estimating",
  PPPFA: "Preferential Procurement Policy Framework Act",
  GCC: "SAICE General Conditions of Contract for Construction Works",
  NEC: "NEC Engineering and Construction Contract",
} as const;
