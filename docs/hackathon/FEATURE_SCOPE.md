# VOIDZONE Continuity — Feature Scope

## 1. Problem

When a user changes AI assistants or reaches a usage limit, important project context can be left behind. Re-explaining architecture, decisions, constraints, prior work, and pending tasks is time-consuming and can introduce inconsistencies.

VOIDZONE Continuity aims to produce a portable, inspectable summary that helps another assistant continue the user's work.

## 2. Target user and primary scenario

A developer is working on a project in one assistant, then chooses to continue in another assistant.

The user provides a conversation export, copied conversation text, or another explicitly supported context source. VOIDZONE processes only the context supplied through the supported workflow.

## 3. MVP workflow

1. **Import:** User pastes or uploads context using a supported input method.
2. **Inspect input:** Show the source or material being processed and allow the user to remove unnecessary or sensitive content.
3. **Extract state:** Produce structured project state.
4. **Validate:** Validate required fields and data types; surface uncertainty, conflicting statements, and missing information.
5. **Review:** Let the user correct, remove, or approve extracted items.
6. **Generate:** Create a portable JSON artifact and a human-readable continuation prompt.
7. **Transfer:** Let the user copy or download the approved artifact and paste the prompt into the receiving assistant.
8. **Evaluate:** Compare the quality of continuation with a fresh session that receives only a short project description.

The exact UI, file formats, and model integration must be confirmed against the implemented MVP before being called complete.

## 4. Proposed project-state schema

The schema below is a design target, not an existing API contract.

- `schema_version`
- `project`: name and concise purpose
- `source`: user-provided source type and optional label
- `facts`: known facts with evidence references where available
- `decisions`: selected approaches and rationale
- `requirements`: expected behavior
- `constraints`: technical, operational, and user constraints
- `completed_work`: work supported by the provided context
- `open_tasks`: pending work and dependencies
- `uncertainties`: unknown or weakly supported claims
- `contradictions`: conflicting statements requiring review
- `next_actions`: suggested next steps
- `generated_at`: generation timestamp, when available

Do not fabricate provenance, timestamps, evidence references, or certainty scores. Mark unavailable fields explicitly.

## 5. Acceptance criteria

### A. Context ingestion

- [ ] A user can provide context through the implemented input method.
- [ ] Unsupported formats fail with a useful message.
- [ ] Empty input is handled safely.
- [ ] The app does not claim automatic access to another assistant's private session.

### B. Structured extraction

- [ ] Output conforms to a documented schema.
- [ ] Required fields and data types are validated.
- [ ] Facts and decisions are distinguishable from recommendations.
- [ ] Uncertainty and contradictions can be represented.
- [ ] Invalid model output is handled without crashing the workflow.

### C. Human control

- [ ] Users can inspect the generated state.
- [ ] Users can edit or remove content before export.
- [ ] Sensitive content can be removed from the outgoing package.
- [ ] The user explicitly initiates export or transfer.

### D. Continuation output

- [ ] A portable structured artifact can be produced.
- [ ] A human-readable continuation prompt can be produced.
- [ ] The receiving assistant is told not to assume unsupported facts.
- [ ] The output identifies the user's goal and unresolved work.

### E. Evaluation

- [ ] A baseline task set is documented.
- [ ] The same tasks are tested with and without the continuity package.
- [ ] Results include failures and limitations.
- [ ] Reported metrics are reproducible from saved evidence.

Acceptance checkboxes must remain unchecked until the relevant behavior is tested.

## 6. Out of scope for the initial MVP

Unless actually implemented and validated, do not claim:

- Automatic access to Claude, ChatGPT, or other private conversation histories.
- Transfer of hidden reasoning or internal model state.
- A guarantee that the receiving assistant follows every instruction.
- Universal compatibility with every AI platform or export format.
- Fully autonomous changes to external systems.
- Guaranteed factual correctness of extracted context.
- Automatic execution of suggested next steps without a separate, explicit authorization mechanism.

## 7. Security and privacy

- Process only context the user is authorized to provide.
- Minimize the data sent to any external model provider.
- Never place credentials or API keys in exported context.
- Provide a review step before context leaves the application.
- Document what is stored, where it is stored, and how users can delete it.
- Avoid retaining raw conversation content unless required and clearly disclosed.
- Treat imported content as untrusted data, not as instructions that override application security.
- Review relevant provider terms and data-handling policies before launch.

## 8. Meta AI integration

A Meta model integration is a possible implementation path, subject to verified API access, available credits, and the current provider contract.

Before claiming integration, record the model identifier, request/response behavior, schema validation, error handling, and actual successful test evidence. Do not expose API keys in logs or screenshots.

## 9. Definition of MVP complete

The MVP is complete only when the implemented end-to-end workflow satisfies the applicable acceptance criteria, automated tests pass, the benchmark is executed, and a reproducible demo demonstrates the actual behavior.
