# Pharma Electronic Batch Record (eBR)

> **Fictional demo.** "Sahyadri Pharma Ltd., Pune", its products, users and data are invented. Not validated and not for real GMP use.

A small working eBR for a paracetamol 500 mg tablet batch: Dispensing → Granulation → Compression → Coating → Packing.

- **Master batch record** with instructions and parameter limits per step
- **Operator execution**: steps in sequence, enter values; **out-of-limit → deviation** raised automatically
- **E-signatures** on critical steps (re-enter password; meaning "Performed by" / independent "Verified by")
- **Audit trail** of every change (old/new value, user, time, reason); append-only and hash-chained
- **QA review by exception**: only deviations are shown; QA resolves them (signed), then releases or rejects the batch

Stack: Node.js + TypeScript + Express + SQLite (built-in `node:sqlite`) · React + Vite + TypeScript.

## Run it (needs Node.js 22.13+; tested on 24)

```bash
npm start
```

This installs, builds and starts the app. Open **http://localhost:3000**.

Optional, in a second terminal while the app is running: `npm run demo` loads a batch waiting for QA (with 2 deviations) and a half-executed batch.

**Demo logins** (password for all: `Pharma@123`): `operator1`, `operator2` (operators), `qa1` (QA), `admin`.

### Suggested 2-minute walkthrough
1. Log in as `operator1` → **+ New paracetamol batch** → start *Dispensing*, enter values (try API weight `76.4` to trigger a deviation) → **Complete step (sign)**.
2. Log out, log in as `operator2` → open the batch → **Verify** (second-person signature).
3. Log in as `qa1` → **QA Review** → resolve the deviation (signed) → **Release batch**.
4. Open **Audit Trail** to see every change and the integrity check.

## Tests and docs

- `npm test`: 10 automated acceptance tests (all passing), see [docs/ATP.md](docs/ATP.md)
- [docs/URS.md](docs/URS.md): 12 user requirements; [docs/ATP.md](docs/ATP.md) maps each to test cases
- `npm run typecheck`: type-check server and client

## Layout

```
server/src   app.ts (API + rules), db.ts (schema, seed master record), audit.ts, auth.ts
server/test  ebr.test.ts (TC-001…TC-010)
client/src   React pages: Batches, BatchExec, Review (QA), Audit, Master
docs         URS.md, ATP.md
```

Data lives in `server/data/ebr.db` (delete the file to reset). Set `PORT` to change the port.
