# Greenlight

Greenlight is a TrueForge-native production agent inside a real, scene-based video editor. It researches and verifies a short YouTube story, creates editable media, renders it with Remotion, stages it as unlisted, and stops for a human before anything becomes public.

The editor is the product surface. The Producer receives a compact map of the complete current cut on every turn; selected scenes, gaps, and imported media are the creator's current emphasis. Manual controls edit immediately and stay undoable. Producer-authored changes highlight their target in the real timeline and use TrueForge's native approval event. Both persist through the same validated patch service.

## What works

- TrueForge root agent with typed MCP tools, sandbox, dynamic subagents, streamed turns, and resumable approvals
- Immutable projects and artifacts in SQLite plus content-addressed local files
- Scene-bundle selection with no arbitrary selection or scene-count cap
- Click, Shift/Cmd, and marquee multi-select across scene bundles and real gaps; immediate local reorder, trim, speed, split, track controls, and undo/redo; timeline zoom, playback, mute, volume, and resizable/collapsible panes
- Project history and new-project creation backed by the saved SQLite workspace, with managed paths and artifact counts
- A creator-media bin with measured size, duration, dimensions and codecs; full image/audio/video viewers; signature-checked import; click/drag attachment; and direct file drop into Producer
- Agent-driven Studio focus through `focus_editor_selection`, plus readable scene references dragged directly into the composer
- One shared Zod patch contract, reducer, and revision service for direct Studio edits and Producer proposals
- Frame-aligned, edge-to-edge video, named audio, and caption lanes with explicit gaps, source handles, adaptive ruler ticks, and a continuous zoom range
- Scene-sized primary narration, dub, music, and effects clips with track names, BCP-47 locales, gain, mute, solo, and export inclusion; Remotion mixes only the enabled tracks
- Producer proposals preview trims, splits, speed changes, ranges, captions, and gaps on Program and the real timeline; chat stays concise with Apply, Refine, and Cancel
- OpenMoji search and attachment with licensed SVG provenance
- Optional bounded Codex-subscription image generation; GPT Image API routes stay disabled
- Per-scene multilingual voice through one production route—OpenRouter to Gemini TTS—with an in-chat voice audition card and complete model, voice, locale, and artifact provenance
- Core timed transcription: OpenRouter `gpt-4o-mini-transcribe` reference text plus local `whisper.cpp` word boundaries, exact phrase lookup, immutable corrections, and typed active-word captions derived from measured timing
- Native TrueForge sandbox-output import: derived files are downloaded by exact session and turn, signature-checked, content-addressed, deduplicated, and handed back to the Producer only by artifact ID
- Deterministic Remotion render and thumbnail, best-effort cross-platform hardware encoding with safe software fallback, FFprobe-backed quality checks, and playback-rate support
- Local YouTube OAuth wrapper, unlisted-first staging, immutable release snapshots, and approval-gated publish/schedule tools

No paid transcription or image API call, YouTube upload, or public release is performed during setup or tests.

## Architecture

```text
Creator
  ↕ selects scenes / directs edits / approves
Greenlight Studio (React + Tailwind + TanStack Query)
  ↕ TrueForge SDK event stream
TrueForge root Producer
  ↕ typed MCP calls
Greenlight MCP
  ├─ Zod contracts + shared patch reducer
  ├─ SQLite project index + immutable artifact store
  ├─ OpenMoji / Codex image / voice / transcription adapters
  ├─ Remotion renderer + quality checks
  └─ YouTube uploader boundary
```


## Run locally

Requirements: Node 22+, pnpm 9+, FFmpeg/FFprobe, `whisper-cli`, a local Whisper model, and a local TrueForge server. Greenlight defaults to `~/.cache/greenlight/models/ggml-base.bin`; override `GREENLIGHT_WHISPER_MODEL` for a larger multilingual model.

```bash
pnpm install
cp .env.example .env
openssl rand -hex 32 # paste as GREENLIGHT_MCP_AUTH_TOKEN
```

Put provider keys only in `.env`. The current root model, voice, and reference transcription use `OPENROUTER_API_KEY`. Precise word timing runs locally through `whisper.cpp`; no separate OpenAI key is needed. Never commit `.env`.

Start TrueForge in one terminal:

```bash
npx @truefoundry/trueforge
```

Start Greenlight and configure its TrueForge provider, MCP server, and agent:

```bash
pnpm dev
pnpm trueforge:configure
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

The optional Remotion authoring view runs with:

```bash
pnpm dev:render
```

## Verify

```bash
pnpm verify
```

The suite covers contracts, scoped patch safety, storage, voice conversion, transcription timing and phrase lookup, YouTube invocation, and render duration. Provider tests use fake responses and do not spend money.

## Safety boundaries

- Models receive artifact IDs, never host paths or OAuth credentials.
- Creator media is copied into content-addressed project storage; the original stays untouched and no external symlink enters the workspace.
- Visual, narration, caption, transcript, timing, and source context move as one scene bundle.
- Local edits create immutable revisions; the base cut is never overwritten.
- Shortening keeps removed time as an explicit gap unless a separate structural edit intentionally resolves it; extension requires recorded unused source frames.
- Sandbox-derived files cross the TrueForge download boundary and Greenlight media validator; no host path enters model context.
- Generated narration is never given estimated word timing.
- YouTube uploads are unlisted first.
- TrueForge authenticates to the MCP service with a private header; the Studio never receives that credential.
- Agent calls to `apply_editor_patch`, render, upload, publish, and schedule are TrueForge approval-gated. Direct timeline edits commit immediately into local undo history and never invoke the model.
- Publish and schedule atomically claim an unlisted release before contacting YouTube, preventing concurrent release attempts.
- Public release rechecks the exact immutable snapshot and configured channel allowlist.
- There is no delete-video tool.

## Repository map

- `apps/studio` — agentic editor and sanitized TrueForge event presentation
- `apps/mcp` — typed production tools, providers, storage, render and YouTube boundaries
- `apps/render` — Remotion composition and deterministic render entrypoint
- `packages/contracts` — canonical schemas, types, and patch reducer
- `agents/producer` — TrueForge agent manifest and instructions
- `research` — dated hackathon, TrueForge, provider, Remotion, and design references

## Attribution and disclosure


