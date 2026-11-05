# Refusal threshold calibration: baseline

Source: retrieval eval `baseline`, model `gemini-embedding-2`, top-k 6. Rule: refuse when top-1 similarity is below the threshold.

- top-1 similarity, answerable: n=15, min 0.6705, mean 0.7364, max 0.8198
- top-1 similarity, unanswerable: n=5, min 0.6282, mean 0.6804, max 0.7142
- overlap: 0.6705 to 0.7142, so no threshold separates the two groups
- AUC: 0.853 (1.0 is perfect separation, 0.5 is chance)
- widest no-false-refusal floor: 0.6494, halfway between the highest unanswerable score under every answerable one (0.6282) and the lowest answerable score (0.6705)

## Configured threshold: 0.65

- answerable questions refused (false refusals): 0/15
- unanswerable questions refused by gate #1: 1/5; the rest must be handled by gate #2 (Task 2.5)
- margin to the lowest answerable score: 0.0205
- margin to the highest unanswerable score under the threshold: 0.0218

## Threshold sweep

| Threshold | False refusals (answerable) | Caught (unanswerable) |
| --- | --- | --- |
| 0.60 | 0/15 | 0/5 |
| 0.61 | 0/15 | 0/5 |
| 0.62 | 0/15 | 0/5 |
| 0.63 | 0/15 | 1/5 |
| 0.64 | 0/15 | 1/5 |
| 0.65 | 0/15 | 1/5 |
| 0.66 | 0/15 | 1/5 |
| 0.67 | 0/15 | 1/5 |
| 0.68 | 1/15 | 2/5 |
| 0.69 | 1/15 | 3/5 |
| 0.70 | 4/15 | 3/5 |
| 0.71 | 4/15 | 4/5 |
| 0.72 | 5/15 | 5/5 |
| 0.73 | 6/15 | 5/5 |
| 0.74 | 8/15 | 5/5 |
| 0.75 | 11/15 | 5/5 |
| 0.76 | 12/15 | 5/5 |

## Distribution (bins of 0.02; A = answerable, U = unanswerable)

```
0.62                   U
0.64
0.66  A                U
0.68  AAA              U
0.70  A                UU
0.72  AAA
0.74  AAAA
0.76  A
0.78
0.80  AA
```

Limits: few questions (see the counts above) and one document, so every number here is an estimate; the real distributions will be wider.
