/**
 * What an assistant route receives: a question, the conversation so far, and any attached files.
 *
 * Shared by the project advisor and the overview assistant, which were two routes reading two
 * shapes. When the advisor learned to take attachments and history the overview did not, and the
 * reader saw one box grow and the other stay a single line.
 */

import { ATTACHMENT_PREFIX, type AskMode, type Turn } from "@/lib/agent/ask";
import { formatBytes, MAX_UPLOAD_BYTES } from "@/lib/ingest/limits";
import { advisorPrefix } from "@/lib/ingest/handover";
import { read } from "@/lib/ingest/storage";
import { READABLE_EXTENSIONS, parseDocument } from "@/lib/ingest/parse";
import type { Passage } from "@/lib/ingest/retrieve";
import { splitIntoPassages } from "@/lib/ingest/split";

/**
 * What one question may read, however it arrived. A body over the edge limit never reaches here in
 * production – the browser hands a large file to the store and sends its pathname instead – so this
 * is the reading limit, not the transport one.
 */
const MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES;
const MAX_ATTACHMENTS = 3;

export interface Attachment {
  documentId: string;
  name: string;
  passages: Passage[];
}

export interface AssistantRequest {
  question: string;
  web: boolean;
  history: Turn[];
  attachments: Attachment[];
  briefOnly: boolean;
  /** "documents" when the reader pressed the Project documents button. */
  mode: AskMode;
  /** Stored attachments the reader removed, to delete – a conversation's large files are not kept. */
  discard: string[];
}

/** Earlier turns, as the panel sent them. Anything that is not a plain turn is dropped. */
function readHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((turn): Turn[] => {
      const t = (turn ?? {}) as Record<string, unknown>;
      if ((t.role !== "user" && t.role !== "assistant") || typeof t.text !== "string") return [];
      return [{ role: t.role, text: t.text.slice(0, 1_200) }];
    })
    .slice(-8);
}

/**
 * JSON, or a form carrying files.
 *
 * ── Attachments are read, not filed ────────────────────────────────────────────────────────
 *
 * A file attached to a question is parsed here with the same reader filing uses, split the same
 * way, and handed to the model as passages under ids that start `attachment:`. Nothing is stored:
 * the reader decided to ask about it, not to put it on the project, and the panel offers filing as
 * a separate act. Throws with a sentence a reader can act on when a file cannot be read.
 */
export async function readAssistantRequest(request: Request, projectId: string | null = null): Promise<AssistantRequest> {
  const type = request.headers.get("content-type") ?? "";

  if (!type.includes("multipart/form-data")) {
    const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    return {
      question: typeof body.question === "string" ? body.question.trim() : "",
      /* Opt-in, per question. §1.3.2 scopes retrieval to the project in SQL and never by prompt,
         which is a privacy property as much as a correctness one — and a web search is the
         opposite, because it sends the words a reader typed out of the building. So it is never
         inferred. */
      web: body.web === true,
      history: readHistory(body.history),
      attachments: [],
      briefOnly: body.brief === true,
      mode: body.mode === "documents" ? "documents" : "general",
      discard: Array.isArray(body.discard) ? body.discard.filter((p): p is string => typeof p === "string") : [],
    };
  }

  const form = await request.formData();
  const sent = form.getAll("files").filter((f): f is File => f instanceof File);

  /*
    A large file arrives as the pathname it was uploaded to – the browser put it in the store
    once, and every question in the conversation reads it from there. Only from this project's
    advisor area: the pathname comes from the browser, and nothing else stops it naming another
    project's document.
  */
  const stored = (() => {
    try {
      return (JSON.parse(String(form.get("stored") ?? "[]")) as { pathname?: unknown; name?: unknown }[]).filter(
        (s): s is { pathname: string; name: string } => typeof s.pathname === "string" && typeof s.name === "string",
      );
    } catch {
      return [];
    }
  })();
  const fetched: File[] = [];
  for (const s of stored) {
    if (!projectId || !s.pathname.startsWith(advisorPrefix(projectId))) {
      throw new Error(`${s.name} was not uploaded to this project, so it cannot be read here.`);
    }
    const bytes = await read(s.pathname).catch(() => {
      throw new Error(`${s.name} could not be read back from storage. Attach it again.`);
    });
    fetched.push(new File([new Uint8Array(bytes)], s.name));
  }
  const files = [...sent, ...fetched].slice(0, MAX_ATTACHMENTS);

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Attachments are limited to ${formatBytes(MAX_ATTACHMENT_BYTES)} in total, and these come to ${formatBytes(total)}. File a document that large on the project instead and ask about it there.`,
    );
  }

  const attachments: Attachment[] = [];

  for (const [index, file] of files.entries()) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!(READABLE_EXTENSIONS as readonly string[]).includes(extension)) {
      throw new Error(
        `${file.name} cannot be read. The assistant reads ${READABLE_EXTENSIONS.map((e) => `.${e}`).join(", ")} files; a photo or scan needs its text first.`,
      );
    }

    const parsed = await parseDocument(file.name, new Uint8Array(await file.arrayBuffer()));
    const split = splitIntoPassages(parsed);
    if (split.length === 0) {
      throw new Error(
        `Nothing readable was found in ${file.name}${parsed.warning ? ` — ${parsed.warning}` : "."}`,
      );
    }

    const documentId = `${ATTACHMENT_PREFIX}${index}`;
    attachments.push({
      documentId,
      name: file.name,
      // Every passage: which of them the answer reads is decided against the question (`chooseAttached`).
      passages: split.map((p) => ({
        chunkId: `${documentId}:${p.index}`,
        documentId,
        page: p.page ?? null,
        body: p.text,
        rank: 0,
      })),
    });
  }

  const history = (() => {
    try {
      return readHistory(JSON.parse(String(form.get("history") ?? "[]")));
    } catch {
      return [];
    }
  })();

  return {
    question: String(form.get("question") ?? "").trim(),
    web: form.get("web") === "true",
    history,
    attachments,
    briefOnly: false,
    mode: form.get("mode") === "documents" ? "documents" : "general",
    discard: [],
  };
}

