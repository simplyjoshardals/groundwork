import { z } from "zod";

/** Longest question accepted, in characters (after trimming). */
export const MAX_QUESTION_LENGTH = 500;

const askRequestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  documentId: z.string().uuid().optional(),
});

export interface AskRequest {
  question: string;
  documentId?: string;
}

export type ParseAskRequestResult =
  | { ok: true; data: AskRequest }
  | { ok: false; message: string };

/**
 * Validates a decoded request body. Failure messages are fixed strings chosen
 * by field, never Zod's own text, so nothing about the schema internals or the
 * submitted value reaches the client.
 */
export function parseAskRequest(body: unknown): ParseAskRequestResult {
  const result = askRequestSchema.safeParse(body);
  if (result.success) {
    const { question, documentId } = result.data;
    return {
      ok: true,
      data: documentId === undefined ? { question } : { question, documentId },
    };
  }

  const field = result.error.issues[0]?.path[0];
  if (field === "question") {
    return {
      ok: false,
      message: `"question" must be text of 1 to ${MAX_QUESTION_LENGTH} characters.`,
    };
  }
  if (field === "documentId") {
    return { ok: false, message: '"documentId" must be a valid UUID.' };
  }
  return {
    ok: false,
    message: 'The request body must be a JSON object with a "question" string.',
  };
}
