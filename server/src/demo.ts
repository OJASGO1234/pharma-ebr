// Loads demo data into a RUNNING server (npm run serve): one batch waiting in QA review with 2 deviations,
// and one batch half-way through execution. Usage: npm run demo
import { Client, PASSWORD, executeStep, runBatchToQa } from '../test/helpers';

const base = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

const qaBatch = await runBatchToQa(base, { 'Hardness': 10.6, 'Loss on drying (LOD)': 2.9 });
console.log(`Batch ${qaBatch.batch_no}: READY_FOR_QA with ${qaBatch.deviations.length} deviations`);

const op1 = await Client.login(base, 'operator1');
const op2 = await Client.login(base, 'operator2');
let b = (await op1.post('/api/batches', {})).body;
b = await executeStep(op1, b, 0);
await op2.post(`/api/batch-steps/${b.steps[0].id}/verify`, { password: PASSWORD });
console.log(`Batch ${b.batch_no}: dispensing done, waiting for the operator to continue with granulation`);
