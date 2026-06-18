import JSZip from 'jszip';
import type { Session } from '../types';

/** Escape a single CSV field per RFC 4180. */
function escapeField(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Convert sessions to a single CSV string with BOM (for Excel Korean). */
export function sessionsToCsv(sessions: Session[]): string {
  if (sessions.length === 0) return '﻿';
  // Collect all column names (use the first session's columns, since each session has its own schema)
  // For mixed sessions, we union all column names.
  const colMap = new Map<string, string>(); // id → name
  for (const s of sessions) {
    for (const c of s.columns) colMap.set(c.id, c.name);
  }
  const colIds = Array.from(colMap.keys());
  const header = ['session_id', 'date', '#', ...colIds.map((id) => colMap.get(id)!)].map(escapeField).join(',');
  const lines: string[] = [header];
  for (const s of sessions) {
    for (const r of s.rows) {
      const cells = [s.id, s.date, String(r.index), ...colIds.map((id) => r.values[id] ?? '')];
      lines.push(cells.map((c) => escapeField(String(c))).join(','));
    }
  }
  return '﻿' + lines.join('\r\n');
}

/** Sanitize a string for use as a filename: illegal path chars → '_'. */
function sanitizeFilename(s: string): string {
  return s.replace(/[\/\\:*?"<>|]/g, '_');
}

/** v0.12 — multi-session export: ONE CSV per session, bundled into a single ZIP.
 *  Each session keeps its own schema via sessionsToCsv([session]) (BOM preserved — JSZip
 *  encodes the leading ﻿ as the UTF-8 BOM). Per-session filename: sanitized
 *  (label || id) + ISO export date; collisions deduped with a -1/-2/… counter. */
export async function sessionsToCsvZip(sessions: Session[]): Promise<Blob> {
  const zip = new JSZip();
  const today = new Date().toISOString().slice(0, 10);
  const used = new Set<string>();
  for (const s of sessions) {
    const base = sanitizeFilename(`${s.label || s.id}_${today}`);
    let name = base;
    let n = 1;
    while (used.has(name)) name = `${base}-${n++}`;
    used.add(name);
    zip.file(`${name}.csv`, sessionsToCsv([s]));
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** v0.13.0 R6 — CSV 텍스트를 Blob으로(완료 팝업이 보관해 공유/재다운로드에 재사용). */
export function csvToBlob(csv: string): Blob {
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

/** v0.13.0 R6 — mime 무관 범용 Blob 다운로더(csv/zip 공용 — 완료 팝업 '다시 다운로드'). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Trigger a browser download of the given CSV text. */
export function downloadCsv(filename: string, csv: string) {
  downloadBlob(csvToBlob(csv), filename);
}
