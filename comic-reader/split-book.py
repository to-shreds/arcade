#!/usr/bin/env python3
"""Split a large CBZ/PDF into ordinary sequential byte chunks for Misc/cbz.

Example: python split-book.py "Very Large Comic.cbz" --output ~/Downloads/parts
Upload all produced .001, .002, etc. files into Misc/cbz. No compression,
repackaging, or modifications to the source are performed.
"""
import argparse
from pathlib import Path

CHUNK_BYTES = 24 * 1024 * 1024


def main():
    parser = argparse.ArgumentParser(description="Prepare large CBZ or PDF for GitHub browser uploads")
    parser.add_argument("book", type=Path, help="Original CBZ or PDF file")
    parser.add_argument("--output", type=Path, default=Path.cwd(), help="Output directory for parts")
    args = parser.parse_args()
    source = args.book.resolve()
    if not source.is_file() or source.suffix.lower() not in (".cbz", ".pdf"):
        parser.error("Choose an existing .cbz or .pdf file.")
    if source.stat().st_size <= CHUNK_BYTES:
        parser.error("This book fits within GitHub's 25 MiB browser upload limit and needs no splitting.")
    folder = args.output.resolve()
    folder.mkdir(parents=True, exist_ok=True)
    count = (source.stat().st_size + CHUNK_BYTES - 1) // CHUNK_BYTES
    names = [folder / f"{source.name}.{index:03d}" for index in range(1, count + 1)]
    if any(path.exists() for path in names):
        parser.error("A numbered part already exists in the output folder; choose a different folder.")
    created = []
    try:
        with source.open("rb") as original:
            for path in names:
                with path.open("xb") as part:
                    remaining = CHUNK_BYTES
                    while remaining:
                        block = original.read(min(1024 * 1024, remaining))
                        if not block:
                            break
                        part.write(block)
                        remaining -= len(block)
                created.append(path)
                print(f"Created {path.name}: {path.stat().st_size:,} bytes")
    except BaseException:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    print(f"Ready to upload {len(names)} numbered parts into to-shreds/Misc/cbz.")


if __name__ == "__main__":
    main()