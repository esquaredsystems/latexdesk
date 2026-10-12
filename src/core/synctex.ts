// In-process SyncTeX reader. Parses the (decompressed) .synctex file once after each build,
// then answers forward (source -> PDF) and reverse (PDF -> source) queries without
// spawning the `synctex` tool. Coordinates are PDF points (bp) from the top-left of a page.

export interface SyncBox {
  page: number;
  input: number;
  line: number;
  /** left, baseline, width, height, depth in bp */
  h: number;
  v: number;
  width: number;
  height: number;
  depth: number;
}

interface SyncNode {
  input: number;
  line: number;
  h: number;
  v: number;
  /** Index of the enclosing hbox in `boxes`, or -1. */
  box: number;
}

export interface ForwardResult {
  page: number;
  /** x of the first matching node, y of the box baseline (top-left origin, bp). */
  x: number;
  y: number;
  /** The highlighted region. */
  box: { left: number; top: number; width: number; height: number };
}

export interface ReverseResult {
  file: string;
  line: number;
  /** Rough column hint (0-based) is not available in SyncTeX; always undefined. */
  column?: number;
}

export class SyncTexData {
  readonly inputs = new Map<number, string>();
  readonly boxes: SyncBox[] = [];
  readonly nodes: SyncNode[] = [];
  private byInput = new Map<number, number[]>();

  static parse(text: string): SyncTexData {
    const data = new SyncTexData();
    data.load(text);
    return data;
  }

  private load(text: string) {
    let unit = 1;
    let mag = 1000;
    let xOffset = 0;
    let yOffset = 0;
    let page = 0;
    const openBoxes: number[] = []; // stack of hbox indices (-1 for vboxes)
    let inContent = false;
    const toBp = (n: number) => (n * unit * (mag / 1000)) / 65781.76;

    let start = 0;
    while (start < text.length) {
      let end = text.indexOf('\n', start);
      if (end < 0) end = text.length;
      const line = text.slice(start, end);
      start = end + 1;
      if (!line) continue;

      if (!inContent) {
        if (line.startsWith('Input:')) {
          const m = /^Input:(\d+):(.*)$/.exec(line);
          if (m) this.inputs.set(+m[1], normalizePath(m[2]));
        } else if (line.startsWith('Unit:')) unit = +line.slice(5);
        else if (line.startsWith('Magnification:')) mag = +line.slice(14) || 1000;
        else if (line.startsWith('X Offset:')) xOffset = +line.slice(9);
        else if (line.startsWith('Y Offset:')) yOffset = +line.slice(9);
        else if (line.startsWith('Content:')) inContent = true;
        continue;
      }

      const c = line[0];
      if (c === '{') {
        page = parseInt(line.slice(1), 10);
        openBoxes.length = 0;
        continue;
      }
      if (c === '}' || c === '!') continue;
      if (c === ']' || c === ')') {
        openBoxes.pop();
        continue;
      }
      if (c === 'I') {
        // Inputs can also be declared inside the content section.
        const m = /^Input:(\d+):(.*)$/.exec(line);
        if (m) this.inputs.set(+m[1], normalizePath(m[2]));
        continue;
      }
      if (line.startsWith('Postamble')) break;

      // Records: kind tag,line[,column]:h,v[:W,H,D]
      const m = /^([[(vhxkg$])(\d+),(\d+)(?:,-?\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/.exec(line);
      if (!m) continue;
      const input = +m[2];
      const lineNo = +m[3];
      const h = toBp(+m[4] + xOffset);
      const v = toBp(+m[5] + yOffset);

      if (c === '[') {
        openBoxes.push(-1);
        continue;
      }
      if (c === '(' || c === 'h') {
        const box: SyncBox = {
          page,
          input,
          line: lineNo,
          h,
          v,
          width: toBp(+(m[6] ?? 0)),
          height: toBp(+(m[7] ?? 0)),
          depth: toBp(+(m[8] ?? 0)),
        };
        this.boxes.push(box);
        const index = this.boxes.length - 1;
        if (c === '(') openBoxes.push(index);
        this.addNode({ input, line: lineNo, h, v, box: index });
        continue;
      }
      if (c === 'v') continue;
      // x, k, g, $ : points inside the current hbox
      const parent = openBoxes.length ? openBoxes[openBoxes.length - 1] : -1;
      this.addNode({ input, line: lineNo, h, v, box: parent });
    }
  }

  /** Makes relative input paths absolute (some engines write paths relative to the build directory). */
  resolveInputs(resolve: (p: string) => string) {
    for (const [id, p] of this.inputs) this.inputs.set(id, normalizePath(resolve(p)));
  }

  private addNode(node: SyncNode) {
    this.nodes.push(node);
    const list = this.byInput.get(node.input);
    if (list) list.push(this.nodes.length - 1);
    else this.byInput.set(node.input, [this.nodes.length - 1]);
  }

  /** Finds the input number for a source file (exact path match after normalization). */
  inputFor(file: string): number | undefined {
    const target = normalizePath(file);
    for (const [id, p] of this.inputs) if (samePath(p, target)) return id;
    // Fall back to a unique match on the file name.
    const name = target.split('/').pop();
    const byName = [...this.inputs].filter(([, p]) => p.split('/').pop() === name);
    return byName.length === 1 ? byName[0][0] : undefined;
  }

  forward(file: string, line: number): ForwardResult | undefined {
    const input = this.inputFor(file);
    if (input === undefined) return undefined;
    const indices = this.byInput.get(input) ?? [];
    // Exact line first; otherwise the closest following line, then the closest preceding one.
    let best: number[] = [];
    let bestDistance = Infinity;
    for (const i of indices) {
      const n = this.nodes[i];
      const d = n.line >= line ? n.line - line : (line - n.line) * 2 + 0.5;
      if (d < bestDistance) {
        bestDistance = d;
        best = [i];
      } else if (d === bestDistance) best.push(i);
    }
    if (!best.length) return undefined;

    const first = this.nodes[best[0]];
    const page = first.box >= 0 ? this.boxes[first.box].page : this.pageOfNode(best[0]);
    const onPage = best.filter((i) => {
      const n = this.nodes[i];
      return n.box < 0 || this.boxes[n.box].page === page;
    });
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    let x = Infinity;
    for (const i of onPage) {
      const n = this.nodes[i];
      x = Math.min(x, n.h);
      const b = n.box >= 0 ? this.boxes[n.box] : undefined;
      if (b) {
        left = Math.min(left, b.h);
        right = Math.max(right, b.h + b.width);
        top = Math.min(top, b.v - b.height);
        bottom = Math.max(bottom, b.v + b.depth);
      }
    }
    const y = first.box >= 0 ? this.boxes[first.box].v : first.v;
    if (left === Infinity) {
      left = x;
      right = x + 1;
      top = y - 10;
      bottom = y;
    }
    return { page, x, y, box: { left, top, width: right - left, height: Math.max(bottom - top, 1) } };
  }

  reverse(page: number, x: number, y: number): ReverseResult | undefined {
    // Smallest hbox on the page that contains the point.
    let best: number | undefined;
    let bestArea = Infinity;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.page !== page) continue;
      if (x >= b.h && x <= b.h + b.width && y >= b.v - b.height && y <= b.v + b.depth) {
        const area = b.width * (b.height + b.depth);
        if (area < bestArea) {
          bestArea = area;
          best = i;
        }
      }
    }
    let node: SyncNode | undefined;
    if (best !== undefined) {
      // Inside the box, take the content node closest to the click horizontally.
      // Nodes carrying the box's own tag are line-break artefacts and are only used as a fallback.
      const box = this.boxes[best];
      let bestDx = Infinity;
      for (const n of this.nodes) {
        if (n.box !== best || (n.input === box.input && n.line === box.line)) continue;
        const dx = Math.abs(n.h - x);
        if (dx < bestDx) {
          bestDx = dx;
          node = n;
        }
      }
      node ??= { ...this.boxes[best], box: best };
    } else {
      // Nothing contains the point: nearest box baseline on the page.
      let bestD = Infinity;
      for (const b of this.boxes) {
        if (b.page !== page) continue;
        const dy = y < b.v - b.height ? b.v - b.height - y : y > b.v + b.depth ? y - b.v - b.depth : 0;
        const dx = x < b.h ? b.h - x : x > b.h + b.width ? x - b.h - b.width : 0;
        const d = dx + dy * 4;
        if (d < bestD) {
          bestD = d;
          node = { input: b.input, line: b.line, h: b.h, v: b.v, box: -1 };
        }
      }
    }
    if (!node) return undefined;
    const file = this.inputs.get(node.input);
    return file ? { file, line: node.line } : undefined;
  }

  private pageOfNode(index: number): number {
    for (let i = index; i >= 0; i--) {
      const n = this.nodes[i];
      if (n.box >= 0) return this.boxes[n.box].page;
    }
    return 1;
  }
}

/** Removes "/./" segments and converts backslashes so paths from the file and the editor compare equal. */
export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, '/');
  s = s.replace(/\/\.\//g, '/').replace(/\/{2,}/g, '/');
  // Resolve "dir/../" segments.
  let prev;
  do {
    prev = s;
    s = s.replace(/\/[^/]+\/\.\.\//, '/');
  } while (s !== prev);
  return s;
}

function samePath(a: string, b: string): boolean {
  // Windows and macOS file systems are usually case-insensitive.
  return a === b || a.toLowerCase() === b.toLowerCase();
}
