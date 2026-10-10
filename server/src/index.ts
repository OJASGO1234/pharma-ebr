import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { openDb } from './db';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const db = openDb(process.env.DB_PATH ?? path.join(root, 'server', 'data', 'ebr.db'));
const app = createApp(db, path.join(root, 'client', 'dist'));
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`\n  Pharma eBR (fictional demo) running at  http://localhost:${port}\n`);
  console.log('  Demo logins (password for all: Pharma@123): operator1, operator2, qa1, admin\n');
});
