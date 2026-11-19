import type { InitialDocuments } from "@/components/document-list";
import type { DocumentStatus } from "@/lib/documents/document-status";
import type { OwnDocument } from "@/lib/documents/list-own-documents";
import {
  REMOVE_NETWORK_MESSAGE,
  REMOVE_SESSION_ENDED_MESSAGE,
  type DocumentsSource,
  type RemoveDocumentResult,
} from "@/lib/documents/source";
import type { DocScenario } from "@/lib/documents/dev-scenario-names";
import type { RequestIngestResult } from "@/lib/upload/request-ingest";
import { titleFromFileName, validateUploadFile } from "@/lib/upload/file-checks";
import { UPLOADS_PAUSED_MESSAGE } from "@/lib/upload/limits";
import type { UploadResult } from "@/lib/upload/upload-document";

/**
 * Scripted data for the documents drill (`/dev-states/documents/<scenario>`).
 * The real components run against a `DocumentsSource` that is fully in memory:
 * no Supabase, no `fetch`. Upload still runs the real file checks, so a
 * wrong type or an empty file is refused with the real messages. Dev only.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Step {
  afterMs: number;
  status: DocumentStatus;
  pageCount?: number;
}

interface Setup {
  docs: OwnDocument[];
  /** Status changes over time, by document id (what the server would do). */
  steps?: Readonly<Record<string, readonly Step[]>>;
  /** `false`: no server data at all, so the shelf shows its loading skeleton. */
  initial?: "docs" | "failed" | "none";
  listDelayMs?: number;
  /** How many client reads fail before they work; `Infinity` for always. */
  listFailures?: number;
  uploadDelayMs?: number;
  ingestDelayMs?: number;
  removeDelayMs?: number;
  upload?: "ok" | "paused";
  ingest?: (documentId: string, attempt: number) => RequestIngestResult | null;
  /** The document an upload with this outcome leaves behind. */
  uploadedAs?: (id: string, title: string, now: number) => OwnDocument;
  remove?: (attempt: number) => RemoveDocumentResult;
}

function doc(now: number, over: Partial<OwnDocument> & { id: string }): OwnDocument {
  return {
    title: "Lease agreement",
    originalFilename: "lease.pdf",
    status: "ready",
    errorReason: null,
    pageCount: 4,
    chunkCount: 8,
    createdAt: new Date(now - 2 * DAY).toISOString(),
    processingStartedAt: null,
    ...over,
  };
}

function setupFor(name: DocScenario, now: number): Setup {
  const ready = (id: string, title: string, file: string, pages: number | null, ago: number) =>
    doc(now, {
      id,
      title,
      originalFilename: file,
      pageCount: pages,
      createdAt: new Date(now - ago).toISOString(),
    });

  switch (name) {
    case "mixed":
      return {
        docs: [
          ready("r1", "Lease agreement", "lease.pdf", 12, 2 * DAY),
          ready("r2", "Meeting notes", "meeting-notes.md", null, 3 * HOUR),
          doc(now, {
            id: "q1",
            title: "Quarterly report with a long title that has to wrap onto a second line",
            originalFilename: "quarterly-report.pdf",
            status: "queued",
            pageCount: null,
            createdAt: new Date(now - 20 * SECOND).toISOString(),
          }),
          doc(now, {
            id: "p1",
            title: "Handbook",
            originalFilename: "handbook.pdf",
            status: "processing",
            pageCount: null,
            createdAt: new Date(now - MINUTE).toISOString(),
            processingStartedAt: new Date(now - 30 * SECOND).toISOString(),
          }),
          doc(now, {
            id: "f1",
            title: "Scanned receipt",
            originalFilename: "receipt.pdf",
            status: "failed",
            errorReason: "scanned_pdf",
            pageCount: null,
            createdAt: new Date(now - 10 * MINUTE).toISOString(),
          }),
          doc(now, {
            id: "f2",
            title: "Contract",
            originalFilename: "contract.pdf",
            status: "failed",
            errorReason: "provider_unavailable",
            pageCount: null,
            createdAt: new Date(now - 5 * HOUR).toISOString(),
          }),
          doc(now, {
            id: "s1",
            title: "Old upload",
            originalFilename: "old.txt",
            status: "processing",
            pageCount: null,
            createdAt: new Date(now - 40 * MINUTE).toISOString(),
            processingStartedAt: new Date(now - 25 * MINUTE).toISOString(),
          }),
        ],
        steps: {
          q1: [
            { afterMs: 6 * SECOND, status: "processing" },
            { afterMs: 14 * SECOND, status: "ready", pageCount: 9 },
          ],
          p1: [{ afterMs: 10 * SECOND, status: "ready", pageCount: 5 }],
        },
      };
    case "empty":
      return { docs: [], ingestDelayMs: 3 * SECOND };
    case "slow":
      return {
        docs: [ready("r1", "Lease agreement", "lease.pdf", 12, 2 * DAY)],
        initial: "none",
        listDelayMs: 3 * SECOND,
        uploadDelayMs: 4 * SECOND,
        ingestDelayMs: 8 * SECOND,
        removeDelayMs: 3 * SECOND,
      };
    case "load-error":
      return { docs: [ready("r1", "Lease agreement", "lease.pdf", 12, 2 * DAY)], initial: "failed", listFailures: 2 };
    case "refresh-error":
      return {
        docs: [
          ready("r1", "Lease agreement", "lease.pdf", 12, 2 * DAY),
          doc(now, {
            id: "p1",
            title: "Handbook",
            originalFilename: "handbook.pdf",
            status: "processing",
            pageCount: null,
            processingStartedAt: new Date(now - 30 * SECOND).toISOString(),
          }),
        ],
        listFailures: Infinity,
      };
    case "stuck":
      return {
        docs: [
          doc(now, {
            id: "s1",
            title: "Never started",
            originalFilename: "never-started.pdf",
            status: "queued",
            pageCount: null,
            createdAt: new Date(now - 5 * MINUTE).toISOString(),
          }),
          doc(now, {
            id: "s2",
            title: "Stalled",
            originalFilename: "stalled.pdf",
            status: "processing",
            pageCount: null,
            createdAt: new Date(now - 30 * MINUTE).toISOString(),
            processingStartedAt: new Date(now - 25 * MINUTE).toISOString(),
          }),
        ],
        ingestDelayMs: 2 * SECOND,
      };
    case "retry-notes":
      return {
        docs: ["a", "b", "c"].map((k, i) =>
          doc(now, {
            id: `s-${k}`,
            title: ["First stuck", "Second stuck", "Third stuck"][i],
            originalFilename: `stuck-${k}.pdf`,
            status: "processing",
            pageCount: null,
            createdAt: new Date(now - 30 * MINUTE).toISOString(),
            processingStartedAt: new Date(now - 25 * MINUTE).toISOString(),
          }),
        ),
        ingest: (id) =>
          id === "s-a"
            ? { status: "no_op" }
            : id === "s-b"
              ? { status: "unconfirmed" }
              : { status: "limit", reason: "cooldown" },
      };
    case "cap":
      return {
        docs: Array.from({ length: 10 }, (_, i) =>
          ready(`c${i}`, `Document ${i + 1}`, `document-${i + 1}.pdf`, 3 + i, (i + 1) * HOUR),
        ),
      };
    case "paused":
      return {
        docs: [
          ready("r1", "Lease agreement", "lease.pdf", 12, 2 * DAY),
          ready("r2", "Meeting notes", "meeting-notes.md", null, 3 * HOUR),
        ],
        upload: "paused",
      };
    case "scanned":
      return {
        docs: [],
        ingest: () => ({ status: "failed", reason: "scanned_pdf" }),
        uploadedAs: (id, title, t) =>
          doc(t, {
            id,
            title,
            status: "failed",
            errorReason: "scanned_pdf",
            pageCount: null,
            createdAt: new Date(t).toISOString(),
          }),
      };
    case "ingest-limit":
      return {
        docs: [],
        ingest: () => ({
          status: "limit",
          reason: "user_limit",
          resetsAt: new Date(now + 6 * HOUR).toISOString(),
        }),
        uploadedAs: (id, title, t) =>
          doc(t, {
            id,
            title,
            status: "queued",
            pageCount: null,
            createdAt: new Date(t).toISOString(),
          }),
      };
    case "delete-error":
      return {
        docs: [ready("r1", "Lease agreement", "lease.pdf", 12, 2 * DAY), ready("r2", "Meeting notes", "meeting-notes.md", null, 3 * HOUR)],
        remove: (attempt) =>
          attempt === 1
            ? { ok: false, kind: "network", message: REMOVE_NETWORK_MESSAGE }
            : { ok: true },
      };
    case "session-ended":
      return {
        docs: [ready("r1", "Lease agreement", "lease.pdf", 12, 2 * DAY)],
        remove: () => ({
          ok: false,
          kind: "session_ended",
          message: REMOVE_SESSION_ENDED_MESSAGE,
        }),
      };
  }
}

export interface Scenario {
  /** What the server would have sent with the page. */
  initial: InitialDocuments | undefined;
  source: DocumentsSource;
}

/** Builds a fresh scenario. `now` comes from the server page, not from render. */
export function createScenario(name: DocScenario, now: number): Scenario {
  const setup = setupFor(name, now);
  let docs = [...setup.docs];
  const startedAt = Date.now();
  let listFailed = 0;
  let removeAttempts = 0;
  const ingestAttempts = new Map<string, number>();
  const stepsById = new Map<string, readonly Step[]>(
    Object.entries(setup.steps ?? {}),
  );

  function view(): OwnDocument[] {
    const elapsed = Date.now() - startedAt;
    return docs.map((d) => {
      const steps = stepsById.get(d.id);
      if (!steps) return d;
      let current: OwnDocument = d;
      for (const step of steps) {
        if (elapsed < step.afterMs) break;
        current = {
          ...d,
          status: step.status,
          pageCount: step.pageCount ?? d.pageCount,
          processingStartedAt:
            step.status === "processing"
              ? new Date(Date.now()).toISOString()
              : d.processingStartedAt,
        };
      }
      return current;
    });
  }

  const source: DocumentsSource = {
    async list() {
      if (setup.listDelayMs) await wait(setup.listDelayMs);
      if (listFailed < (setup.listFailures ?? 0)) {
        listFailed += 1;
        return { ok: false, reason: "failed" };
      }
      return { ok: true, documents: view() };
    },

    async upload(file): Promise<UploadResult> {
      if (setup.uploadDelayMs) await wait(setup.uploadDelayMs);
      else await wait(600);
      const check = validateUploadFile(file);
      if (!check.ok) return { ok: false, reason: check.reason, message: check.message };
      if (setup.upload === "paused") {
        return { ok: false, reason: "budget_exhausted", message: UPLOADS_PAUSED_MESSAGE };
      }
      const id = `up-${docs.length}-${Math.random().toString(36).slice(2, 8)}`;
      const title = titleFromFileName(file.name);
      const row =
        setup.uploadedAs?.(id, title, Date.now()) ??
        doc(Date.now(), {
          id,
          title,
          originalFilename: file.name,
          status: "queued",
          pageCount: null,
          createdAt: new Date().toISOString(),
        });
      docs = [row, ...docs];
      return { ok: true, documentId: id, storagePath: `dev/${id}`, title };
    },

    async ingest(documentId): Promise<RequestIngestResult> {
      const attempt = (ingestAttempts.get(documentId) ?? 0) + 1;
      ingestAttempts.set(documentId, attempt);
      await wait(setup.ingestDelayMs ?? 1500);
      const scripted = setup.ingest?.(documentId, attempt);
      if (scripted) return scripted;
      docs = docs.map((d) =>
        d.id === documentId
          ? { ...d, status: "ready", errorReason: null, pageCount: 3, chunkCount: 9 }
          : d,
      );
      stepsById.delete(documentId);
      return { status: "ready", pageCount: 3, chunkCount: 9 };
    },

    async remove(documentId): Promise<RemoveDocumentResult> {
      await wait(setup.removeDelayMs ?? 500);
      removeAttempts += 1;
      const result = setup.remove?.(removeAttempts) ?? { ok: true as const };
      if (result.ok) docs = docs.filter((d) => d.id !== documentId);
      return result;
    },
  };

  let initial: InitialDocuments | undefined;
  if (setup.initial === "failed") initial = { ok: false };
  else if (setup.initial === "none") initial = undefined;
  else initial = { ok: true, documents: view(), fetchedAt: now };

  return { initial, source };
}
