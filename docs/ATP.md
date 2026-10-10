# Acceptance Test Plan (ATP)

**System:** Pharma eBR (fictional demo) · **Spec:** [URS.md](URS.md)
**Automation:** all 10 test cases are automated in [`server/test/ebr.test.ts`](../server/test/ebr.test.ts) and run with `npm test`. Each test starts the real Express app on a temporary in-memory SQLite database and calls the HTTP API like the UI does.

## Test cases

| ID | URS | Test case | Expected result | Actual / Result |
|----|-----|-----------|-----------------|-----------------|
| TC-001 | 001, 002 | Log in with a wrong password; call the API without a token; log in correctly | Wrong password → 401 and a `LOGIN_FAILED` audit row; no token → 401; valid login returns the user and role | As expected · **Pass** |
| TC-002 | 003, 004 | Read the master batch record | 5 stages in order (Dispensing → Packing), each with instructions and ≥3 parameters that all have limits; critical steps are Dispensing, Compression, Packing | As expected · **Pass** |
| TC-003 | 002, 005, 006 | Operator creates a batch; QA tries to create one; operator tries to start step 2 first | Batch is CREATED with 5 steps and a `CREATE` audit row; QA → 403; starting step 2 early → 409 | As expected · **Pass** |
| TC-004 | 007, 008 | Enter an in-limit API weight (75.1 kg) and a non-numeric value | In-limit value accepted, no deviation; "abc" → 400 | As expected · **Pass** |
| TC-005 | 008, 011 | Enter an out-of-limit API weight (76.4 kg, limit 74.25–75.75) | A deviation (status OPEN) is created automatically; audit has `DEVIATION_RAISED` with value 76.4 and reason "Out of limit" | As expected · **Pass** |
| TC-006 | 007, 011 | Change an already-entered value, first without and then with a reason | Without reason → 400; with reason → saved; audit row holds old value 15, new value 15.1, user, ISO timestamp and the reason | As expected · **Pass** |
| TC-007 | 010, 011 | Complete a critical step with a wrong password, with no password, then correctly; performer tries to verify own step; a different operator verifies | Wrong/no password → 403 and a `SIGNATURE_FAILED` audit row; correct → AWAITING_VERIFICATION; self-verify → 403; second user → COMPLETED with signatures "Performed by" then "Verified by" (by the second user) | As expected · **Pass** |
| TC-008 | 009, 012 | Run a full batch with one out-of-limit Hardness (11.2 kp); open QA review as QA and as operator; try to release | Review shows exactly 1 deviation (Hardness) and counts for in-limit parameters; operator → 403; release → 409 "open deviation" | As expected · **Pass** |
| TC-009 | 002, 009, 010, 012 | Operator tries to resolve; QA resolves with too-short text, a wrong password, then correctly; operator tries to release; QA releases | Operator → 403; short text → 400; wrong password → 403; correct → RESOLVED with QA name; operator release → 403; QA release → RELEASED, one "Approved for release" signature in the audit trail | As expected · **Pass** |
| TC-010 | 011 | Try to UPDATE/DELETE audit rows directly in the database; verify the hash chain; read the audit trail of a batch; forge a row after removing protection | UPDATE/DELETE blocked ("append-only"); chain valid; batch status changes appear in order CREATED→IN_PROGRESS→READY_FOR_QA→RELEASED, every row with user and time; after forging a row the integrity check reports invalid | As expected · **Pass** |

## Execution record

| Date | Command | Environment | Result |
|------|---------|-------------|--------|
| 2026-10-10 | `npm test` | Node v24.13.0, Windows 11, SQLite (node:sqlite, in-memory) | 10 / 10 passed, 0 failed |

## Traceability (URS → test case)

| URS | Test cases | URS | Test cases |
|-----|------------|-----|------------|
| URS-001 | TC-001 | URS-007 | TC-004, TC-006 |
| URS-002 | TC-001, TC-003, TC-009 | URS-008 | TC-004, TC-005 |
| URS-003 | TC-002 | URS-009 | TC-008, TC-009 |
| URS-004 | TC-002 | URS-010 | TC-007, TC-009 |
| URS-005 | TC-003 | URS-011 | TC-005, TC-006, TC-007, TC-010 |
| URS-006 | TC-003 | URS-012 | TC-008, TC-009 |
