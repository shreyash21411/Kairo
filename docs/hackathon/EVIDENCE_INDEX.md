# VOIDZONE Continuity — Evidence Index

This index points to evidence supporting implementation, provenance, testing, and demo claims.

Only add an artifact after it exists and has been reviewed for secrets and sensitive data.

## 1. Repository provenance

| Evidence | Location | Status |
|---|---|---|
| Recorded baseline commit | `a6780259a01663587569241c3b5051947ac8116c` | Recorded |
| Hackathon working branch | `hackathon/voidzone-continuity` | Created |
| Baseline vs. final diff | To be generated before submission | Pending |
| Feature implementation commits | Git history | Pending |

## 2. Implementation evidence

| Claim | File or artifact | Test / verification | Status |
|---|---|---|---|
| Context input works | TBD | TBD | Pending |
| Structured extraction works | TBD | TBD | Pending |
| Output schema is validated | TBD | TBD | Pending |
| Contradictions and uncertainty are surfaced | TBD | TBD | Pending |
| User can review and edit state | TBD | TBD | Pending |
| Continuation package can be exported | TBD | TBD | Pending |
| Errors are handled safely | TBD | TBD | Pending |

## 3. Test evidence

For each test run, record the command, date, exit code, passed/failed/skipped counts, and saved output path.

| Test suite | Command | Result artifact | Status |
|---|---|---|---|
| Unit tests | TBD | TBD | Pending |
| API / integration tests | TBD | TBD | Pending |
| Schema validation tests | TBD | TBD | Pending |
| End-to-end workflow | TBD | TBD | Pending |
| Privacy / redaction checks | TBD | TBD | Pending |

Do not copy historical test counts into this table as current results.

## 4. Benchmark evidence

See [benchmark/README.md](benchmark/README.md).

- Task set: Pending
- Baseline outputs: Pending
- Continuity outputs: Pending
- Scoring rubric: Pending
- Results file: Pending
- Limitations: Pending

## 5. Demo evidence

- Demo recording: Pending
- Final public repository URL: https://github.com/shreyash21411/Kairo
- Public deployed demo URL: To be verified
- Demo duration: To be measured
- Evidence that the demonstrated feature was built during the event: Pending

The demo should show the actual end-to-end feature and should not imply that pre-existing VOIDZONE functionality was created during the hackathon.

## 6. Evidence storage

Place sanitized artifacts in this directory or a clearly linked location.

Suggested names:

- `baseline-repository-state.txt`
- `test-results-YYYY-MM-DD.txt`
- `continuity-workflow-01.png`
- `benchmark-results.json`
- `demo-script.md`

These are suggested names only; they are not evidence until the files exist.

## 7. Privacy checklist

Before committing an artifact, verify it does not contain:

- API keys, bearer tokens, cookies, or passwords.
- Database connection strings or secret environment values.
- Personal data copied from conversations without a need to disclose it.
- Private model-provider responses that should not be published.
- Sensitive deployment configuration.

Redact the artifact before committing it if necessary.
