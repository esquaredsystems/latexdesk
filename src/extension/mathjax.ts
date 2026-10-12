// Renders TeX math to SVG with MathJax. Bundled separately (dist/mathjax.js) and loaded on demand.
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const cache = new Map<string, string>();

export interface Macro {
  name: string;
  args: number;
  body: string;
}

export function renderSvg(tex: string, display: boolean, macros: Macro[] = []): string {
  const key = `${display}|${tex}|${macros.map((m) => m.name + m.body).join(';')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const macroTable: Record<string, string | [string, number]> = {};
  for (const m of macros) macroTable[m.name] = m.args ? [m.body, m.args] : m.body;
  const doc = mathjax.document('', {
    InputJax: new TeX({ packages: AllPackages.filter((p) => p !== 'require' && p !== 'autoload'), macros: macroTable }),
    OutputJax: new SVG({ fontCache: 'local' }),
  });
  const node = doc.convert(tex, { display, em: 16, ex: 8, containerWidth: 80 * 16 });
  const svg = adaptor.innerHTML(node);
  if (/data-mjx-error|merror/.test(svg)) {
    const message = /title="([^"]+)"/.exec(svg)?.[1];
    throw new Error(message ?? 'MathJax could not parse this formula');
  }
  if (cache.size > 200) cache.clear();
  cache.set(key, svg);
  return svg;
}
