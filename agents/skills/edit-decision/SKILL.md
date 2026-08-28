---
name: edit-decision
description: Resolve timeline, transcript, timing, and sandbox media-edit decisions without inventing timestamps or host paths.
---

# Edit decision

Use this skill for cuts, trims, gaps, speed, merge decisions, captions, dubbing, and derived media.

## Target first

Read `EDITOR_TIMELINE` as the complete current cut and `EDITOR_SELECTION` as emphasis. Resolve relative language against the playhead, cuts, gaps, and ordered scenes. If two targets remain plausible, focus the best match in Studio and ask one short question.

Selection does not force every selected scene to change. A split targets one scene. A merge targets a contiguous range.

## Timing

- Use measured transcript words for spoken-word edits.
- Run `scripts/find-phrase.py` against transcript JSON for exact word indexes and seconds.
- Snap output decisions to the production frame rate.
- Shortening records a gap. Do not silently ripple another scene.
- Extend source media only through recorded unused source frames and only into an existing gap.
- Treat video, audio, and caption items as independent. Changing one never implies changing another unless the creator explicitly selected and requested each item.

## Captions

The complete timeline exposes caption and audio ranges plus their transcript and caption artifact IDs. If captions are missing, outlast their intended audio, or no longer align after an edit, ask one short question: whether to re-transcribe for accuracy. Call `transcribe_audio` only after the creator agrees. It accepts one narration artifact or one rendered cut when the creator wants a fresh whole-video transcript. Never estimate word timing and never re-transcribe automatically.

Caption-track visibility is a normal editor setting. Show or hide only the named caption track; do not delete its timed artifact.

## Sandbox media

Run frame math, transcript inspection, and FFmpeg only on sandbox copies. For a Greenlight artifact, discover the deferred `read_artifact_chunk` schema, then call it from Code Mode in a bounded loop. Decode each chunk directly into one sandbox file and verify its SHA-256 after the final chunk. Never print base64 or return it to the creator.

Keep the transfer script small: `offset = 0`; call the tool; append `base64.b64decode(data_base64)`; set `offset = next_offset_bytes`; stop at `eof`; compare the file digest with `sha256`. The tool never exposes a host path.

Emit derived media once through TrueForge's sandbox artifact handoff, then wait for Greenlight to return its immutable artifact ID.

## Patch

Propose the smallest valid editor patch. Studio owns the visual preview. Chat carries only a short question or decision. Apply creates a new revision; Refine and Cancel preserve the base.
