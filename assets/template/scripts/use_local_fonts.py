#!/usr/bin/env python3
"""Install independently obtained, unmodified Fontshare WOFF2 files locally."""
import argparse
from pathlib import Path
import re
import shutil

FONT_NAMES = {
    'clash-display-500.woff2': 'ClashDisplay-Medium.woff2',
    'clash-display-600.woff2': 'ClashDisplay-Semibold.woff2',
    'clash-display-700.woff2': 'ClashDisplay-Bold.woff2',
    'general-sans-400.woff2': 'GeneralSans-Regular.woff2',
    'general-sans-500.woff2': 'GeneralSans-Medium.woff2',
    'general-sans-600.woff2': 'GeneralSans-Semibold.woff2',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--from-dir', required=True, type=Path, help='Directory containing your licensed font downloads')
    args = parser.parse_args()
    source = args.from_dir.expanduser().resolve()
    if not source.is_dir():
        parser.error('Font source must be a directory.')
    root = Path(__file__).resolve().parent.parent
    styles = root / 'src/styles.css'
    html = root / 'index.html'
    css = styles.read_text(encoding='utf-8')
    document = html.read_text(encoding='utf-8')
    sources = {}
    replacements = {}
    for canonical, official in FONT_NAMES.items():
        matches = [p for p in source.rglob('*.woff2') if p.name.lower() in {canonical.lower(), official.lower()}]
        if len(matches) != 1:
            parser.error(f'Expected exactly one {official} or {canonical}; found {len(matches)}.')
        data = matches[0].read_bytes()
        if data[:4] != b'wOF2':
            parser.error(f'Not a WOFF2 file: {matches[0].name}')
        sources[canonical] = matches[0]
    blocks = re.findall(r'@font-face\s*\{[^}]+\}', css)
    for canonical in FONT_NAMES:
        family = 'Clash Display' if canonical.startswith('clash') else 'General Sans'
        weight = canonical.split('-')[-1].split('.')[0]
        matching = [b for b in blocks if f"font-family: '{family}'" in b and f'font-weight: {weight};' in b]
        if len(matching) != 1:
            parser.error(f'Cannot identify font rule for {canonical}; no files changed.')
        url = re.search(r"url\('([^']+)'\)", matching[0])
        if not url:
            parser.error(f'Cannot identify font URL for {canonical}.')
        replacements[url.group(1)] = '/fonts/' + canonical
    destination = root / 'public/fonts'
    destination.mkdir(exist_ok=True)
    for canonical, source_file in sources.items():
        target = destination / canonical
        if source_file.resolve() != target.resolve():
            shutil.copyfile(source_file, target)
    for previous, local in replacements.items():
        css = css.replace(previous, local)
        document = document.replace(previous, local)
    styles.write_text(css, encoding='utf-8')
    html.write_text(document, encoding='utf-8')
    print('Installed six unmodified fonts for this application. Rebuild to precache them for offline use.')
    print('Do not include these restricted font binaries in a public source repository or Skill archive.')


if __name__ == '__main__':
    main()
