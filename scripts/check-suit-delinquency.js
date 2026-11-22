import { readFile } from 'node:fs/promises';
import { inspectSuitDelinquency } from '../lib/imports/suit-delinquency.js';

const input = process.argv[2];
if (!input) {
  console.error('Uso: node scripts/check-suit-delinquency.js <texto-extraido-do-pdf>');
  process.exitCode = 1;
} else {
  try {
    const preview = inspectSuitDelinquency(await readFile(input, 'utf8'));
    console.log(JSON.stringify({
      units: preview.unitCount, charges: preview.rows.length,
      reconciled: preview.reconciled, issues: preview.issues,
    }, null, 2));
    if (!preview.reconciled) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
