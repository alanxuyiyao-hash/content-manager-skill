#!/usr/bin/env python3
"""Copy the bundled application into a new, independent directory."""
import argparse
from pathlib import Path
import shutil
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='New application directory; must not exist')
    args = parser.parse_args()
    source = Path(__file__).resolve().parent.parent / 'assets' / 'template'
    output = args.output.expanduser().absolute()
    if output.exists() or output.is_symlink():
        parser.error('Output already exists; choose a new directory.')
    if source == output.resolve() or source in output.resolve().parents:
        parser.error('Output must be outside the bundled template.')
    if any(p.is_symlink() for p in source.rglob('*')):
        parser.error('The bundled template contains a symlink; refusing to follow it.')
    if not (source / 'package-lock.json').is_file():
        parser.error('Bundled template is incomplete.')
    if not output.parent.is_dir():
        parser.error('Output parent directory must already exist.')
    try:
        shutil.copytree(source, output)
    except OSError as exc:
        print(f'Copy failed: {exc}', file=sys.stderr)
        return 1
    print(f'Created: {output}')
    print('Next: cd into that directory, then run npm ci and npm run dev -- --host 127.0.0.1')
    return 0


if __name__ == '__main__':
    sys.exit(main())
