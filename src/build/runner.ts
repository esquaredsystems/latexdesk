// Runs a recipe: spawns each tool in turn (no shell), streams output, supports
// cancellation (the whole process tree is killed) and skips passes that are not needed.
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import treeKill from 'tree-kill';
import { Placeholders, Recipe, Tool, substitute } from './recipes';

export interface StepResult {
  tool: string;
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  skipped?: string;
}

export interface BuildResult {
  ok: boolean;
  cancelled: boolean;
  timedOut: boolean;
  /** Set when an executable could not be started at all. */
  missingExecutable?: string;
  steps: StepResult[];
  durationMs: number;
}

export interface RunOptions {
  recipe: Recipe;
  tools: Tool[];
  placeholders: Placeholders;
  /** Executable overrides from settings: { latexmk: "/path/to/latexmk" } */
  executablePaths?: Record<string, string>;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Events: 'step' (StepResult before running, exitCode null), 'output' (string), 'stepDone' (StepResult).
 */
export class BuildRun extends EventEmitter {
  private child?: ChildProcess;
  private cancelled = false;
  private timedOut = false;

  constructor(private readonly options: RunOptions) {
    super();
  }

  cancel() {
    this.cancelled = true;
    this.killChild();
  }

  get isCancelled() {
    return this.cancelled;
  }

  async run(): Promise<BuildResult> {
    const started = Date.now();
    const { recipe, tools, placeholders } = this.options;
    const steps: StepResult[] = [];
    let timer: NodeJS.Timeout | undefined;
    if (this.options.timeoutMs) {
      timer = setTimeout(() => {
        this.timedOut = true;
        this.killChild();
      }, this.options.timeoutMs);
    }

    try {
      let latexPasses = 0;
      let needsLatexAgain = true;
      for (const toolName of recipe.tools) {
        if (this.cancelled || this.timedOut) break;
        const tool = tools.find((t) => t.name === toolName);
        if (!tool) {
          steps.push({ tool: toolName, command: toolName, args: [], cwd: '', exitCode: null, durationMs: 0, skipped: 'unknown tool' });
          return this.finish(false, steps, started, toolName);
        }
        const skip = this.shouldSkip(tool, latexPasses, needsLatexAgain);
        const step: StepResult = {
          tool: tool.name,
          command: this.options.executablePaths?.[tool.command] || tool.command,
          args: tool.args.map((a) => substitute(a, placeholders)),
          cwd: substitute(tool.cwd ?? '%DIR%', placeholders),
          exitCode: null,
          durationMs: 0,
          skipped: skip,
        };
        steps.push(step);
        this.emit('step', step);
        if (skip) {
          this.emit('stepDone', step);
          continue;
        }

        const t0 = Date.now();
        const env = { ...process.env, ...this.options.env };
        for (const [k, v] of Object.entries(tool.env ?? {})) env[k] = substitute(v, placeholders);
        const outcome = await this.spawnStep(step, env);
        step.durationMs = Date.now() - t0;
        this.emit('stepDone', step);
        if (outcome === 'missing') return this.finish(false, steps, started, step.command);

        if (isLatexEngine(tool)) {
          latexPasses++;
          needsLatexAgain = this.logAsksForRerun();
        } else if (tool.name === 'bibtex' || tool.name === 'biber' || tool.name === 'makeindex') {
          needsLatexAgain = true;
        }
        // A failing pass does not stop the recipe: like the usual shell scripts, later passes
        // still run so bibliography and index tools get a chance and the best PDF is produced.
      }
      const last = steps.filter((s) => !s.skipped).pop();
      return this.finish(!!last && last.exitCode === 0 && !this.cancelled && !this.timedOut, steps, started);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private finish(ok: boolean, steps: StepResult[], started: number, missingExecutable?: string): BuildResult {
    return { ok, cancelled: this.cancelled, timedOut: this.timedOut, missingExecutable, steps, durationMs: Date.now() - started };
  }

  /** Smart passes: skip bibtex/makeindex when there is nothing to do and extra LaTeX passes when nothing changed. */
  private shouldSkip(tool: Tool, latexPasses: number, needsLatexAgain: boolean): string | undefined {
    const { OUTDIR, DOCFILE } = this.options.placeholders;
    const file = (ext: string) => path.join(OUTDIR, DOCFILE + ext);
    if (tool.name === 'bibtex') {
      const aux = readIfExists(file('.aux'));
      if (aux !== undefined && !/\\bibdata\{/.test(aux)) return 'no \\bibliography in the document';
    }
    if (tool.name === 'biber' && !fs.existsSync(file('.bcf'))) return 'no .bcf file (biblatex not used)';
    if (tool.name === 'makeindex') {
      const idx = readIfExists(file('.idx'));
      if (idx === undefined) return 'no .idx file';
    }
    if (isLatexEngine(tool) && !tool.name.startsWith('latexmk') && latexPasses > 0 && !needsLatexAgain) {
      return 'references are already stable';
    }
    return undefined;
  }

  private logAsksForRerun(): boolean {
    const { OUTDIR, DOCFILE } = this.options.placeholders;
    const log = readIfExists(path.join(OUTDIR, DOCFILE + '.log')) ?? '';
    return /Rerun to get|Label\(s\) may have changed|Rerun LaTeX|Please rerun LaTeX|undefined references/.test(log);
  }

  private spawnStep(step: StepResult, env: NodeJS.ProcessEnv): Promise<'done' | 'missing'> {
    return new Promise((resolve) => {
      this.emit('output', `\n> ${step.command} ${step.args.join(' ')}\n  (in ${step.cwd})\n`);
      let child: ChildProcess;
      try {
        child = spawn(step.command, step.args, { cwd: step.cwd, env, windowsHide: true });
      } catch (err) {
        this.emit('output', `Could not start ${step.command}: ${String(err)}\n`);
        resolve('missing');
        return;
      }
      this.child = child;
      child.stdout?.on('data', (d: Buffer) => this.emit('output', d.toString()));
      child.stderr?.on('data', (d: Buffer) => this.emit('output', d.toString()));
      child.on('error', (err: NodeJS.ErrnoException) => {
        this.emit('output', `Could not start ${step.command}: ${err.message}\n`);
        this.child = undefined;
        resolve(err.code === 'ENOENT' ? 'missing' : 'done');
      });
      child.on('close', (code) => {
        step.exitCode = code;
        this.child = undefined;
        resolve('done');
      });
    });
  }

  private killChild() {
    const pid = this.child?.pid;
    if (pid) {
      treeKill(pid, 'SIGTERM', (err) => {
        if (err) this.emit('output', `Could not stop process ${pid}: ${err.message}\n`);
      });
    }
  }
}

function isLatexEngine(tool: Tool): boolean {
  return /latex|tectonic/.test(tool.command) || tool.name.startsWith('latexmk');
}

function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Waits until the PDF has stopped changing and ends with a PDF trailer, so the viewer
 * never loads a half-written file. Returns false if it does not settle in time.
 */
export async function waitForStablePdf(file: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const st = fs.statSync(file);
      const sig = `${st.size}:${st.mtimeMs}`;
      if (sig === last && st.size > 0 && hasTrailer(file, st.size)) return true;
      last = sig;
    } catch {
      last = '';
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function hasTrailer(file: string, size: number): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const len = Math.min(2048, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString('latin1').includes('%%EOF');
  } finally {
    fs.closeSync(fd);
  }
}
