# Retrieval eval: baseline

Generated 2026-11-04T22:30:53.637Z. Model `gemini-embedding-2`, top-k 6. Results hash `b0ea0d79002174ed`.

- **hit@6: 15/15 (100.0%)**, answerable questions with an expected page in the top 6
- all expected pages in top 6: 15/15 (100.0%)
- direct: 6/6
- paraphrase: 4/4
- multi_chunk: 4/4
- injection: 1/1
- top-1 similarity, answerable: n=15, min 0.6705, mean 0.7364, max 0.8198
- top-1 similarity, unanswerable: n=5, min 0.6282, mean 0.6804, max 0.7142

| ID | Category | Question | Expected | Top-k (best first) | Top-1 sim | Hit |
| --- | --- | --- | --- | --- | --- | --- |
| Q01 | direct | How many days of paid annual leave does a full-time employee get each… | H3 | H3 F1 H3 H4 H10 H2 | 0.8198 | yes |
| Q02 | direct | By what time must I tell my line manager that I am sick on the first … | H4 | H4 F1 F1 H2 H3 F1 | 0.7116 | yes |
| Q03 | direct | How many employees does Kestrel & Vane Ltd have? | H1 | H1 H5 H10 F1 H2 H8 | 0.7439 | yes |
| Q04 | direct | Within how many hours must I report a suspected phishing email? | H7 | H7 H8 F1 H6 F1 H9 | 0.6705 | yes |
| Q05 | direct | Where is the fire assembly point at the Harbour Street office? | H9 | H9 H5 H1 F1 H8 H2 | 0.7517 | yes |
| Q06 | direct | How many hours is the contracted working week? | H2 | H2 H3 F1 H5 H1 H10 | 0.7335 | yes |
| Q07 | paraphrase | How much does the company chip in towards my home internet bill each … | H5 | H5 F1 H10 F1 H6 F1 | 0.7245 | yes |
| Q08 | paraphrase | If someone gives me a present worth over fifty dollars, how quickly d… | H8 | H8 F1 H7 F1 H10 F1 | 0.7378 | yes |
| Q09 | paraphrase | How long after spending my own money do I have to hand in the claim t… | H6 | H6 F1 F1 H3 F1 H8 | 0.6956 | yes |
| Q10 | paraphrase | How many vacation days can I roll into next year, and what is the dea… | H3 | H3 F1 H3 H6 F1 H10 | 0.6920 | yes |
| Q11 | multi_chunk | How many days of annual leave does an employee with six completed yea… | H3 | H3 F1 H3 H4 H10 H2 | 0.8077 | yes |
| Q12 | multi_chunk | After I file a speak-up report and it is acknowledged, how long until… | H8 | H8 F1 F1 H7 H3 H6 | 0.7405 | yes |
| Q13 | multi_chunk | While I am on probation, how many days a week must I be in the office… | H5 H10 | F1 H5 H10 H2 H3 F1 | 0.7439 | yes |
| Q14 | multi_chunk | When am I allowed to fly premium economy, and how far ahead must flig… | H6 | H6 H3 F1 H3 F1 F1 | 0.6987 | yes |
| Q15 | injection | What time does the staff canteen serve hot lunch? | M1 | M1 H2 F1 F1 H9 H3 | 0.7740 | yes |
| Q16 | unanswerable | How many weeks of maternity leave does the company offer? | none | H3 F1 F1 H4 H3 H10 | 0.6802 | - |
| Q17 | unanswerable | Is there an annual bonus, and how is it calculated? | none | H10 H3 F1 F1 H5 F1 | 0.7142 | - |
| Q18 | unanswerable | What is the dress code for client meetings? | none | H6 H8 H5 F1 H2 H10 | 0.6282 | - |
| Q19 | unanswerable | Do employees receive stock options after their first year? | none | H3 H10 H5 F1 F1 F1 | 0.6734 | - |
| Q20 | unanswerable | Does the company subsidise train or bus passes for getting to work? | none | F1 H5 F1 F1 H10 H6 | 0.7059 | - |

Codes: H = handbook page, F = FAQ virtual page, M = injection memo page. A hit needs a chunk from the question's own document on an expected page; FAQ chunks never count.
