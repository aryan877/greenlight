# Greenlight product requirements

Status: implementation · 25 August 2026

## Product

Greenlight is an agentic YouTube production editor. A creator gives it a topic, audience, goal, and permitted sources. A TrueForge Producer researches, verifies, scripts, builds editable scene bundles, creates media, renders a short video, checks it, and stages it on YouTube as unlisted. A person owns every material edit and the final decision to broadcast.

Greenlight is not a prompt-to-video slot machine, a generic chat UI, or a promise of views. It improves controllable inputs—research, story, pacing, editability, packaging, and release discipline.

## Primary user and job

An ambitious creator producing evidence-led short explainers wants to turn a defensible idea into a finished, reviewable YouTube release without coordinating many disconnected tools.

Success means one 30–120 second production can move from brief to unlisted review in one durable TrueForge session, with every scene still editable and public release impossible without current human approval.

## Principles

1. The timeline is primary; chat is the command surface beside it.
2. A scene is one bundle: visual, narration, timed transcript, captions, timing, locale, and sources.
3. Any number of scene bundles may be selected. Selection is typed context, never a file path.
4. Agent and manual edits use one patch format, one preview, and one approval path.
5. Preview is exact: Studio runs the same reducer the MCP tool will persist.
6. Word edits use measured transcript timing; generated timing is not guessed.
7. Evidence precedes factual narration.
8. Media provenance is immutable.
9. Upload is unlisted first. Public identity stays human-controlled.
10. Provider capabilities are reported honestly and unavailable modes do not silently fall back.

## Editor experience

### Workspace

- Left: creator-imported project media only, with real previews and direct attachment to Producer
- Center: resizable 16:9 Program monitor with working playback, seek, mute, volume, and fullscreen
- Bottom: collapsible and vertically resizable bundled-scene timeline with synchronized zoom and one playhead
- Right: concise Producer activity or scene Inspector
- All side panes collapse and resize; the canvas never overlaps the timeline

The visual language is a distinct light editorial system: Archivo plus IBM Plex Mono, quiet borders, restrained radii, real data, and color used for state and media relationships. It borrows the density and pane discipline of DeepSeek Harness and the spatial logic of a professional NLE without copying either product.

### Selection

- Click selects a scene bundle; Shift/Cmd-click adds or removes scenes.
- Dragging across the timeline draws a marquee and selects every intersecting scene bundle.
- Clicking the production title selects the whole cut.
- The composer shows compact removable scene chips and a count for overflow; this never limits actual selection.
- The serialized selection contains project, base revision, ordered scene IDs, bundled track IDs, artifact IDs, source ledger ID when relevant, and the exact time range.
- The Producer may call `focus_editor_selection` to move Studio to the scenes it is discussing.
- A creator may import supported local media. Greenlight copies it into the project workspace, shows it in the media browser, and adds the chosen artifact to Producer context without revealing a host path.

### Editing

- Natural language may change one field, multiple fields, several scenes, or the full cut.
- Drag reorder and end trim send exact instructions with typed selection to TrueForge.
- Split, remove, speed, localized track, visual, voice, caption, transcript, timing, and order changes are typed patch operations.
- Scene and gap timing is validated against the 30-fps production grid.
- Shortening preserves the removed frames as an explicit gap unless a separate structural edit resolves them.
- A scene cannot be extended beyond recorded unused source frames or beyond its existing gap.
- Local transient drag state is not production state.

### Preview and approval

When the Producer calls `apply_editor_patch`, TrueForge pauses the tool. Studio parses the pending arguments, validates them, applies the shared pure reducer locally, and enters Preview:

- changed scenes are hatched;
- changed visuals/text render on the canvas;
- the compact approval card embeds the affected real video range, exact cut/trim marker, before/after structure, caption, and timing delta;
- timing preview constrains playback and speed preview changes the actual preview rate;
- approval copy names the scenes and human fields, not protocol/tool jargon;
- Apply resumes the exact TrueForge tool call;
- Cancel removes Preview and leaves the immutable base revision untouched; Refine returns a concise reason to the Producer.

Render, unlisted upload, public publish, and schedule use the same native approval mechanism with action-specific human copy.

## Production workflow

1. Create a brief: topic, audience, goal, duration, tone, and channel.
2. Delegate bounded research and verification to TrueForge subagents.
3. Save a source ledger of sources and supported/conflicted claims.
4. Author a content package: headline, scenes, narration, visual direction, metadata, locale tracks, and claim IDs.
5. Attach license-compatible OpenMoji or explicitly selected generated/user media.
6. Generate narration scene by scene.
7. Transcribe narration for editable word timing and measured captions.
8. Preview and approve scoped revisions.
9. Render the exact immutable package with Remotion.
10. Run deterministic duration, frame, audio, evidence, and metadata checks.
11. Upload the verified artifact as unlisted with title, description, tags, disclosure, and thumbnail.
12. Publish or schedule only after approval of the exact release snapshot.

## Media requirements

### Visuals

- OpenMoji is the default clean toolkit and records CC BY-SA 4.0 provenance.
- Codex subscription image generation is an optional, bounded tool using the installed `imagegen` skill.
- Direct GPT Image API routes default to disabled.
- Remotion owns layout, typography, timing, captions, transitions, and final encoding; generated images are assets, not the editor.
- Creator images, clips, narration, and caption files are signature-checked, copied into immutable content-addressed storage, and placed on scenes by artifact ID. Imported video remains a real video source in preview and export.

### Voice and transcription

- Voice provider/model/voice are configuration, not hardcoded pricing logic.
- Current voice route: OpenRouter `google/gemini-3.1-flash-tts-preview`, voice `Kore`.
- Current transcription route: OpenRouter `openai/gpt-4o-mini-transcribe` for reference text and local `whisper.cpp` for measured word timestamps.
- `find_spoken_phrase` returns exact start/end word boundaries for commands such as “cut after this phrase.”
- `correct_transcript` creates a new immutable revision while preserving measured timestamps.
- Captions are grouped from measured words; TTS duration is never distributed by character count.

## TrueForge requirements

- TrueForge runs the user-facing root Producer and owns turns, session durability, subagents, sandbox/Code Mode, MCP calls, and approval events.
- The root Producer is the only agent that asks the user questions.
- Subagents are bounded, cannot spawn nested agents, and return work to the root.
- Greenlight exposes small typed domain tools, never a one-shot `make_video` function.
- Flexible edit math and FFmpeg work happens in the TrueForge sandbox. Emitted files return through the SDK download boundary, Greenlight's media validator, and immutable artifact IDs; the model never receives a host path.
- Studio uses the official TrueForge TypeScript SDK and `user.tool_approval` turns.
- Tool activity is translated into short human progress; raw event names, IDs, arguments, and chain-of-thought are not dumped into the product UI.

## Safety and data

- SQLite stores projects, artifact index, operations, and releases.
- Artifact payloads are immutable, content-addressed files with SHA-256 and provenance.
- TrueForge owns session state; Greenlight does not duplicate it.
- OAuth tokens, API keys, local credential paths, and authorization headers never enter model context or stored artifacts.
- YouTube tools accept internal artifact IDs and resolve them below the artifact root.
- Upload and release operations are idempotent.
- Public release revalidates channel, video, content, metadata, quality, evidence, and snapshot hashes.
- Delete and bulk mutation are not exposed.

## Acceptance criteria

- A selected scene appears as context in the composer and an agent can focus a different valid selection.
- Multi-select and whole-cut selection preserve ordered scene IDs with no arbitrary cap.
- Timeline marquee selection preserves complete scene bundles and a real canvas gutter.
- An imported media file appears with its real thumbnail/type, becomes removable Producer context, previews on the selected scene, and resolves to the same immutable file during Remotion export.
- A scoped title/visual/timing/speed patch visibly previews before execution.
- A trim preserves removed frames as a visible gap, a split preserves duration, and source-backed extension cannot exceed recorded handles.
- A sandbox-derived media output is imported once with session/turn provenance and the Producer receives only its immutable artifact ID.
- Deny leaves the base revision byte-for-byte unchanged; Apply writes a patch artifact and one new content package.
- Drag reorder and manual end trim travel through TrueForge, not a parallel local mutation path.
- A phrase can be resolved to real timed words; a missing phrase fails instead of guessing.
- Remotion uses scene-authored data and playback rate, not duplicated editorial constants.
- Quality checks fail honestly when an input or capability is missing.
- Upload stays unlisted until a separate exact publish/schedule approval succeeds.
- `pnpm verify` passes without provider spend or external writes.

## Out of scope

- Guaranteed views, revenue, or autonomous trend farming
- Long-form multi-hour editing
- Collaborative multi-user conflict resolution
- Arbitrary shell access for the agent
- Automatic public posting or subscriber-facing actions
- Deleting existing YouTube content
