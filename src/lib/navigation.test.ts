import { describe, expect, it } from "vitest";

import { PROJECT_NAV, processHrefOf } from "@/lib/navigation";
import { areaOf } from "@/lib/process-library";

describe("processHrefOf – a step's explanation in the process model", () => {
  it("opens the step's area, not the project page", () => {
    expect(processHrefOf("/rfq")).toBe("/process?area=D1.3");
    expect(processHrefOf("/bill")).toBe("/process?area=D1.2");
  });

  it("opens the first area where a step executes two", () => {
    expect(processHrefOf("/site")).toBe("/process?area=D3.1");
  });

  it("gives no link for a step with no area, or a path that is not a step", () => {
    expect(processHrefOf("/settings")).toBeNull();
    expect(processHrefOf("/no-such-step")).toBeNull();
    expect(processHrefOf("")).toBeNull();
  });

  /*
    The nav carries its codes as text and the process page reads them from the library. If the two
    ever disagree, a chip opens a page that says the area does not exist. This is where that is
    caught, so the helper can stay free of the library and the browser bundle stays small.
  */
  it("every step's link opens an area the process model has", () => {
    const steps = PROJECT_NAV.flatMap((group) => group.items).filter((item) => item.process);
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      const code = new URLSearchParams(processHrefOf(step.href)!.split("?")[1]).get("area")!;
      expect(areaOf(code), `${step.label} → ${code}`).not.toBeNull();
    }
  });
});
