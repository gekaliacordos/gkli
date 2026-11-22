import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectSuitDelinquency } from '../lib/imports/suit-delinquency.js';

const header = 'Vencimento Compet. Atraso Código Principal Juros Multa Atualiz. Honorários Total';
const charge = '11/07/26 07/2026 15 000783 1.000,00 10,00 20,00 0,00 0,00 1.030,00';
const subtotal = '1.000,00 10,00 20,00 0,00 0,00 1.030,00';
const base = ['Inadimplentes', 'Valores atualizados até 26/07/2026', '000001 A - Pessoa fictícia'];

test('reconcilia subtotal separado do rótulo e preserva zeros e códigos de bloco', () => {
  const result = inspectSuitDelinquency([...base, header, '--- PAGE 2 ---', header, charge,
    subtotal, 'Total 000001 B - Pessoa fictícia', header, charge, 'Total ' + subtotal,
    '2 unidades inadimplentes (10,00%) 2.000,00 2.060,00'].join('\n'));
  assert.equal(result.reconciled, true);
  assert.equal(result.unitCount, 2);
  assert.equal(result.totalCents, 206000);
  assert.deepEqual(result.rows.map(({ unit, block, receipt }) => [unit, block, receipt]), [
    ['000001', 'A', '000783'], ['000001', 'B', '000783'],
  ]);
});

test('marca como não conciliado recibo repetido e subtotal divergente', () => {
  const result = inspectSuitDelinquency([...base, header, charge, charge, 'Total ' + subtotal,
    '1 unidade inadimplente (10,00%) 2.000,00 2.060,00'].join('\n'));
  assert.equal(result.reconciled, false);
  assert.deepEqual(result.issues.map(({ code }) => code), ['duplicate_receipt', 'unit_subtotal_unreconciled']);
});

test('rejeita layout desconhecido e identifica data inválida', () => {
  assert.throws(() => inspectSuitDelinquency('Parcelas do acordo'), /não reconhecido/);
  const result = inspectSuitDelinquency([...base, header, charge.replace('11/07/26', '32/07/26'),
    'Total ' + subtotal].join('\n'));
  assert.equal(result.reconciled, false);
  assert.ok(result.issues.some(({ code }) => code === 'invalid_charge_date'));
});
