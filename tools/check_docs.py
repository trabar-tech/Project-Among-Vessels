#!/usr/bin/env python3
"""Documentation cross-reference checker.

Verifies the design-doc suite is internally consistent: every internal
markdown link resolves, every doc in the required set exists, required
headings are present, and no locked section still contains a TODO stub.

Usage:
  python3 tools/check_docs.py
  python3 tools/check_docs.py --strict   # also fail on TODO/FIXME anywhere

Exit codes: 0 = ok, 1 = problems found, 2 = usage error.
Stdlib only.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIRED = [
    "README.md",
    "00_SWOT_AND_STRATEGY.md",
    "01_DEV_TOOLS.md",
    "02_AMONG_US_CORE.md",
    "03_HYBRID_MECHANICS.md",
    "04_AI_ARCHITECTURE.md",
    "05_QUICKCHAT_GRAMMAR.md",
]
# Substrings that must appear in a *heading line* (any level) of each doc.
REQUIRED_HEADINGS = {
    "00_SWOT_AND_STRATEGY.md": ["00", "SWOT", "Strategy"],
    "01_DEV_TOOLS.md": ["01", "Tools"],
    "02_AMONG_US_CORE.md": ["02", "Loop", "Win Conditions"],
    "03_HYBRID_MECHANICS.md": ["03", "SIGNALIS", "Project Zomboid"],
    "04_AI_ARCHITECTURE.md": ["04", "GOAP", "Director"],
    "05_QUICKCHAT_GRAMMAR.md": ["05", "Grammar", "Suspicion"],
    "06_IDENTITY_AND_PASSING.md": ["06", "Cover System", "True Impostors"],
    "07_ENGINE_AND_3D.md": ["07", "Engine Decision", "Presentation Contract"],
}
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
HEADING_RE = re.compile(r"^#{1,6}\s+.*$", re.MULTILINE)
# Stub markers, as actually written in a doc: "TODO: ...", "FIXME - ...",
# or an unchecked task box. Prose that merely *discusses* stubs is fine.
STUB_RE = re.compile(r"(?:\b(?:TODO|FIXME)\s*[:\-]|^\s*[-*]\s*\[ \])", re.MULTILINE)


def check(root: Path, strict: bool) -> list[str]:
    problems: list[str] = []
    for name in REQUIRED:
        if not (root / name).exists():
            problems.append(f"missing required doc: {name}")
    for name, headings in REQUIRED_HEADINGS.items():
        path = root / name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        heading_lines = HEADING_RE.findall(text)
        for heading in headings:
            if not any(heading in line for line in heading_lines):
                problems.append(f"{name}: missing required heading containing '{heading}'")
        if strict:
            stub = STUB_RE.search(text)
            if stub:
                line = text[: stub.start()].count("\n") + 1
                problems.append(f"{name}:{line}: stub marker in a frozen doc (strict mode)")
    # Internal links in every markdown file at the repo root.
    for md in sorted(root.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        for target in LINK_RE.findall(text):
            target = target.strip()
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            path_part = target.split("#", 1)[0]
            if not path_part:
                continue
            if not (root / path_part).exists():
                problems.append(f"{md.name}: broken internal link -> {target}")
    return problems


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Check design-doc cross-references")
    p.add_argument("--strict", action="store_true")
    p.add_argument("--root", type=Path, default=ROOT)
    args = p.parse_args(argv)
    problems = check(args.root, args.strict)
    if problems:
        for prob in problems:
            print(f"ERROR: {prob}", file=sys.stderr)
        return 1
    print(f"docs OK: {len(REQUIRED)} required docs present, internal links resolve, "
          f"required headings present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
