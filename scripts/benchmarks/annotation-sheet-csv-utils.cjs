const VALID_RISK_LEVELS = new Set(['', 'low', 'medium', 'high']);
const VALID_INTERVENTION_STATES = new Set([
  '',
  'stabilize',
  'clarify',
  'co_plan',
  'guided_execute',
  'autonomous_execute',
]);
const VALID_ESCALATE_VALUES = new Set(['', '0', '1']);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatHistoryForSheet(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }
  return history
    .map((entry) => {
      const role = normalizeText(entry?.role) === 'assistant' ? '助手' : '用户';
      return `${role}: ${normalizeText(entry?.text)}`;
    })
    .join('\n');
}

function formatConstraintsForSheet(constraints) {
  if (!Array.isArray(constraints) || constraints.length === 0) {
    return '';
  }
  return constraints.map((entry) => `- ${normalizeText(entry)}`).join('\n');
}

function csvEscape(value) {
  const normalized = value == null ? '' : String(value);
  if (!/[",\n\r]/.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

function stringifyCsv(rows, headers, { bom = false } = {}) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? '')).join(','));
  }
  const output = `${lines.join('\n')}\n`;
  return bom ? `\uFEFF${output}` : output;
}

function parseCsv(text) {
  const rows = [];
  const normalized = String(text).replace(/^\uFEFF/, '');
  let row = [];
  let cell = '';
  let index = 0;
  let inQuotes = false;

  while (index < normalized.length) {
    const char = normalized[index];

    if (inQuotes) {
      if (char === '"') {
        const next = normalized[index + 1];
        if (next === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      index += 1;
      continue;
    }
    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += 1;
      continue;
    }
    if (char === '\r') {
      index += 1;
      continue;
    }

    cell += char;
    index += 1;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const [headerRow, ...dataRows] = rows;
  return dataRows
    .filter((dataRow) => dataRow.some((entry) => normalizeText(entry)))
    .map((dataRow) =>
      Object.fromEntries(headerRow.map((header, idx) => [header, dataRow[idx] ?? '']))
    );
}

function validateSheetLabels(row, { allowPartial = true } = {}) {
  const riskLevel = normalizeText(row.risk_level);
  const interventionState = normalizeText(row.intervention_state);
  const escalate = normalizeText(row.escalate);

  if (!VALID_RISK_LEVELS.has(riskLevel)) {
    throw new Error(`Invalid risk_level in sheet for case_id=${row.case_id}`);
  }
  if (!VALID_INTERVENTION_STATES.has(interventionState)) {
    throw new Error(`Invalid intervention_state in sheet for case_id=${row.case_id}`);
  }
  if (!VALID_ESCALATE_VALUES.has(escalate)) {
    throw new Error(`Invalid escalate in sheet for case_id=${row.case_id}`);
  }

  const filledCount = [riskLevel, interventionState, escalate].filter(Boolean).length;
  if (!allowPartial && filledCount !== 3) {
    throw new Error(`Incomplete labels in sheet for case_id=${row.case_id}`);
  }
  if (allowPartial && filledCount !== 0 && filledCount !== 3) {
    throw new Error(
      `Partial label triplet in sheet for case_id=${row.case_id}; fill all three label fields or leave all blank`
    );
  }

  return {
    risk_level: riskLevel || null,
    intervention_state: interventionState || null,
    escalate: escalate === '' ? null : Number.parseInt(escalate, 10),
  };
}

module.exports = {
  normalizeText,
  formatHistoryForSheet,
  formatConstraintsForSheet,
  stringifyCsv,
  parseCsv,
  validateSheetLabels,
};
