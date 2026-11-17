import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCadServer, PROTOCOL_VERSIONS } from "./mcp-server";
import { rect, writeDxf } from "@/domain/cad/write-dxf";

const ROOT = path.resolve("/drawings");
const files = new Map<string, string>([
  [path.join(ROOT, "plan.dxf"), writeDxf({ insunits: 4, entities: [rect("A-FOOTPRINT", 0, 0, 10_000, 5_000, "2A1"), { type: "TEXT", layer: "A-TEXT", at: [1000, 1000], height: 200, text: "GFA 48,0 m²" }] })],
  [path.join(ROOT, "binary.dxf"), "AutoCAD Binary DXF\r\n"],
  [path.join(ROOT, "link.dxf"), "linked"],
]);

const server = () =>
  createCadServer({
    roots: [ROOT],
    files: {
      size: (p) => {
        const f = files.get(p);
        if (f === undefined) throw new Error("ENOENT");
        return f.length;
      },
      read: (p) => files.get(p)!,
      readBytes: (p) => new TextEncoder().encode(files.get(p)!),
      // A link inside the allowed folder that points out of it.
      realpath: (p) => (p === path.join(ROOT, "link.dxf") ? path.resolve("/secrets/stolen.dxf") : p),
    },
  });

type Called = { result: { content: { text: string }[]; isError?: boolean } };
const call = async (s: ReturnType<typeof server>, name: string, args: Record<string, unknown> = {}, id = 1) =>
  (await s.handle({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })) as Called;

const json = (r: Called) => JSON.parse(r.result.content[0]!.text);

describe("the protocol", () => {
  it("answers initialize with the client's protocol version when it speaks it", async () => {
    const r = await server().handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(r).toMatchObject({ id: 0, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "qs-cad-reader" } } });
  });

  it("offers its newest version to a client asking for one it does not know", async () => {
    const r = await server().handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(r).toMatchObject({ result: { protocolVersion: PROTOCOL_VERSIONS[0] } });
  });

  it("stays silent on a notification and refuses an unknown method", async () => {
    const s = server();
    expect(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await s.handle({ jsonrpc: "2.0", id: 7, method: "resources/list" })).toMatchObject({ id: 7, error: { code: -32601 } });
    expect(await s.handle({ nonsense: true })).toMatchObject({ error: { code: -32600 } });
  });

  it("lists read-only tools, every one with a schema", async () => {
    const r = await server().handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as { result: { tools: { name: string; inputSchema: object; annotations: { readOnlyHint: boolean } }[] } };
    const names = r.result.tools.map((t) => t.name);
    expect(names).toEqual(["open_drawing", "inspect_drawing", "list_loops", "count_blocks", "check_areas", "find_text", "query_entities", "render"]);
    expect(r.result.tools.every((t) => t.annotations.readOnlyHint && t.inputSchema)).toBe(true);
  });
});

describe("confinement – what a prompt cannot talk the agent into reading", () => {
  it("refuses a link that points outside the allowed folders", async () => {
    expect((await call(server(), "open_drawing", { path: "link.dxf" })).result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/links to a file outside/) }] });
  });

  it("refuses a path with a NUL byte, an absolute path elsewhere, and the folder itself", async () => {
    const s = server();
    for (const p of ["plan.dxf\u0000.txt", path.resolve("/etc/plan.dxf"), "."]) {
      expect((await call(s, "open_drawing", { path: p })).result.isError).toBe(true);
    }
  });

  it("does not echo the server's folders back in its refusal", async () => {
    const text = (await call(server(), "open_drawing", { path: "../x.dxf" })).result.content[0]!.text;
    expect(text).not.toContain(ROOT);
  });
});

describe("the tools", () => {
  it("opens a drawing and measures it", async () => {
    const s = server();
    const opened = json(await call(s, "open_drawing", { path: "plan.dxf" }));
    expect(opened).toMatchObject({ loops: 1, units: { name: "millimetres" }, areaChecks: { agree: 0, disagree: 1 } });
    expect(json(await call(s, "list_loops"))).toEqual([expect.objectContaining({ id: "L1", area: 50, handles: ["2A1"] })]);
    expect(json(await call(s, "check_areas"))[0]).toMatchObject({ stated: 48, computed: 50, agrees: false });
  });

  it("renders a loop by its id, picking out the entities it came from", async () => {
    const s = server();
    await call(s, "open_drawing", { path: "plan.dxf" });
    const r = await call(s, "render", { highlight: ["L1"] });
    expect(r.result.content[0]!.text).toMatch(/^<svg/);
    expect(r.result.content[0]!.text).toContain('stroke="#4a7722"');
  });

  it("asks for a drawing before answering about one", async () => {
    const r = await call(server(), "list_loops");
    expect(r.result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/open_drawing first/) }] });
  });

  it("will not read outside its folders, or anything but a DXF", async () => {
    const s = server();
    expect((await call(s, "open_drawing", { path: "../etc/passwd.dxf" })).result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/outside the folders/) }] });
    expect((await call(s, "open_drawing", { path: "plan.dwg" })).result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/not a \.dxf/) }] });
  });

  it("reports a missing or unreadable file as a tool error the agent can read", async () => {
    const s = server();
    expect((await call(s, "open_drawing", { path: "nowhere.dxf" })).result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/could not be found/) }] });
    expect((await call(s, "open_drawing", { path: "binary.dxf" })).result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/binary DXF/) }] });
  });
});
