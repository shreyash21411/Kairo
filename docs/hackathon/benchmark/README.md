# VOIDZONE Continuity — Benchmark Plan

## 1. Research question

Does a structured continuity package help a receiving AI assistant preserve project state and identify useful next actions better than a fresh session given only a short project description?

This is a testable hypothesis, not a result.

## 2. Comparison conditions

### Condition A — Fresh-session baseline

Give the receiving assistant a concise project description and the task prompt, but no continuity package.

### Condition B — Continuity-assisted session

Give the same receiving assistant the same task prompt plus a user-reviewed VOIDZONE Continuity package generated from the source context.

Keep the model, task, evaluation rubric, and other settings as similar as practical. Record any unavoidable differences.

## 3. Task set

Create a small, fixed set of tasks based on representative project context. Examples:

1. Identify the current architecture and its constraints.
2. Identify which decisions have already been made.
3. Identify incomplete work and propose the next step.
4. Avoid repeating a completed task.
5. Identify conflicting statements or missing evidence.

Use context the evaluator is authorized to use. Redact credentials and private information.

## 4. Metrics

Score each condition using the same rubric.

| Metric | Measurement |
|---|---|
| Fact preservation | Supported facts correctly retained / required facts |
| Decision preservation | Relevant prior decisions correctly identified / required decisions |
| Constraint preservation | Relevant constraints correctly retained / required constraints |
| Open-task identification | Correct pending tasks identified / known pending tasks |
| Unsupported claims | Count of material claims unsupported by the supplied context |
| Next-action quality | Rubric score from 0 to 4 |
| Completion time | Elapsed time using a documented timing method |

Define the scoring rules before evaluating the outputs. Avoid changing the rubric after seeing which condition performs better.

## 5. Suggested 0–4 next-action rubric

- **0:** Irrelevant or unusable.
- **1:** Major omissions or conflicts with the supplied context.
- **2:** Partially useful but misses important constraints or tasks.
- **3:** Relevant and mostly accurate, with minor omissions.
- **4:** Relevant, accurate, respects constraints, and proposes a justified next step.

Use the same rubric for both conditions.

## 6. Execution procedure

1. Freeze the task set and scoring rubric.
2. Save the source context securely and prepare a redacted evaluation copy.
3. Generate and review the continuity package.
4. Run Condition A and save its output.
5. Run Condition B and save its output.
6. Score both outputs against the same reference facts and task criteria.
7. Repeat trials if time allows and document the number of trials.
8. Calculate results from saved outputs.
9. Record failures, provider/model settings, limitations, and any manual interventions.

Avoid using the same model response to both generate the answer and serve as the only judge of its quality. Prefer a fixed answer key and independent review where practical.

## 7. Results

No benchmark results have been recorded yet.

| Metric | Baseline | Continuity | Difference |
|---|---:|---:|---:|
| Fact preservation | TBD | TBD | TBD |
| Decision preservation | TBD | TBD | TBD |
| Constraint preservation | TBD | TBD | TBD |
| Open-task identification | TBD | TBD | TBD |
| Unsupported claims | TBD | TBD | TBD |
| Next-action quality (0–4) | TBD | TBD | TBD |
| Completion time | TBD | TBD | TBD |

Replace placeholders only with measurements calculated from actual trials. State sample size and explain the meaning of every reported difference.

## 8. Limitations to report

- Small task sets may not generalize to other projects.
- Model outputs can vary between runs.
- Source context may omit information needed for a correct answer.
- A generated package can itself introduce omissions or unsupported claims.
- Human scoring can be subjective.
- Results from one model or task type do not prove universal compatibility.

## 9. Artifacts

Save sanitized task definitions, outputs, scoring sheets, and a machine-readable results file in this directory or the parent `evidence/` directory. Do not commit API keys or sensitive raw conversation exports.
