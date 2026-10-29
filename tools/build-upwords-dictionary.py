#!/usr/bin/env python3
"""Rebuild Upwords' bundled word list from the pinned ESDB source checkout.

Usage:
  git clone https://github.com/en-wl/wordlist.git /tmp/arcade-esdb
  git -C /tmp/arcade-esdb checkout 1e5b7d3a72f47a71da5d28686c1dd4b397178485
  python3 tools/build-upwords-dictionary.py --source /tmp/arcade-esdb

The generated module is self-contained. No dictionary download or server call
occurs during play. Use --check to verify the checked-in generated artifacts.
"""

import argparse
import hashlib
import json
import re
import sqlite3
import subprocess
import sys
from pathlib import Path


SOURCE_COMMIT = "1e5b7d3a72f47a71da5d28686c1dd4b397178485"
SOURCE_URL = "https://github.com/en-wl/wordlist"
SHORT_WORDS = "AA AB AD AE AG AH AI AL AM AN AR AS AT AW AX AY BA BE BI BO BY DA DE DO ED EF EH EL EM EN ER ES ET EW EX FA FE GI GO HA HE HI HM HO ID IF IN IS IT JO KA KI LA LI LO MA ME MI MM MO MU MY NA NE NO NU OD OE OF OH OI OK OM ON OP OR OS OW OX OY PA PE PI PO QI RE SH SI SO TA TE TI TO UH UM UN UP US UT WE WO XI XU YA YE YO ZA".split()
SHORT_SOURCE = "https://scrabble.merriam.com/2-letter-words"
QUERY = [
    "word-list", "80", "A", "1",
    "--wo-poses=abbr,s,pre,suf,wp,we,x",
    "--wo-pos-classes=abbr,abbr?",
    "--categories=",
    "--wo-tags=[moby],[lcacr],[ucacr],[upper]",
    "--dot=False",
    "--apostrophe=False",
    "--deaccent",
]
PLURAL_QUERY = """
SELECT DISTINCT s.word, lemma.word
FROM scowl_ AS s JOIN words AS lemma ON lemma.word_id = s.lemma_id
WHERE s.size <= 80 AND s.variant_level <= 1
  AND s.spelling IN ('_', 'A') AND s.region IN ('', 'US')
  AND s.base_pos IN ('n', 'n_v') AND s.pos IN ('ns', 'ms')
  AND s.category = '' AND s.pos_class NOT IN ('abbr', 'abbr?')
  AND s.tag NOT IN ('[moby]', '[lcacr]', '[ucacr]', '[upper]')
"""


def run(command, cwd):
    return subprocess.run(command, cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE).stdout


def build(source):
    actual_commit = run(["git", "rev-parse", "HEAD"], source).strip()
    if actual_commit != SOURCE_COMMIT:
        raise SystemExit(f"Expected ESDB {SOURCE_COMMIT}, found {actual_commit}")
    # A source edit would invalidate the source revision recorded in every match.
    if run(["git", "status", "--porcelain", "--untracked-files=no"], source).strip():
        raise SystemExit("The ESDB source checkout has tracked modifications")
    subprocess.run(["make", "scowl.db"], cwd=source, check=True)
    raw_words = run(["python3", "-m", "libscowl", *QUERY], source).splitlines()
    # Check source capitalization BEFORE uppercase conversion. Otherwise names,
    # countries, weekdays and acronyms would become playable common words.
    words = sorted({word.upper() for word in raw_words
                    if re.fullmatch(r"[a-z]{2,11}", word)
                    and len(word.replace("qu", "#")) <= 10})
    if not words or len(words) < 50000:
        raise SystemExit(f"Unexpected dictionary size: {len(words)}")
    # Reviewed standalone short-word senses omitted or misclassified by ESDB.
    words = sorted(set(words) | set(SHORT_WORDS))
    word_bytes = ("\n".join(words) + "\n").encode("ascii")
    digest = hashlib.sha256(word_bytes).hexdigest()
    # A lone S is forbidden only when it forms a plural. Use source lemma links
    # rather than guessing from spelling: HI -> HIS must remain legal.
    sys.path.insert(0, str(source))
    from libscowl import deaccent
    with sqlite3.connect(source / "scowl.db") as database:
        pairs = [(deaccent(plural), deaccent(lemma))
                 for plural, lemma in database.execute(PLURAL_QUERY)]
    word_set = set(words)
    plurals = sorted({plural.upper() for plural, lemma in pairs
                      if re.fullmatch(r"[a-z]{2,11}", plural)
                      and plural == lemma + "s"
                      and plural.upper() in word_set and lemma.upper() in word_set})
    plural_digest = hashlib.sha256(("\n".join(plurals) + "\n").encode("ascii")).hexdigest()
    dictionary_id = f"esdb80-us-{SOURCE_COMMIT[:7]}-{digest[:12]}-s{plural_digest[:8]}"
    license_text = (source / "Copyright").read_text().split("\n===\n", 1)[0].rstrip() + "\n"
    counts = {str(n): sum(len(word) == n for word in words) for n in range(2, 12)}
    info = {
        "id": dictionary_id,
        "name": "Arcade English",
        "source": "English Speller Database (ESDB, formerly SCOWL)",
        "sourceUrl": SOURCE_URL,
        "sourceCommit": SOURCE_COMMIT,
        "shortWordReference": SHORT_SOURCE,
        "shortWordAudit": SHORT_WORDS,
        "sourceLicenseUrl": f"{SOURCE_URL}/blob/{SOURCE_COMMIT}/Copyright",
        "size": 80,
        "spelling": "American English",
        "variantLevel": 1,
        "wordCount": len(words),
        "minLetters": 2,
        "maxLetters": 11,
        "maxTiles": 10,
        "quIsOneTile": True,
        "wordSha256": digest,
        "simpleSPluralCount": len(plurals),
        "simpleSPluralSha256": plural_digest,
        "simpleSPluralPolicy": "ESDB-linked noun singular/plural pairs differing only by one final S; excludes verb-only forms.",
        "wordHashFormat": "Sorted uppercase ASCII words, one LF-terminated word per line",
        "countsByLetterLength": counts,
        "buildArguments": QUERY,
        "pluralQuery": PLURAL_QUERY.strip(),
        "policy": [
            "Use listed American spellings and normal variants, including listed inflections.",
            "Exclude abbreviations, contractions, prefixes, suffixes, word fragments and nonwords.",
            "Exclude special categories, punctuation, spaces, digits and words requiring capitalization.",
            "Exclude Moby-only and acronym-source entries; retain words supported by another permitted source.",
            "Remove diacritics using ESDB's deaccent filter, then accept lowercase ASCII entries only.",
            "Keep words of 2-11 letters fitting 10 squares when QU occupies one square.",
            "Supplement with reviewed standalone two-letter game words; see shortWordReference and shortWordAudit.",
            "Do not automatically derive plurals, conjugations or new words.",
            "This is Arcade's published word list, not an official Upwords or Scrabble tournament lexicon.",
        ],
    }
    # Group by first letter to keep source lines reasonable while storing each
    # word once. The characters are limited to A-Z, so this literal is safe.
    groups = [" ".join(word for word in words if word[0] == initial)
              for initial in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
    packed = "\n".join(groups)
    module = (
        "/*\n" + license_text + "\n"
        "Generated by tools/build-upwords-dictionary.py. Do not edit by hand.\n"
        "Source: " + SOURCE_URL + " at " + SOURCE_COMMIT + "\n*/\n\n"
        "export const DICTIONARY_ID = " + json.dumps(dictionary_id) + ";\n"
        "export const DICTIONARY_INFO = Object.freeze("
        + json.dumps(info, ensure_ascii=True, indent=2) + ");\n\n"
        "export const WORDS = Object.freeze(`" + packed + "`.split(/\\s+/));\n"
        "const wordSet = new Set(WORDS);\n\n"
        "export const PLURAL_S_WORDS = Object.freeze(`" + " ".join(plurals) + "`.split(/\\s+/));\n"
        "const simpleSPlurals = new Set(PLURAL_S_WORDS);\n\n"
        "/** Match only complete listed words; never guess inflections. */\n"
        "export function isWord(word) {\n"
        "  return typeof word === 'string' && /^[A-Za-z]{2,11}$/.test(word)\n"
        "    && wordSet.has(word.toUpperCase());\n"
        "}\n"
        "\n/** True only for a listed noun plural formed by adding one S. */\n"
        "export function isSimpleSPlural(base, extended) {\n"
        "  return typeof base === 'string' && typeof extended === 'string'\n"
        "    && extended.toUpperCase() === base.toUpperCase() + 'S'\n"
        "    && simpleSPlurals.has(extended.toUpperCase());\n"
        "}\n"
    )
    return {
        "upwords/dictionary.js": module,
        "upwords/dictionary-source.json": json.dumps(info, ensure_ascii=True, indent=2) + "\n",
        "upwords/LICENSE.dictionary.txt": license_text,
    }, info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Pinned ESDB git checkout")
    parser.add_argument("--check", action="store_true", help="Verify without modifying files")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    files, info = build(args.source.resolve())
    for name, content in files.items():
        destination = root / name
        if args.check:
            if not destination.exists() or destination.read_text() != content:
                raise SystemExit(f"Generated artifact differs: {name}")
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(content)
    print(json.dumps({"dictionaryId": info["id"], "wordCount": info["wordCount"],
                      "sha256": info["wordSha256"], "checked": args.check}, indent=2))


if __name__ == "__main__":
    main()
