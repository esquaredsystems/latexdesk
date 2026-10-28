// Packages loaded more than once in a project (TS-41), and the edit that removes a repeated load.
import { maskNonCode, readArgs, readGroup, splitList } from './text';

export interface PackageLoad {
  file: string;
  name: string;
  /** Offset of the package name inside the file. */
  offset: number;
  line: number;
  options: string;
}

export interface DuplicatePackage extends PackageLoad {
  first: PackageLoad;
  /** True when this load asks for an option the first load did not give: LaTeX stops with "Option clash". */
  optionClash: boolean;
}

const optionList = (options: string) =>
  options
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

/** Every load after the first one of the same package. `loads` must be in project order. */
export function findDuplicatePackages(loads: PackageLoad[]): DuplicatePackage[] {
  const first = new Map<string, PackageLoad>();
  const duplicates: DuplicatePackage[] = [];
  for (const load of loads) {
    const earlier = first.get(load.name);
    if (!earlier) {
      first.set(load.name, load);
      continue;
    }
    const given = optionList(earlier.options);
    duplicates.push({ ...load, first: earlier, optionClash: optionList(load.options).some((o) => !given.includes(o)) });
  }
  return duplicates;
}

/**
 * The edit that removes the package whose name starts at `offset`: the whole command (and its
 * line, when nothing else is on it) when the command loads only that package, otherwise just
 * the name and one comma.
 */
export function removePackageEdit(text: string, offset: number): { start: number; end: number; text: string } | undefined {
  const masked = maskNonCode(text);
  const start = Math.max(masked.lastIndexOf('\\usepackage', offset), masked.lastIndexOf('\\RequirePackage', offset));
  if (start < 0) return undefined;
  const after = start + (masked.startsWith('\\usepackage', start) ? '\\usepackage' : '\\RequirePackage').length;
  const { args, end } = readArgs(masked, after, 1);
  const group = args[0];
  if (!group || offset < group.start || offset >= group.end) return undefined;
  const items = splitList(group);
  const index = items.findIndex((i) => i.offset === offset);
  if (index < 0) return undefined;

  if (items.length > 1) {
    // Remove "name," or, for the last item, ",name" (with the spaces around it).
    const item = items[index];
    if (index < items.length - 1) return { start: item.offset, end: items[index + 1].offset, text: '' };
    const comma = masked.lastIndexOf(',', item.offset);
    return { start: comma, end: item.offset + item.value.length, text: '' };
  }

  // A trailing release date, as in \usepackage{name}[2020/01/01], belongs to the command.
  const date = readGroup(masked, end, '[', ']');
  let from = start;
  let to = date ? date.end : end;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', to);
  const lineEnd = newline < 0 ? text.length : newline;
  if (!text.slice(lineStart, start).trim() && !masked.slice(to, lineEnd).trim()) {
    from = lineStart;
    to = newline < 0 ? text.length : newline + 1;
  }
  return { start: from, end: to, text: '' };
}
