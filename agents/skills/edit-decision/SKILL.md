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
- Run `scripts/find_phrase.py` against transcript JSON for exact word indexes and seconds.
- Snap output decisions to the production frame rate.
- Shortening records a gap. Do not silently ripple another scene.
- Extend source media only through recorded unused source frames and only into an existing gap.

## Sandbox media

Run frame math, transcript inspection, and FFmpeg only on sandbox copies. Emit derived media once through TrueForge's sandbox artifact handoff, then wait for Greenlight to return its immutable artifact ID. Never use or reveal a host path.

## Patch

Propose the smallest valid editor patch. Studio owns the visual preview. Chat carries only a short question or decision. Apply creates a new revision; Refine and Cancel preserve the base.
