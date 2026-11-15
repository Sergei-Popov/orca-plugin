#!/usr/bin/env python3
"""Self-scan of a plugin's committed tree for what makes the orca.dev directory reject or hold a release.

    python3 scripts/lib/directory_scan.py <plugin-dir> [--ref HEAD]

Reads the tree of <ref> (default HEAD) exactly as a vX.Y.Z tag would ship it, so uncommitted files do
not count. Orca's validator does not cover these rules: the directory's private indexer applies them.
They were inferred on 2026-11-15 from the status.json history of stablyai/orca-community-plugins, the
rules page https://orca.dev/plugins/add and REVIEW_POLICY.md:

  rejected   binary files (anything with a NUL byte that is not a PNG/JPEG/GIF/WebP image or WOFF/WOFF2),
             archives, executables, TTF/OTF, symlinks, submodules
  'code'     base64 runs that decode to non-image binary (WASM, fonts, archives) — also in tests;
             long runs of \\xNN / \\uNNNN escapes; eval / new Function
  'content'  .wasm files
  'size'     a file over ~2 MiB or a plugin over ~5 MiB (screenshots count)
  'name'     a brand-led or bare-brand name
  'pricing'  prices, credits, trials

Exit status: 0 no errors (warnings allowed), 1 errors, 2 bad input.
"""
import argparse
import base64
import json
import re
import subprocess
import sys

FORBIDDEN_EXT = {
    '.wasm', '.ttf', '.otf', '.ttc', '.zip', '.gz', '.tgz', '.bz2', '.xz', '.zst', '.tar', '.7z', '.rar',
    '.jar', '.war', '.class', '.o', '.a', '.so', '.dylib', '.dll', '.exe', '.node', '.bin', '.har.zip',
}
IMAGE_MAGIC = [(b'\x89PNG\r\n\x1a\n', 'PNG'), (b'\xff\xd8\xff', 'JPEG'), (b'GIF87a', 'GIF'), (b'GIF89a', 'GIF')]
FONT_OK_MAGIC = [(b'wOFF', 'WOFF'), (b'wOF2', 'WOFF2')]
BLOB_MAGIC = [
    (b'\0asm', 'WASM'), (b'PK\x03\x04', 'ZIP'), (b'\x1f\x8b', 'GZIP'), (b'\xfd7zXZ', 'XZ'), (b'BZh', 'BZIP2'),
    (b'\x28\xb5\x2f\xfd', 'ZSTD'), (b'\x00\x01\x00\x00', 'TTF'), (b'OTTO', 'OTF'), (b'true', 'TTF'),
    (b'ttcf', 'TTC'), (b'wOFF', 'WOFF'), (b'wOF2', 'WOFF2'), (b'\x7fELF', 'ELF'), (b'MZ', 'PE'),
    (b'\xcf\xfa\xed\xfe', 'Mach-O'), (b'\xca\xfe\xba\xbe', 'Java class / Mach-O fat'), (b'%PDF', 'PDF'),
]
CODE_EXT = ('.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.tsx', '.jsx')
SCRIPT_EXT = ('.sh', '.py', '.mjs', '.js')
BRANDS = ['openapi', 'swagger', 'asyncapi', 'java', 'kotlin', 'oracle', 'photoshop', 'adobe', 'apple', 'google',
          'chrome', 'chromium', 'playwright', 'docker', 'github', 'microsoft', 'jetbrains', 'figma', 'notion',
          'slack', 'claude', 'anthropic', 'openai', 'codex', 'cursor', 'official', 'verified']
PRICING = re.compile(r'(\$\s?\d|\bprices?\b|\bpricing\b|\bcredits?\b|\bsubscriptions?\b|\bfree trial\b|\btrial\b'
                     r'|\blicen[cs]e key\b|\bpremium\b|\bpaywall\b|\bPro\b(?! ?(?:file|ject|cess|vide|perty|duce|mise|blem|to|xy|gram|of)))')
NETWORK = re.compile(r'\b(fetch\s*\(|XMLHttpRequest|WebSocket\s*\(|EventSource\s*\(|navigator\.sendBeacon)')
DYNAMIC_CODE = re.compile(r'(?<![\w$.])(eval\s*\(|new\s+Function\s*\(|Function\s*\(\s*["\'`])')
ESCAPE_RUN = re.compile(r'(?:\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}){16,}')
B64_RUN = re.compile(rb'(data:[\w/+.-]+;base64,)?([A-Za-z0-9+/]{1000,}={0,2})')
SUSPICIOUS_NAMES = re.compile(r'(hostile|attacker|exploit|malicious|payload|evil)', re.I)


def git(*args, text=True):
    return subprocess.run(['git', *args], capture_output=True, text=text, check=True).stdout


def magic_of(b, table):
    for sig, name in table:
        if b.startswith(sig):
            return name
    return None


def is_image_or_font(data):
    if magic_of(data, IMAGE_MAGIC) or magic_of(data, FONT_OK_MAGIC):
        return True
    return data[:4] == b'RIFF' and data[8:12] == b'WEBP'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir')
    ap.add_argument('--ref', default='HEAD')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    d, ref = a.dir, a.ref
    try:
        prefix = git('-C', d, 'rev-parse', '--show-prefix').strip()
        listing = git('-C', d, 'ls-tree', '-r', '-l', '--full-tree', ref)
    except subprocess.CalledProcessError as e:
        print(f'directory-scan: not a git repository with {ref}: {e.stderr.strip() if e.stderr else e}', file=sys.stderr)
        return 2

    errors, warnings = [], []
    total = 0
    manifest = None
    entries = []
    for line in listing.splitlines():
        meta, path = line.split('\t', 1)
        mode, kind, obj, size = meta.split()
        if prefix and not path.startswith(prefix):
            continue
        rel = path[len(prefix):]
        entries.append((mode, kind, obj, size, rel))

    if len(entries) > 2000:
        errors.append(f'{len(entries)} files: Orca allows at most 2,000')

    for mode, kind, obj, size, rel in entries:
        if mode == '120000':
            errors.append(f'{rel}: symlink (refused by Orca and the directory)')
            continue
        if kind == 'commit' or mode == '160000':
            errors.append(f'{rel}: submodule (refused)')
            continue
        n = int(size)
        total += n
        low = rel.lower()
        data = subprocess.run(['git', '-C', d, 'cat-file', 'blob', obj], capture_output=True, check=True).stdout
        if rel == 'orca-plugin.json':
            manifest = json.loads(data.decode('utf-8'))
        if any(low.endswith(ext) for ext in FORBIDDEN_EXT):
            errors.append(f'{rel}: forbidden file type (binary, archive, compiled code, TTF/OTF or WebAssembly)')
        if n > 2 * 1024 * 1024:
            errors.append(f'{rel}: {n / 1048576:.2f} MiB, over ~2 MiB a release is held for "size"')
        elif n > 1_500_000:
            warnings.append(f'{rel}: {n / 1e6:.2f} MB, keep files under 1.5 MB')
        if mode == '100755' and not low.endswith(SCRIPT_EXT):
            warnings.append(f'{rel}: executable bit on a non-script file (commit it as 100644)')
        if SUSPICIOUS_NAMES.search(rel):
            warnings.append(f'{rel}: the name may draw a reviewer\'s attention; prefer "malformed" or "damaged"')

        if b'\0' in data:
            if is_image_or_font(data):
                continue
            kind_name = magic_of(data, BLOB_MAGIC) or 'unknown binary'
            errors.append(f'{rel}: binary file ({kind_name}); only PNG/JPEG/GIF/WebP images and WOFF/WOFF2 are allowed')
            continue
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            errors.append(f'{rel}: not UTF-8 text and not an allowed image')
            continue
        ctrl = re.search(r'[\x01-\x08\x0b\x0e-\x1f\x7f]', text)
        if ctrl:
            errors.append(f'{rel}: raw control character U+{ord(ctrl.group()):04X} (makes the file count as binary)')

        for m in B64_RUN.finditer(data):
            blob = m.group(2)
            head = blob[:344]
            try:
                raw = base64.b64decode(head + b'=' * (-len(head) % 4))
            except Exception:
                raw = b''
            if is_image_or_font(raw) and not magic_of(raw, FONT_OK_MAGIC):
                continue
            what = magic_of(raw, BLOB_MAGIC) or ('WOFF/WOFF2 font' if magic_of(raw, FONT_OK_MAGIC) else 'opaque binary')
            line_no = data.count(b'\n', 0, m.start()) + 1
            errors.append(f'{rel}:{line_no}: base64 blob of {len(blob)} chars decoding to {what}; build such data in code '
                          '(the directory holds embedded binaries for "code" review, test files included)')

        if low.endswith(CODE_EXT) or low.endswith('.json') or low.endswith('.css'):
            for m in ESCAPE_RUN.finditer(text):
                line_no = text.count('\n', 0, m.start()) + 1
                errors.append(f'{rel}:{line_no}: run of {len(m.group()) // 4}+ \\x/\\u escapes reads as obfuscated code')
                break
        if low.endswith(CODE_EXT):
            for i, ln in enumerate(text.split('\n'), 1):
                if len(ln) > 1000:
                    warnings.append(f'{rel}:{i}: line of {len(ln)} characters (minified-looking code)')
                    break
            stripped = re.sub(r'//[^\n]*|/\*.*?\*/', '', text, flags=re.S)
            for m in DYNAMIC_CODE.finditer(stripped):
                errors.append(f'{rel}: {m.group(1).strip()} … (eval / new Function are forbidden in frames and draw review)')
                break
            is_test = re.search(r'(\.test\.|/test/|/tests/|^tools/)', rel) is not None
            if not is_test:
                for m in NETWORK.finditer(stripped):
                    warnings.append(f'{rel}: {m.group(1).strip()} — network use draws review; frames have no network')
                    break
        if low.endswith(('.md', '.json')) or low.endswith(CODE_EXT):
            for m in PRICING.finditer(text):
                ctx = text[max(0, m.start() - 30):m.end() + 30].replace('\n', ' ')
                warnings.append(f'{rel}: pricing-like wording "{m.group().strip()}" in “…{ctx}…”')
                break

    if total > 5 * 1024 * 1024:
        errors.append(f'plugin is {total / 1048576:.2f} MiB in total; over ~5 MiB a release is held for "size"')
    elif total > 2_500_000:
        warnings.append(f'plugin is {total / 1e6:.2f} MB in total; aim for under 2.5 MB')

    if manifest is None:
        errors.append('no orca-plugin.json at the plugin root')
    else:
        name = str(manifest.get('name', ''))
        pid = str(manifest.get('id', ''))
        if re.match(r'\s*orca\b', name, re.I) or pid.startswith('orca-'):
            errors.append(f'name "{name}" / id "{pid}": "Orca…" names and "orca-" ids are reserved')
        hits = [b for b in BRANDS if re.search(rf'\b{b}\b', name, re.I)]
        if hits:
            warnings.append(f'name "{name}" contains {", ".join(hits)}: brand-led names get a "name" hold; '
                            'use a generic name and an "Independent; not affiliated with …" line in the description')
        if 'publisher' in manifest:
            warnings.append('manifest has "publisher"; leave it out (the repository owner is the publisher)')
        if manifest.get('execution') not in ('sandboxed-ui', 'data', 'declarative'):
            warnings.append(f'execution "{manifest.get("execution")}": trusted-worker plugins get the closest review')
        if manifest.get('capabilities'):
            warnings.append(f'capabilities {manifest.get("capabilities")}: each one needs a reason; adding more later holds the update')
        desc = str(manifest.get('description', ''))
        dhits = [b for b in BRANDS[:-2] if re.search(rf'\b{b}\b', desc, re.I)]
        if dhits and not re.search(r'not affiliated|unofficial|independent', desc, re.I):
            warnings.append(f'description names {", ".join(dhits)} without "Independent; not affiliated with …"')

    report = {'dir': d, 'ref': ref, 'files': len(entries), 'bytes': total, 'errors': errors, 'warnings': warnings}
    if a.json:
        print(json.dumps(report, indent=2))
    else:
        print(f'directory-scan: {len(entries)} files, {total / 1e6:.2f} MB at {ref}')
        for e in errors:
            print(f'  ERROR  {e}')
        for w in warnings:
            print(f'  warn   {w}')
        print('directory-scan: ' + ('FAILED' if errors else 'ok' + (' (with warnings)' if warnings else '')))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
