const money = '(?:[0-9]{1,3}(?:\\.[0-9]{3})+|[0-9]+),[0-9]{2}';
const amounts = `(${money})(?:\\s+(${money})){5}`;
const rowPattern = new RegExp(`^(\\d{2}/\\d{2}/\\d{2})\\s+(\\d{2}/\\d{4})\\s+\\d+\\s+(\\S+)\\s+(.+)$`);
const summaryPattern = new RegExp(`^(\\d+)\\s+unidades? inadimplentes?\\s+\\([\\d.,]+%\\)\\s+${money}\\s+(${money})$`, 'i');
const valuesPattern = new RegExp(`^${amounts}$`);
const unitPattern = /^(?:Total\s+)?(\d+)\s+(\S+)\s+[-–—]\s/;
const headerPattern = /^Vencimento\s+Compet\.\s+Atraso\s+Código\s+Principal\s+Juros\s+Multa\s+Atualiz\.\s+Honorários\s+Total$/i;

function cents(value) {
  const result = Number(value.replace(/[.,]/g, ''));
  if (!Number.isSafeInteger(result)) throw new Error('Valor monetário fora do limite.');
  return result;
}

function dateISO(value, century) {
  const [day, month, year] = value.split('/').map(Number);
  const fullYear = year < 100 ? century + year : year;
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() + 1 !== month || date.getUTCFullYear() !== fullYear) {
    throw new Error('Data fora do calendário.');
  }
  return date.toISOString().slice(0, 10);
}

export function inspectSuitDelinquency(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, ' '));
  const cutOff = lines.find((line) => /^Valores atualizados até \d{2}\/\d{2}\/\d{4}$/i.test(line));
  if (!cutOff || !lines.includes('Inadimplentes') || !lines.some((line) => headerPattern.test(line))) {
    throw new Error('Formato de inadimplência Suit não reconhecido.');
  }

  const positionDate = dateISO(cutOff.split(' ').at(-1));
  const century = Math.floor(Number(positionDate.slice(0, 4)) / 100) * 100;
  const rows = [];
  const issues = [];
  const keys = new Set();
  let group;
  let unitCount = 0;
  let summary;

  function finishGroup(lineNumber, declared) {
    if (!group) return;
    if (!declared || declared.some((amount, index) => amount !== group.amounts[index])) {
      issues.push({ line: lineNumber, code: 'unit_subtotal_unreconciled' });
    }
    group = undefined;
  }

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const unit = unitPattern.exec(line);
    if (unit) {
      finishGroup(lineNumber);
      group = { unit: unit[1], block: unit[2], amounts: [0, 0, 0, 0, 0, 0], rows: 0 };
      unitCount++;
      continue;
    }

    const row = rowPattern.exec(line);
    if (row) {
      if (!group || !valuesPattern.test(row[4])) {
        issues.push({ line: lineNumber, code: 'invalid_charge_row' });
        continue;
      }
      const [, rawDate, competence, receipt, rawValues] = row;
      const values = rawValues.split(' ').map(cents);
      try {
        const dueDate = dateISO(rawDate, century);
        const [month, year] = competence.split('/');
        if (Number(month) < 1 || Number(month) > 12 || year.slice(0, 2) !== String(century / 100)) {
          throw new Error('Competência fora do calendário esperado.');
        }
        const key = JSON.stringify([group.unit, group.block, receipt]);
        if (keys.has(key)) issues.push({ line: lineNumber, code: 'duplicate_receipt' });
        keys.add(key);
        const [principal, interest, fine, adjustment, fees, total] = values;
        if (total !== principal + interest + fine + adjustment + fees) {
          issues.push({ line: lineNumber, code: 'charge_total_unreconciled' });
        }
        rows.push({ unit: group.unit, block: group.block, receipt,
          dueDate, competence: `${year}-${month}`, principal, interest, fine, adjustment, fees, total });
        group.amounts = group.amounts.map((amount, valueIndex) => amount + values[valueIndex]);
        group.rows++;
      } catch {
        issues.push({ line: lineNumber, code: 'invalid_charge_date' });
      }
      continue;
    }

    const closing = summaryPattern.exec(line);
    if (closing) {
      if (summary) issues.push({ line: lineNumber, code: 'duplicate_report_summary' });
      summary = { line: lineNumber, units: Number(closing[1]), total: cents(closing[2]) };
      continue;
    }

    const subtotal = line.replace(/^Total /i, '');
    if (group?.rows && valuesPattern.test(subtotal)) {
      finishGroup(lineNumber, subtotal.split(' ').map(cents));
    } else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}\/\d{4}\s/.test(line)) {
      issues.push({ line: lineNumber, code: 'invalid_charge_row' });
    }
  }

  finishGroup(lines.length);
  const totalCents = rows.reduce((amount, row) => amount + row.total, 0);
  if (!summary || summary.units !== unitCount || summary.total !== totalCents) {
    issues.push({ line: summary?.line ?? lines.length, code: 'report_summary_unreconciled' });
  }
  if (!rows.length) issues.push({ line: 0, code: 'no_charges_recognized' });
  return {
    positionDate, unitCount, rows, issues,
    totalCents,
    reconciled: rows.length > 0 && issues.length === 0,
  };
}
