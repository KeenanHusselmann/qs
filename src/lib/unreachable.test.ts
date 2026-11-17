/**
 * What a reader is told when something fails.
 *
 * A quantity surveyor pressed a button, got no work back, and was shown "The model's reply was not
 * the JSON it was asked for." Three facts they have no use for, and nothing to do next. This pins
 * the rule that replaced it: a failure message names what failed and what to do, in the product's
 * own vocabulary, and the protocol goes to the log.
 */

import { describe, expect, it } from "vitest";

import { ModelUnavailable } from "@/lib/agent/deepseek";
import { whyUnreachable } from "@/lib/unreachable";

/** Words that describe how the platform is built rather than what happened to the reader's work. */
const JARGON = /\bJSON\b|\bHTTP\b|\bAPI\b|\bapi[_ ]key\b|\btoken\b|\bstatus code\b|\b[45]\d\d\b|_[a-z]+_|DEEPSEEK/i;

describe("a failure says what to do, not how the platform is built", () => {
  const cases = [
    [401, "The advisor"],
    [403, "The advisor"],
    [408, "The assistant"],
    [429, "The agent"],
    [500, "The agent"],
    [503, "The advisor"],
    [504, "The assistant"],
    [400, "The agent"],
    [418, "The agent"],
  ] as const;

  it.each(cases)("%i carries no jargon", (status, what) => {
    expect(whyUnreachable(status, what)).not.toMatch(JARGON);
  });

  it.each(cases)("%i says what could not be reached", (status, what) => {
    expect(whyUnreachable(status, what)).toContain(what);
  });

  it("tells the reader whether it is worth trying again", () => {
    expect(whyUnreachable(503, "The agent")).toMatch(/try again/i);
    expect(whyUnreachable(429, "The agent")).toMatch(/try again/i);
    // A 4xx that is not a session or a rate limit is not worth retrying, and says so instead.
    expect(whyUnreachable(400, "The agent")).toMatch(/report it/i);
  });

  it("a session that ended sends the reader to sign in, not to retry", () => {
    expect(whyUnreachable(401, "The advisor")).toMatch(/sign in again/i);
  });
});

describe("the technical cause is kept, and kept out of the message", () => {
  it("carries a detail for the log", () => {
    const error = new ModelUnavailable("The agent is unavailable at the moment.", "HTTP 503: upstream timeout");
    expect(error.detail).toBe("HTTP 503: upstream timeout");
    expect(error.message).not.toMatch(JARGON);
  });

  it("a failure with nothing technical to say carries no detail rather than an empty one", () => {
    expect(new ModelUnavailable("The agent returned nothing at all.").detail).toBeNull();
  });
});
