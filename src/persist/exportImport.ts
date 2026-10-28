import { migrate, type WorldSnapshot } from '../sim/serialize';

/** Download a world as a JSON file the observer can keep or move elsewhere. */
export function downloadSnapshot(snapshot: WorldSnapshot, filename: string): void {
  const blob = new Blob([JSON.stringify({ format: 'tiny-eden-world', snapshot })], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a world file chosen by the observer. */
export async function readSnapshotFile(file: File): Promise<WorldSnapshot> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  const wrapped = data as { format?: string; snapshot?: WorldSnapshot };
  const snap = wrapped && wrapped.format === 'tiny-eden-world' ? wrapped.snapshot : (data as WorldSnapshot);
  return migrate(snap as WorldSnapshot);
}
