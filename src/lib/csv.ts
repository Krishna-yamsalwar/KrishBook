// Cells that start with = + @ (or a "-" that isn't a number) are prefixed so spreadsheets can't run them as formulas.
const cell = (v: string | number | null | undefined) => {
  let s = String(v ?? '');
  if (/^(?:[=+@\t\r]|-(?![\d.]))/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCSV = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map(cell).join(',')).join('\r\n');

export function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const blob = new Blob(['\uFEFF' + toCSV(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
