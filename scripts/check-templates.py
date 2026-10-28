#!/usr/bin/env python3
"""Checks templates/templates.json and the template ZIPs next to it.

    python3 scripts/check-templates.py            # validate the catalog and the ZIP files
    python3 scripts/check-templates.py --compile  # also build every ZIP with latexmk
    python3 scripts/check-templates.py --compile ieee-conference apa7   # only these

Exits with status 1 when something is wrong.
"""
import json, os, re, shutil, subprocess, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = os.path.join(HERE, '..', 'templates')
TYPES = {'journal', 'conference', 'thesis', 'book', 'report', 'article', 'presentation', 'poster', 'cv', 'letter', 'other'}
ENGINES = {'pdflatex': '-pdf', 'xelatex': '-xelatex', 'lualatex': '-lualatex'}
errors = []


def error(tid, message):
    errors.append(f'{tid}: {message}')


def zip_files(path):
    """Entry names as the extension writes them: no macOS metadata, single top folder removed."""
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if not n.endswith('/') and '__MACOSX/' not in n and not os.path.basename(n).startswith('._') and os.path.basename(n) != '.DS_Store']
    for n in names:
        if n.startswith('/') or re.match(r'^[A-Za-z]:', n) or '..' in n.split('/'):
            raise ValueError(f'unsafe path {n}')
    tops = {n.split('/')[0] for n in names}
    single = len(tops) == 1 and all('/' in n for n in names)
    return names, single


def compile_zip(t, path):
    work = tempfile.mkdtemp(prefix=f'tpl-{t["id"]}-')
    try:
        names, single = zip_files(path)
        with zipfile.ZipFile(path) as z:
            for n in names:
                target = os.path.join(work, n.split('/', 1)[1] if single else n)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, 'wb') as f:
                    f.write(z.read(n))
        main = t.get('main', 'main.tex')
        flag = ENGINES.get(t.get('engine', 'pdflatex'), '-pdf')
        r = subprocess.run(['latexmk', flag, '-interaction=nonstopmode', '-halt-on-error', main], cwd=work, capture_output=True, text=True, timeout=600)
        pdf = os.path.join(work, os.path.splitext(main)[0] + '.pdf')
        if r.returncode or not os.path.exists(pdf):
            error(t['id'], 'does not compile:\n' + '\n'.join(l for l in r.stdout.splitlines() if l.startswith('!'))[:800])
        else:
            print(f'compiled {t["id"]}')
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    with open(os.path.join(TEMPLATES, 'templates.json'), encoding='utf-8') as f:
        catalog = json.load(f)
    if catalog.get('version') != 1:
        errors.append('catalog: "version" must be 1')
    seen = set()
    listed = set()
    for i, t in enumerate(catalog.get('templates', [])):
        tid = t.get('id', f'#{i}')
        for field in ('id', 'name', 'type'):
            if not isinstance(t.get(field), str) or not t[field].strip():
                error(tid, f'missing "{field}"')
        if not re.match(r'^[a-z0-9][a-z0-9-]*$', tid):
            error(tid, 'id must use lowercase letters, digits and -')
        if tid in seen:
            error(tid, 'repeated id')
        seen.add(tid)
        if t.get('type') not in TYPES:
            error(tid, f'unknown type {t.get("type")!r}')
        if t.get('source') and not t['source'].startswith('https://'):
            error(tid, 'source must be an https address')
        if t.get('engine') and t['engine'] not in ENGINES:
            error(tid, f'unknown engine {t["engine"]!r}')
        if not t.get('filename'):
            if not t.get('source'):
                error(tid, 'a template without a ZIP needs a "source" page')
            continue
        if t['filename'].startswith('http'):
            continue
        path = os.path.join(TEMPLATES, t['filename'])
        listed.add(t['filename'])
        if not os.path.exists(path):
            error(tid, f'{t["filename"]} not found')
            continue
        try:
            names, single = zip_files(path)
        except (zipfile.BadZipFile, ValueError) as e:
            error(tid, f'bad ZIP: {e}')
            continue
        rel = [n.split('/', 1)[1] if single else n for n in names]
        main = t.get('main')
        if main and main not in rel:
            error(tid, f'main file {main} is not in the ZIP')
        if '--compile' in sys.argv and (not args or tid in args):
            compile_zip(t, path)
    for f in os.listdir(TEMPLATES):
        if f.endswith('.zip') and f not in listed:
            errors.append(f'{f}: not listed in templates.json')
    print(f'{len(seen)} templates, {len(listed)} ZIP files')
    for e in errors:
        print('ERROR', e)
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
