/**
 * Which family of contract a job is under, and the words and periods that follow from it.
 *
 * The platform was written JBCC-first: a principal agent, a payment certificate, a certificate of
 * practical completion. Under FIDIC the same acts carry different names and a different certifier
 * – the Engineer issues an Interim Payment Certificate and a Taking-Over Certificate – and a claim
 * is time-barred if its notice is late. A document issued under the wrong names is a document the
 * other side can dispute on its face, so the names are read from the contract the job signed.
 *
 * The form is read from the signed Contract step's "Contract form and edition" – the words a
 * contract prints on its cover – and only the family is decided here. Nothing is assumed where the
 * form is not stated: the JBCC names are the platform's default and the page says the form is not
 * established.
 */

export type ContractFamily = "jbcc" | "fidic" | "nec" | "gcc" | "unknown";

export function contractFamily(form: string | null | undefined): ContractFamily {
  const f = (form ?? "").toLowerCase();
  if (/\bfidic\b/.test(f)) return "fidic";
  if (/\bjbcc\b/.test(f)) return "jbcc";
  if (/\bnec\s*[34]?\b|engineering and construction contract/.test(f)) return "nec";
  if (/\bgcc\b|general conditions of contract for construction works/.test(f)) return "gcc";
  return "unknown";
}

export interface ContractTerms {
  family: ContractFamily;
  paymentCertificate: string;
  completionCertificate: string;
  certifier: string;
  /** Calendar days within which notice of a claim must be given, where the form sets a bar. */
  noticeDays: number | null;
  /** The clause that sets it, cited beside the flag. */
  noticeClause: string | null;
}

/** 2017 edition where the form says so; the 1999 Red Book numbering otherwise. */
export function contractTerms(form: string | null | undefined): ContractTerms {
  const family = contractFamily(form);
  if (family === "fidic") {
    const edition2017 = /2017/.test(form ?? "");
    return {
      family,
      paymentCertificate: "Interim Payment Certificate",
      completionCertificate: "Taking-Over Certificate",
      certifier: "The Engineer",
      noticeDays: 28,
      noticeClause: edition2017 ? "Sub-Clause 20.2.1" : "Sub-Clause 20.1",
    };
  }
  return {
    family,
    paymentCertificate: "Payment Certificate",
    completionCertificate: "Certificate of Practical Completion",
    certifier: "Principal agent / quantity surveyor",
    noticeDays: null,
    noticeClause: null,
  };
}

/**
 * Whether a notice was given within the form's bar. Null where the form sets none or either date
 * is not known – the absence of a bar is not the same as a notice in time.
 */
export function noticeTimeBar(terms: ContractTerms, eventOn: string | null, receivedOn: string): { late: boolean; days: number } | null {
  if (terms.noticeDays === null || !eventOn) return null;
  const days = Math.round((Date.parse(receivedOn) - Date.parse(eventOn)) / 86_400_000);
  return { late: days > terms.noticeDays, days };
}
