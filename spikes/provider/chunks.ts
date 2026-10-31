/**
 * Synthetic, deterministic test data for the provider spike.
 *
 * The text describes a fictional company, so nothing private is ever sent to
 * a free tier that may use submitted content to improve its products.
 * 5 chunks hold distinctive facts; the other chunks are neutral filler about
 * unrelated topics. Questions with a known answer chunk let us check that
 * retrieval actually works, not just that vectors come back.
 */

export interface SyntheticChunk {
  index: number;
  text: string;
}

export interface SyntheticQuery {
  text: string;
  /** Chunk that contains the answer, or null for an unanswerable question. */
  expectedChunkIndex: number | null;
  /** Text a correct answer must contain, or null for unanswerable ones. */
  expectedSubstring: string | null;
}

export const FACT_CHUNK_INDICES = [7, 23, 41, 66, 88] as const;

const FACT_SENTENCES: Record<number, string> = {
  7: "Parental leave: every Brindlemoor employee receives 14 weeks of fully paid parental leave, and it can be split into two blocks within the first year.",
  23: "Laptop refresh: company laptops are replaced every 36 months, and the old machine is wiped before it is donated.",
  41: "Expense receipts: any single expense above 85 credits needs an itemised receipt attached to the claim.",
  66: "Emergency assembly: during a fire drill everyone gathers at the north car park, beside the blue shed.",
  88: "Help desk hours: the internal help desk answers calls from 08:30 to 16:45 on weekdays only.",
};

export const SYNTHETIC_QUERIES: readonly SyntheticQuery[] = [
  {
    text: "How many weeks of paid parental leave do employees get?",
    expectedChunkIndex: 7,
    expectedSubstring: "14 weeks",
  },
  {
    text: "How often are laptops replaced?",
    expectedChunkIndex: 23,
    expectedSubstring: "36 months",
  },
  {
    text: "From what amount is an itemised receipt required?",
    expectedChunkIndex: 41,
    expectedSubstring: "85",
  },
  {
    text: "Where do people gather during a fire drill?",
    expectedChunkIndex: 66,
    expectedSubstring: "north car park",
  },
  {
    text: "When does the help desk answer calls?",
    expectedChunkIndex: 88,
    expectedSubstring: "08:30",
  },
  {
    text: "What is the company policy on keeping goats on the roof?",
    expectedChunkIndex: null,
    expectedSubstring: null,
  },
];

/** The question used for the realistic RAG-style streaming prompt. */
export const RAG_QUESTION: SyntheticQuery = SYNTHETIC_QUERIES[0];

const TOPICS = [
  "visitor parking",
  "the kitchen rota",
  "bicycle storage",
  "printer queues",
  "plant watering",
  "recycling bins",
  "meeting room booking",
  "badge replacement",
  "the quarterly newsletter",
  "the book exchange shelf",
];

const TEMPLATES = [
  (topic: string, n: number) =>
    `Guidance on ${topic} is reviewed every ${n} weeks by the facilities group.`,
  (topic: string, n: number) =>
    `Questions about ${topic} should be sent to the building coordinator, who replies within ${n} working days.`,
  (topic: string, n: number) =>
    `A short checklist for ${topic} is pinned near the second-floor stairs and updated after about ${n} visits.`,
  (topic: string, n: number) =>
    `Volunteers who help with ${topic} are thanked in the monthly bulletin, which has run for ${n} years.`,
  (topic: string, n: number) =>
    `If ${topic} is unavailable, staff are asked to wait up to ${n} minutes before reporting it.`,
  (topic: string, n: number) =>
    `The shared notes about ${topic} were last tidied by team ${n}, and suggestions are welcome at any time.`,
];

/** Small deterministic PRNG so every run embeds exactly the same text. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TARGET_MIN_CHARS = 700;

function fillerSentences(index: number, startLength: number): string {
  const random = mulberry32(index + 1);
  let text = "";
  let length = startLength;
  while (length < TARGET_MIN_CHARS) {
    const topic = TOPICS[Math.floor(random() * TOPICS.length)];
    const template = TEMPLATES[Math.floor(random() * TEMPLATES.length)];
    const sentence = ` ${template(topic, 2 + Math.floor(random() * 9))}`;
    text += sentence;
    length += sentence.length;
  }
  return text;
}

export function buildChunks(count = 100): SyntheticChunk[] {
  const chunks: SyntheticChunk[] = [];
  for (let index = 0; index < count; index++) {
    const fact = FACT_SENTENCES[index] ?? "";
    const head = `Brindlemoor handbook, section ${index + 1}.${fact ? ` ${fact}` : ""}`;
    chunks.push({ index, text: head + fillerSentences(index, head.length) });
  }
  return chunks;
}
