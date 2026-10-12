// Compares the in-process SyncTeX reader with the real `synctex` tool on a freshly built PDF.
// Skipped when pdflatex or synctex is not installed.
import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import * as os from 'os';
import * as path from 'path';
import { SyncTexData } from '../src/core/synctex';

function has(cmd: string) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const available = has('pdflatex') && has('synctex');

describe.skipIf(!available)('SyncTeX reader vs synctex CLI', () => {
  let dir: string;
  let data: SyncTexData;
  const lines = Array.from({ length: 120 }, (_, i) => `Paragraph line ${i} with some words to fill the measure nicely and wrap.${i % 7 === 0 ? '\n' : ''}`);

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ls-synctex-'));
    writeFileSync(path.join(dir, 'main.tex'), `\\documentclass{article}\n\\begin{document}\n\\section{One}\n${lines.slice(0, 60).join('\n')}\n\\input{part}\n\\[ x^2 + y^2 = z^2 \\]\n\\end{document}\n`);
    writeFileSync(path.join(dir, 'part.tex'), lines.slice(60).join('\n') + '\n');
    execFileSync('pdflatex', ['-synctex=1', '-interaction=nonstopmode', 'main.tex'], { cwd: dir, stdio: 'ignore' });
    data = SyncTexData.parse(gunzipSync(readFileSync(path.join(dir, 'main.synctex.gz'))).toString('utf8'));
  });

  function cliView(file: string, line: number) {
    const out = execFileSync('synctex', ['view', '-i', `${line}:0:${file}`, '-o', 'main.pdf'], { cwd: dir }).toString();
    // The tool may return several boxes; v is the bottom of each box.
    const pages = [...out.matchAll(/^Page:(.*)$/gm)].map((m) => +m[1]);
    const vs = [...out.matchAll(/^v:(.*)$/gm)].map((m) => parseFloat(m[1]));
    return { page: pages[0], vs };
  }

  function cliEdit(page: number, x: number, y: number) {
    const out = execFileSync('synctex', ['edit', '-o', `${page}:${x}:${y}:main.pdf`], { cwd: dir }).toString();
    return { line: parseInt(/^Line:(.*)$/m.exec(out)![1], 10), input: /^Input:(.*)$/m.exec(out)![1] };
  }

  it('forward search agrees with synctex view', () => {
    const cases: [string, number][] = [['main.tex', 4], ['main.tex', 30], ['main.tex', 60], ['part.tex', 5], ['part.tex', 40]];
    for (const [name, line] of cases) {
      const file = path.join(dir, name);
      const ours = data.forward(file, line)!;
      const cli = cliView(file, line);
      expect(ours.page).toBe(cli.page);
      // Within one line's depth of one of the boxes the tool reports.
      expect(cli.vs.some((v) => Math.abs(ours.y - v) < 3)).toBe(true);
    }
  });

  it('reverse search agrees with synctex edit', () => {
    for (const [page, x, y] of [[1, 200, 150], [1, 300, 400], [2, 150, 300], [2, 250, 500]] as const) {
      const ours = data.reverse(page, x, y)!;
      const cli = cliEdit(page, x, y);
      expect(path.basename(ours.file)).toBe(path.basename(cli.input));
      expect(Math.abs(ours.line - cli.line)).toBeLessThanOrEqual(2);
    }
  });
});
