// Local project history: snapshots of the project's source files in `.latexstudio/history/`.
// File contents are stored once per distinct content (named by SHA-256, gzipped), so a
// snapshot that changes one chapter only adds that chapter.
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';

export interface Snapshot {
  id: string;
  time: number;
  reason: string;
  /** Set for labelled versions ("Submitted to journal, v1"); these are never pruned. */
  label?: string;
  /** Path relative to the project folder -> content hash. */
  files: Record<string, string>;
}

export interface HistoryLimits {
  /** Unlabelled snapshots kept; older ones are removed first. */
  maxSnapshots: number;
}

export class HistoryStore {
  readonly dir: string;
  private readonly indexFile: string;

  constructor(readonly projectDir: string) {
    this.dir = path.join(projectDir, '.latexstudio', 'history');
    this.indexFile = path.join(this.dir, 'index.json');
  }

  list(): Snapshot[] {
    try {
      const data = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      return Array.isArray(data.snapshots) ? data.snapshots : [];
    } catch {
      // Missing or damaged index: start a fresh history rather than failing the editor.
      return [];
    }
  }

  /**
   * Records the current content of `files`. Returns undefined when nothing changed since the
   * last snapshot (unless a label is given), so frequent triggers do not pile up copies.
   */
  take(files: string[], reason: string, label?: string, limits: HistoryLimits = { maxSnapshots: 200 }): Snapshot | undefined {
    const record: Record<string, string> = {};
    for (const file of files) {
      let content: Buffer;
      try {
        content = fs.readFileSync(file);
      } catch {
        continue;
      }
      const hash = createHash('sha256').update(content).digest('hex');
      const object = this.objectPath(hash);
      if (!fs.existsSync(object)) {
        fs.mkdirSync(path.dirname(object), { recursive: true });
        fs.writeFileSync(object, gzipSync(content));
      }
      record[path.relative(this.projectDir, file).split(path.sep).join('/')] = hash;
    }
    const snapshots = this.list();
    const last = snapshots[snapshots.length - 1];
    if (!label && last && sameFiles(last.files, record)) return undefined;

    const snapshot: Snapshot = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, time: Date.now(), reason, label, files: record };
    snapshots.push(snapshot);
    this.save(prune(snapshots, limits));
    return snapshot;
  }

  setLabel(id: string, label: string | undefined) {
    const snapshots = this.list();
    const s = snapshots.find((x) => x.id === id);
    if (!s) return;
    s.label = label || undefined;
    this.save(snapshots);
  }

  /** Content of one file in a snapshot, or undefined if the snapshot does not contain it. */
  read(snapshot: Snapshot, relPath: string): Buffer | undefined {
    const hash = snapshot.files[relPath];
    if (!hash) return undefined;
    try {
      return gunzipSync(fs.readFileSync(this.objectPath(hash)));
    } catch {
      return undefined;
    }
  }

  /** Files whose content differs between a snapshot and the working copy. */
  changedFiles(snapshot: Snapshot): string[] {
    return Object.keys(snapshot.files).filter((rel) => {
      try {
        const current = createHash('sha256').update(fs.readFileSync(path.join(this.projectDir, rel))).digest('hex');
        return current !== snapshot.files[rel];
      } catch {
        return true;
      }
    });
  }

  /** Writes snapshot files back into the project. Only the given files (all by default). */
  restore(snapshot: Snapshot, only?: string[]): string[] {
    const restored: string[] = [];
    for (const rel of only ?? Object.keys(snapshot.files)) {
      const content = this.read(snapshot, rel);
      if (!content) continue;
      const target = path.join(this.projectDir, rel);
      // Never write outside the project folder, whatever the index says.
      if (path.relative(this.projectDir, target).startsWith('..')) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      restored.push(rel);
    }
    return restored;
  }

  /** Copies a snapshot into a folder, e.g. to run latexdiff against it. */
  materialize(snapshot: Snapshot, targetDir: string) {
    for (const rel of Object.keys(snapshot.files)) {
      const content = this.read(snapshot, rel);
      if (!content) continue;
      const target = path.join(targetDir, rel);
      if (path.relative(targetDir, target).startsWith('..')) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }

  /** Total size of stored objects in bytes. */
  size(): number {
    let total = 0;
    const walk = (dir: string) => {
      for (const entry of safeReaddir(dir)) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else total += fs.statSync(full).size;
      }
    };
    walk(path.join(this.dir, 'objects'));
    return total;
  }

  private objectPath(hash: string) {
    return path.join(this.dir, 'objects', hash.slice(0, 2), hash.slice(2) + '.gz');
  }

  private save(snapshots: Snapshot[]) {
    fs.mkdirSync(this.dir, { recursive: true });
    // Write to a temporary file first so a crash never leaves a half-written index.
    const tmp = this.indexFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, snapshots }, null, 1));
    fs.renameSync(tmp, this.indexFile);
    this.removeUnusedObjects(snapshots);
  }

  private removeUnusedObjects(snapshots: Snapshot[]) {
    const used = new Set(snapshots.flatMap((s) => Object.values(s.files)));
    const objects = path.join(this.dir, 'objects');
    for (const bucket of safeReaddir(objects)) {
      for (const file of safeReaddir(path.join(objects, bucket.name))) {
        const hash = bucket.name + file.name.replace(/\.gz$/, '');
        if (!used.has(hash)) fs.unlinkSync(path.join(objects, bucket.name, file.name));
      }
    }
  }
}

function sameFiles(a: Record<string, string>, b: Record<string, string>) {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

function prune(snapshots: Snapshot[], limits: HistoryLimits): Snapshot[] {
  const unlabelled = snapshots.filter((s) => !s.label);
  const excess = unlabelled.length - limits.maxSnapshots;
  if (excess <= 0) return snapshots;
  const drop = new Set(unlabelled.slice(0, excess).map((s) => s.id));
  return snapshots.filter((s) => !drop.has(s.id));
}

function safeReaddir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
