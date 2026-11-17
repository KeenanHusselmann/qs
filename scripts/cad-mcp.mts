/**
 * The concept-layout reader as an MCP server over stdio.
 *
 *     npx tsx scripts/cad-mcp.mts [--root <folder>]...
 *
 * Register it with Claude Code from the repository root:
 *
 *     claude mcp add qs-cad -- npx tsx scripts/cad-mcp.mts --root fixtures/cad
 *
 * Then ask, for example: "open fixtures/cad/concept-layout.dxf and tell me which printed areas
 * disagree with the geometry". The tools are read-only and only read `.dxf` files inside the
 * folders given with --root (the working directory when none is given).
 *
 * stdout carries the protocol and nothing else – one JSON-RPC message per line. Anything for a
 * person goes to stderr, because a stray console.log on stdout corrupts the stream.
 */

import { readFileSync, realpathSync, statSync } from "node:fs";
import { createInterface } from "node:readline";

import { createCadServer } from "../src/lib/cad/mcp-server";

const roots: string[] = [];
for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === "--root" && process.argv[i + 1]) roots.push(process.argv[++i]!);

const server = createCadServer({
  roots: roots.length ? roots : [process.cwd()],
  files: { size: (p) => statSync(p).size, read: (p) => readFileSync(p, "utf8"), readBytes: (p) => new Uint8Array(readFileSync(p)), realpath: (p) => realpathSync(p) },
});

process.stderr.write(`qs-cad-reader: reading .dxf under ${(roots.length ? roots : [process.cwd()]).join(", ")}\n`);

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

async function answer(line: string) {
  if (line.trim() === "") return;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  try {
    const reply = await server.handle(message);
    if (reply) send(reply);
  } catch (e) {
    // The handler turns tool failures into results; reaching here is a fault in the server itself.
    process.stderr.write(`qs-cad-reader: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    const id = (message as { id?: string | number | null })?.id ?? null;
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } });
  }
}

/**
 * One message at a time, in the order they arrived. Opening a PDF is asynchronous, and the tools
 * share one open drawing: a client that sends "open" and "list" without waiting – which JSON-RPC
 * allows – would otherwise have "list" answered before "open" had finished, about no drawing.
 */
let queue: Promise<void> = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (line) => {
  queue = queue.then(() => answer(line));
});
