/**
 * Example questions shown as chips before the first ask. `question` is sent
 * verbatim, so each one must match an entry in `eval/dataset/qa.json` (a unit
 * test checks this): the answerable ones are known to be answered with
 * citations, and the unanswerable one is known to be refused.
 */
export interface ExampleQuestion {
  /** Short text on the chip. */
  label: string;
  /** What is actually asked. */
  question: string;
  /** True when the documents do not cover it (the refusal demo). */
  unanswerable: boolean;
}

export const EXAMPLE_QUESTIONS: readonly ExampleQuestion[] = [
  {
    label: "Paid annual leave",
    question:
      "How many days of paid annual leave does a full-time employee get each leave year?",
    unanswerable: false,
  },
  {
    label: "Fire assembly point",
    question: "Where is the fire assembly point at the Harbour Street office?",
    unanswerable: false,
  },
  {
    label: "Home internet allowance",
    question:
      "How much does the company chip in towards my home internet bill each month?",
    unanswerable: false,
  },
  {
    label: "Try one it can’t answer",
    question: "What is the dress code for client meetings?",
    unanswerable: true,
  },
];
