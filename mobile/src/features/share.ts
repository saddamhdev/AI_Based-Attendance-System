import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { deleteTempFile, privateDir } from '../auth/privateFiles';

/**
 * Saves report content to the app-private cache and opens the platform share sheet, from which
 * the user can save to Files/Drive or send it. The file is deleted on logout.
 */
export async function shareTextFile(filename: string, content: string, mimeType: string, uti?: string) {
  const file = new File(privateDir('reports'), filename);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  await share(file.uri, mimeType, uti);
}

export async function sharePdf(filename: string, html: string) {
  const result = await Print.printToFileAsync({ html });
  const target = new File(privateDir('reports'), filename);
  if (target.exists) target.delete();
  new File(result.uri).moveSync(target);
  await share(target.uri, 'application/pdf', 'com.adobe.pdf');
}

async function share(uri: string, mimeType: string, uti?: string) {
  if (!(await Sharing.isAvailableAsync())) {
    deleteTempFile(uri);
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, { mimeType, UTI: uti, dialogTitle: 'Save or share report' });
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

/** Simple printable table; totals come straight from the backend summary. */
export function reportHtml(title: string, meta: [string, unknown][], columns: string[], rows: Record<string, unknown>[]) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,Roboto,sans-serif;color:#17233e;font-size:11px}h1{font-size:18px;color:#443ac5}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #e4e8f1;padding:4px;text-align:left}th{background:#eeecff}
dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px}</style></head><body>
<h1>${escapeHtml(title)}</h1><dl>${meta.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
<table><thead><tr>${columns.map(c => `<th>${escapeHtml(c.replace(/_/g, ' '))}</th>`).join('')}</tr></thead>
<tbody>${rows.map(row => `<tr>${columns.map(c => `<td>${escapeHtml(row[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>
</body></html>`;
}
