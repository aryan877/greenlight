#!/usr/bin/env python3
"""Find a normalized spoken phrase in a Greenlight timed transcript."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("transcript", type=Path)
    parser.add_argument("phrase")
    args = parser.parse_args()

    transcript = json.loads(args.transcript.read_text(encoding="utf-8"))
    words = transcript["words"]
    target = [normalize(word) for word in args.phrase.split() if normalize(word)]
    measured = [normalize(str(word["text"])) for word in words]

    for start in range(len(measured) - len(target) + 1):
        if measured[start : start + len(target)] != target:
            continue
        matched = words[start : start + len(target)]
        print(
            json.dumps(
                {
                    "start_word_index": matched[0]["index"],
                    "end_word_index": matched[-1]["index"],
                    "start_seconds": matched[0]["start_seconds"],
                    "end_seconds": matched[-1]["end_seconds"],
                    "text": " ".join(str(word["text"]) for word in matched),
                },
                separators=(",", ":"),
            )
        )
        return

    raise SystemExit("phrase_not_found")


if __name__ == "__main__":
    main()
