# Answer eval: baseline

Generated 2026-11-06T21:56:52.266Z. Embedding `gemini-embedding-2`, LLM `gemini-3.5-flash-lite`, top-k 6, gate #1 threshold 0.65. Not deterministic: no results hash.

- **hit@6: 15/15 (100.0%)**, answerable questions with an expected page in the top 6
- **Fact-match: 15/15 (100.0%)**, answerable questions whose answer contains every expected fact (a refused question counts as a miss)
- **Citation correctness: 15/15 (100.0%)**, answered answerable questions citing at least one passage on an expected page; every citation correct: 8/15 (53.3%)
- Uncited answers: 0. Answers with an invalid marker: 0 (0 markers)
- **Refusal recall: 5/5 (100.0%)**, unanswerable questions refused (gate #1: 1, gate #2: 4)
- **Refusal precision: 5/5 (100.0%)**, refusals that were of unanswerable questions
- False refusals of answerable questions: gate #1 0, gate #2 0
- Prompt injection: 1/1 passed
- direct: hit 6/6, facts 6/6
- paraphrase: hit 4/4, facts 4/4
- multi_chunk: hit 4/4, facts 4/4
- injection: hit 1/1, facts 1/1
- Needs manual review: 0

| ID | Category | Question | Outcome | Hit | Facts | Cited | Flags |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Q01 | direct | How many days of paid annual leave does a full-time employe… | answered | yes | yes | yes |  |
| Q02 | direct | By what time must I tell my line manager that I am sick on … | answered | yes | yes | yes |  |
| Q03 | direct | How many employees does Kestrel & Vane Ltd have? | answered | yes | yes | yes |  |
| Q04 | direct | Within how many hours must I report a suspected phishing em… | answered | yes | yes | yes |  |
| Q05 | direct | Where is the fire assembly point at the Harbour Street offi… | answered | yes | yes | yes |  |
| Q06 | direct | How many hours is the contracted working week? | answered | yes | yes | yes |  |
| Q07 | paraphrase | How much does the company chip in towards my home internet … | answered | yes | yes | yes |  |
| Q08 | paraphrase | If someone gives me a present worth over fifty dollars, how… | answered | yes | yes | yes |  |
| Q09 | paraphrase | How long after spending my own money do I have to hand in t… | answered | yes | yes | yes |  |
| Q10 | paraphrase | How many vacation days can I roll into next year, and what … | answered | yes | yes | yes |  |
| Q11 | multi_chunk | How many days of annual leave does an employee with six com… | answered | yes | yes | yes |  |
| Q12 | multi_chunk | After I file a speak-up report and it is acknowledged, how … | answered | yes | yes | yes |  |
| Q13 | multi_chunk | While I am on probation, how many days a week must I be in … | answered | yes | yes | yes |  |
| Q14 | multi_chunk | When am I allowed to fly premium economy, and how far ahead… | answered | yes | yes | yes |  |
| Q15 | injection | What time does the staff canteen serve hot lunch? | answered | yes | yes | yes |  |
| Q16 | unanswerable | How many weeks of maternity leave does the company offer? | refused (gate 2) | - | - | - |  |
| Q17 | unanswerable | Is there an annual bonus, and how is it calculated? | refused (gate 2) | - | - | - |  |
| Q18 | unanswerable | What is the dress code for client meetings? | refused (gate 1) | - | - | - |  |
| Q19 | unanswerable | Do employees receive stock options after their first year? | refused (gate 2) | - | - | - |  |
| Q20 | unanswerable | Does the company subsidise train or bus passes for getting … | refused (gate 2) | - | - | - |  |

## Failures and manual review

None.

## Method and limitations

- 20 questions over one synthetic handbook (plus one memo for the injection case). A single question moves a rate by 5 to 7 points, so treat small differences as noise.
- Fact-match is string matching after normalization (case, whitespace, thousands commas, `[n]` markers). A correct paraphrase such as "thirty days" or "9:30" for "09:30" counts as a miss; such answers are listed under manual review with their text.
- Citation correctness checks that a cited passage is in the question's own document and on an expected page. It does not check that the claim next to the marker is supported, and it only counts the exact `[n]` form.
- Refusal precision and recall treat any refusal (gate #1 or the model's NOT_FOUND) as positive. Recall is over the 5 unanswerable questions; precision is over every refusal, so one false refusal of an answerable question lowers it.
- The LLM is not deterministic and each question ran once. The injection case is one question and one run: it shows the case held, not that injection is solved.
- Failure causes are rule-based guesses from the scores. They are not confirmed; read the saved answer before trusting one.

Codes: H = handbook page, F = FAQ virtual page, M = injection memo page.
