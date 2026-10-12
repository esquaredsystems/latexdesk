import * as vscode from 'vscode';
import { detectTools, ToolInfo } from '../build/toolDetect';
import { config } from './util';

/** Detects installed tools once (in the background) and caches the answer. */
export class ToolRegistry {
  private detection?: Promise<ToolInfo[]>;

  constructor(private readonly log: vscode.OutputChannel) {}

  list(force = false): Promise<ToolInfo[]> {
    if (!this.detection || force) {
      const t0 = Date.now();
      this.detection = detectTools(config().get<Record<string, string>>('tools.paths') ?? {}).then((tools) => {
        const found = tools.filter((t) => t.path).map((t) => t.name);
        this.log.appendLine(`[tools] detected in ${Date.now() - t0} ms: ${found.join(', ') || 'none'}`);
        return tools;
      });
    }
    return this.detection;
  }

  async has(name: string): Promise<boolean> {
    return !!(await this.list()).find((t) => t.name === name)?.path;
  }

  async path(name: string): Promise<string | undefined> {
    return (await this.list()).find((t) => t.name === name)?.path;
  }
}
