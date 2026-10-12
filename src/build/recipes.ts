// Tools and recipes. A recipe is an ordered list of tool names; a tool is an executable
// with an argument list that may contain placeholders such as %DOC%.

export interface Tool {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Working directory; defaults to %DIR% (the root document's folder). */
  cwd?: string;
}

export interface Recipe {
  name: string;
  tools: string[];
}

const latexArgs = ['-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-output-directory=%OUTDIR%', '%DOC%'];

export const BUILTIN_TOOLS: Tool[] = [
  { name: 'latexmk', command: 'latexmk', args: ['-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-pdf', '-outdir=%OUTDIR%', '%DOC%'] },
  { name: 'latexmk-xelatex', command: 'latexmk', args: ['-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-xelatex', '-outdir=%OUTDIR%', '%DOC%'] },
  { name: 'latexmk-lualatex', command: 'latexmk', args: ['-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-lualatex', '-outdir=%OUTDIR%', '%DOC%'] },
  { name: 'pdflatex', command: 'pdflatex', args: latexArgs },
  { name: 'xelatex', command: 'xelatex', args: latexArgs },
  { name: 'lualatex', command: 'lualatex', args: latexArgs },
  // bibtex and makeindex run inside the output directory; BIBINPUTS lets bibtex find .bib files next to the sources.
  { name: 'bibtex', command: 'bibtex', args: ['%DOCFILE%'], cwd: '%OUTDIR%', env: { BIBINPUTS: '%DIR%%PATHSEP%' } },
  { name: 'biber', command: 'biber', args: ['--input-directory=%DIR%', '%DOCFILE%'], cwd: '%OUTDIR%' },
  { name: 'makeindex', command: 'makeindex', args: ['%DOCFILE%.idx'], cwd: '%OUTDIR%' },
  { name: 'tectonic', command: 'tectonic', args: ['-X', 'compile', '--synctex', '--keep-logs', '--keep-intermediates', '--outdir=%OUTDIR%', '%DOC_EXT%'] },
];

/**
 * latexmk tool for fast preview and partial builds. `preTex` runs before the root file is read
 * (latexmk's -usepretex), so the user's sources are never changed.
 */
export function previewTool(engineFlag: '-pdf' | '-xelatex' | '-lualatex', preTex: string): Tool {
  return {
    name: 'latexmk-preview',
    command: 'latexmk',
    args: ['-synctex=1', '-interaction=nonstopmode', '-file-line-error', engineFlag, `-usepretex=${preTex}`, '-outdir=%OUTDIR%', '%DOC%'],
  };
}

export const BUILTIN_RECIPES: Recipe[] = [
  { name: 'latexmk (pdf)', tools: ['latexmk'] },
  { name: 'latexmk (xelatex)', tools: ['latexmk-xelatex'] },
  { name: 'latexmk (lualatex)', tools: ['latexmk-lualatex'] },
  { name: 'pdflatex ➞ bibtex ➞ makeindex ➞ pdflatex × 2', tools: ['pdflatex', 'bibtex', 'makeindex', 'pdflatex', 'pdflatex'] },
  { name: 'pdflatex ➞ biber ➞ pdflatex × 2', tools: ['pdflatex', 'biber', 'pdflatex', 'pdflatex'] },
  { name: 'xelatex ➞ bibtex ➞ xelatex × 2', tools: ['xelatex', 'bibtex', 'xelatex', 'xelatex'] },
  { name: 'pdflatex', tools: ['pdflatex'] },
  { name: 'xelatex', tools: ['xelatex'] },
  { name: 'lualatex', tools: ['lualatex'] },
  { name: 'tectonic', tools: ['tectonic'] },
];

export interface Placeholders {
  /** Root file without extension, relative to %DIR% (e.g. "main"). */
  DOC: string;
  DOCFILE: string;
  DOC_EXT: string;
  DIR: string;
  OUTDIR: string;
  PATHSEP: string;
}

export function substitute(value: string, p: Placeholders): string {
  return value.replace(/%(DOC_EXT|DOCFILE|DOC|DIR|OUTDIR|PATHSEP)%/g, (_, k: keyof Placeholders) => p[k]);
}

/**
 * Chooses the recipe for a build. Precedence: explicit choice, `% !LS recipe = ...`,
 * `% !TEX program = ...`, the configured default, then a fallback when latexmk is missing.
 */
export function chooseRecipe(
  recipes: Recipe[],
  options: { explicit?: string; magic: Record<string, string>; configured: string; latexmkAvailable: boolean },
): { recipe?: Recipe; reason: string; problem?: string } {
  const byName = (n: string) => recipes.find((r) => r.name.toLowerCase() === n.toLowerCase());
  if (options.explicit) {
    const r = byName(options.explicit);
    return r ? { recipe: r, reason: 'selected' } : { reason: 'selected', problem: `Recipe "${options.explicit}" does not exist` };
  }
  if (options.magic.recipe) {
    const r = byName(options.magic.recipe);
    if (r) return { recipe: r, reason: 'magic comment' };
    return { recipe: byName(options.configured), reason: 'default', problem: `Magic comment names unknown recipe "${options.magic.recipe}"` };
  }
  const program = options.magic.program?.toLowerCase();
  if (program) {
    const engine = ['pdflatex', 'xelatex', 'lualatex', 'tectonic'].find((e) => program === e);
    if (!engine) return { recipe: byName(options.configured), reason: 'default', problem: `Unknown program "${options.magic.program}" in magic comment` };
    if (engine === 'tectonic') return { recipe: byName('tectonic'), reason: 'magic comment' };
    if (options.latexmkAvailable && engine !== 'pdflatex') return { recipe: byName(`latexmk (${engine})`), reason: 'magic comment' };
    if (options.latexmkAvailable) return { recipe: byName('latexmk (pdf)'), reason: 'magic comment' };
    return { recipe: byName(engine), reason: 'magic comment' };
  }
  const configured = byName(options.configured);
  if (configured && (options.latexmkAvailable || !configured.tools.some((t) => t.startsWith('latexmk')))) {
    return { recipe: configured, reason: 'default' };
  }
  return { recipe: byName('pdflatex ➞ bibtex ➞ makeindex ➞ pdflatex × 2'), reason: 'latexmk not found' };
}
