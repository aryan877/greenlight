# Greenlight

Greenlight is a TrueForge-native production agent inside a real, scene-based video editor. It researches and verifies a short YouTube story, creates editable media, renders it with Remotion, stages it as unlisted, and stops for a human before anything becomes public.

The editor is the product surface. Selecting one or many scene bundles gives the Producer exact typed context—scene IDs, time range, media artifacts, transcript, and sources. An edit becomes a reversible preview first. The same validated patch is then either denied or applied through TrueForge's native approval event.

## What works

- TrueForge root agent with typed MCP tools, sandbox, dynamic subagents, streamed turns, and resumable approvals
- Immutable projects and artifacts in SQLite plus content-addressed local files
- Scene-bundle selection with no arbitrary selection or scene-count cap
- Shift/Cmd multi-select, whole-cut selection, drag reorder, end trim, timeline zoom, playback, mute, volume, and resizable/collapsible panes
- Agent-driven Studio focus through `focus_editor_selection`
- One shared Zod patch contract and reducer for Studio preview and MCP persistence
- OpenMoji search and attachment with licensed SVG provenance
- Optional bounded Codex-subscription image generation; GPT Image API routes stay disabled
- Gemini voice through OpenRouter with provider/model provenance
- Core timed transcription: `gpt-4o-mini-transcribe` reference text plus Whisper word boundaries, exact phrase lookup, corrections, and captions derived from measured timing
- Deterministic Remotion render, thumbnail, FFprobe-backed quality checks, and playback-rate support
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

Requirements: Node 22+, pnpm 9+, FFmpeg/FFprobe, and a local TrueForge server.

```bash
pnpm install
cp .env.example .env
```

Put provider keys only in `.env`. At minimum, the current root model needs `OPENROUTER_API_KEY`. `OPENAI_API_KEY` is needed only when timed transcription is called. Never commit `.env`.

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
- Visual, narration, caption, transcript, timing, and source context move as one scene bundle.
- Local edits create immutable revisions; the base cut is never overwritten.
- Generated narration is never given estimated word timing.
- YouTube uploads are unlisted first.
- `apply_editor_patch`, render, upload, publish, and schedule are TrueForge approval-gated in the hackathon agent.
- Public release rechecks the exact immutable snapshot and configured channel allowlist.
- There is no delete-video tool.

## Repository map

- `apps/studio` — agentic editor and sanitized TrueForge event presentation
- `apps/mcp` — typed production tools, providers, storage, render and YouTube boundaries
- `apps/render` — Remotion composition and deterministic render entrypoint
- `packages/contracts` — canonical schemas, types, and patch reducer
- `packages/ui` — shared editorial tokens
- `agents/producer` — TrueForge agent manifest and instructions
- `research` — dated hackathon, TrueForge, provider, Remotion, and design references

## Attribution and disclosure


