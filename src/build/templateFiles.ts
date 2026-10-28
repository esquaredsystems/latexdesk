// Downloading and extracting template ZIPs (OL-55). Node only, no vscode, so it can be tested directly.
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { EXTRACT_LIMITS, findMainFile, planExtraction } from '../core/templates';

/** Downloads a URL with a size limit and a timeout. */
export async function download(url: string, limit: number, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error('timed out')), timeoutMs);
  signal?.addEventListener('abort', () => abort.abort(new Error('cancelled')));
  try {
    const response = await fetch(url, { signal: abort.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText || 'error'} for ${url}`);
    if (Number(response.headers.get('content-length') ?? 0) > limit) throw new Error(`the file is larger than ${limit / 1048576} MB`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > limit) throw new Error(`the file is larger than ${limit / 1048576} MB`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Writes the ZIP into `folder` following planExtraction, and returns the root document (relative path). */
export async function extractProject(data: Uint8Array, folder: string, preferredMain?: string): Promise<string | undefined> {
  const zip = await JSZip.loadAsync(data);
  const plan = planExtraction(Object.keys(zip.files));
  if (plan.error) throw new Error(plan.error);
  const root = path.resolve(folder);
  let written = 0;
  const texFiles: { path: string; text: string }[] = [];
  await fs.promises.mkdir(root, { recursive: true });
  for (const { entry, target } of plan.files) {
    const dest = path.resolve(root, target);
    if (!dest.startsWith(root + path.sep)) throw new Error(`The ZIP contains a path outside its folder: ${entry}`);
    const content = await zip.file(entry)!.async('nodebuffer');
    written += content.length;
    if (written > EXTRACT_LIMITS.bytes) throw new Error(`The ZIP expands to more than ${EXTRACT_LIMITS.bytes / 1048576} MB.`);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, content, { flag: 'wx' });
    if (target.endsWith('.tex')) texFiles.push({ path: target, text: content.toString('utf8') });
  }
  return findMainFile(texFiles, preferredMain);
}
