#!/usr/bin/env python3
"""Find a normalized spoken phrase in a Greenlight timed transcript."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def normalize(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("transcript", type=Path)
    parser.add_argument("phrase")
    args = parser.parse_args()

    transcript = json.loads(args.transcript.read_text(encoding="utf-8"))
    words = transcript["words"]
    target = [token for word in args.phrase.split() if (token := normalize(word))]
    measured_words = [
        (word, token)
        for word in words
        if (token := normalize(str(word["text"])))
    ]
    if not target:
        raise SystemExit("phrase_not_found")
    measured = [token for _, token in measured_words]

    for start in range(len(measured) - len(target) + 1):
        if measured[start : start + len(target)] != target:
            continue
        matched = [word for word, _ in measured_words[start : start + len(target)]]
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
