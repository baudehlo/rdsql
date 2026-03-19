import { QueryResult, OutputFormat } from './types';

export function formatAsText(result: QueryResult): string {
  if (result.numberOfRecordsUpdated !== undefined) {
    return `Query OK, ${result.numberOfRecordsUpdated} row(s) affected`;
  }

  if (result.rows.length === 0) {
    return '(0 rows)';
  }

  const columns = result.columns;
  const rows = result.rows;

  const columnWidths = columns.map((col) => col.length);

  rows.forEach((row) => {
    columns.forEach((col, index) => {
      const value = String(row[col] ?? '');
      columnWidths[index] = Math.max(columnWidths[index], value.length);
    });
  });

  const separator = columnWidths.map((width) => '-'.repeat(width + 2)).join('+');
  const headerRow = columns
    .map((col, index) => ` ${col.padEnd(columnWidths[index])} `)
    .join('|');

  const dataRows = rows.map((row) =>
    columns
      .map((col, index) => {
        const value = row[col] === null ? 'NULL' : String(row[col] ?? '');
        return ` ${value.padEnd(columnWidths[index])} `;
      })
      .join('|')
  );

  const output = [
    separator,
    headerRow,
    separator,
    ...dataRows,
    separator,
    `(${rows.length} row${rows.length !== 1 ? 's' : ''})`,
  ];

  return output.join('\n');
}

export function formatAsCsv(result: QueryResult): string {
  if (result.numberOfRecordsUpdated !== undefined) {
    return `rows_affected\n${result.numberOfRecordsUpdated}`;
  }

  if (result.rows.length === 0) {
    return result.columns.join(',');
  }

  const escapeValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '';
    }
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = result.columns.map(escapeValue).join(',');
  const dataRows = result.rows.map((row) =>
    result.columns.map((col) => escapeValue(row[col])).join(',')
  );

  return [header, ...dataRows].join('\n');
}

export function formatAsHtml(result: QueryResult): string {
  if (result.numberOfRecordsUpdated !== undefined) {
    return `<div>Query OK, ${result.numberOfRecordsUpdated} row(s) affected</div>`;
  }

  if (result.rows.length === 0) {
    return `<table><tr>${result.columns.map(col => `<th>${col}</th>`).join('')}</tr></table>`;
  }

  const escapeHtml = (value: unknown): string => {
    if (value === null) return 'NULL';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const header = '<tr>' + result.columns.map((col) => `<th>${escapeHtml(col)}</th>`).join('') + '</tr>';
  const rows = result.rows
    .map(
      (row) =>
        '<tr>' +
        result.columns.map((col) => `<td>${escapeHtml(row[col])}</td>`).join('') +
        '</tr>'
    )
    .join('');

  return `<table>${header}${rows}</table>`;
}

export function formatAsJson(result: QueryResult): string {
  if (result.numberOfRecordsUpdated !== undefined) {
    return JSON.stringify({ numberOfRecordsUpdated: result.numberOfRecordsUpdated }, null, 2);
  }

  return JSON.stringify(result.rows, null, 2);
}

export function format(result: QueryResult, outputFormat: OutputFormat): string {
  switch (outputFormat) {
    case 'csv':
      return formatAsCsv(result);
    case 'html':
      return formatAsHtml(result);
    case 'json':
      return formatAsJson(result);
    case 'text':
    default:
      return formatAsText(result);
  }
}
