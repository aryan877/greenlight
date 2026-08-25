# Greenlight

**An AI production crew inside a real video editor. It can research, write, edit, render, and prepare a YouTube release. It cannot publish behind your back.**

Most video agents end at a generated file. Greenlight keeps going, but keeps the creator in control.

You edit on a normal timeline. Video, audio, captions, gaps, and tracks remain independently selectable. The AI Producer sees the complete current cut, can focus the exact items it means, and can operate the same editing commands when asked. It researches through TrueForge, delegates independent questions to subagents, renders with Remotion, and stages the result on YouTube as unlisted. Public or scheduled release pauses for your approval.

```text
Topic
  → sourced research
  → editable scenes
  → voice, timed captions, and media
  → checked render
  → unlisted YouTube review
  → your greenlight
```

## The product loop

1. Ask for a short video about a topic.
2. The AI Producer searches the current web with Exa and can send separate questions to TrueForge subagents.
3. Research becomes a claim-level evidence ledger, script, and editable storyboard.
4. Video, voice, captions, and source ranges arrive as editable timeline items. Select them independently or marquee the aligned set when you want them together.
5. Trim, split, reorder, change speed, mute tracks, edit metadata, or undo directly. These normal editor actions happen immediately without calling the model.
6. Ask the AI Producer for a change. It focuses the intended range, previews the real result in Program and Timeline, and uses TrueForge approval before a consequential tool runs.
7. Render the exact revision, run deterministic checks, and upload it as unlisted.
8. Review the thumbnail, title, description, tags, disclosure, and release plan in the Release workspace.
9. Approve the exact locked snapshot before it becomes public or scheduled.

The human using the editor is the **creator**. The AI running in TrueForge is the **AI Producer**.

## Why TrueForge matters

Greenlight does not use TrueForge as a chat box around a separate workflow. TrueForge is the agent runtime.

| TrueForge capability  | What Greenlight uses it for                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Models                | Runs the root AI Producer through the configured OpenRouter model                                            |
| MCP connectors        | Greenlight production tools plus deferred Exa web search and page retrieval                                  |
| Dynamic subagents     | Independent research and verification that return compact sourced findings                                   |
| Skills                | Editorial writing, evidence work, release packaging, and transcript-aware edit decisions                     |
| Sandbox and Code Mode | Generated Python reads real selected media in bounded, hash-verified chunks, then processes the sandbox copy |
| Durable sessions      | Reconnects to the latest turn, question, or approval after a refresh                                         |
| Context compaction    | Uses a threshold derived from the selected model's advertised context window                                 |
| Native approvals      | Pauses exact edit, render, upload, publish, and schedule tool calls                                          |

Exa comes from TrueForge's connector catalog and needs no API key. It stays deferred, so its tool schemas enter context only when research needs them.

## Editor capabilities

- Square, borderless 16:9 Program monitor with playback, seek, volume, mute, and fullscreen
- Resizable and collapsible media, timeline, and AI panels
- Frame-aligned timeline with continuous zoom, adaptive ruler ticks, marquee selection, gaps, and one playhead
- Independent video, named audio, and caption clips on persistent, reorderable tracks
- Immediate drag reorder, trim, split, speed, mute, solo, export inclusion, undo, and redo
- Any-size multi-selection with exact clip, track, and gap context that can be dragged into the AI composer
- Signature-checked local media import with real preview, size, duration, dimensions, and codec details
- AI focus that can highlight the scenes or gap it believes the creator means before acting
- One typed patch and revision system shared by direct edits and AI proposals
- A first-class YouTube Release workspace controlled by both the creator and AI Producer

## Media pipeline

- **Visuals:** OpenMoji with license provenance, creator media, and an optional bounded Codex subscription image route
- **Voice:** OpenRouter to Gemini TTS, one production provider with configurable model, voice, and locale
- **Transcription:** OpenRouter `gpt-4o-mini-transcribe` for reference text and local `whisper.cpp` for measured word boundaries
- **Captions:** Derived from measured words, never character-count timing
- **Render:** Remotion with best-effort hardware encoding and safe software fallback
- **Quality:** Contract, evidence, duration, frame, audio, and FFprobe checks
- **Release:** Existing local YouTube OAuth profile, unlisted-first upload, and immutable release snapshots

Direct GPT Image API routes are disabled by default. Setup and tests do not make paid media calls, upload to YouTube, or publish anything.

## Architecture

```text
Creator
  ↕ direct editing and approvals
Greenlight Studio
  ↕ TrueForge SDK event stream
TrueForge AI Producer
  ├─ Exa web research
  ├─ bounded subagents
  ├─ skills and sandbox
  └─ typed Greenlight MCP calls
       ├─ Zod contracts and patch reducer
       ├─ SQLite and immutable artifacts
       ├─ media providers and Remotion
       └─ YouTube uploader
```

TrueForge owns turns, subagents, tool discovery, sandbox work, reconnect, compaction, and approvals. Greenlight owns production state and constrained side effects. The model receives artifact IDs and project-relative references, never host paths, OAuth files, or API keys.

When Code Mode needs raw media, it calls Greenlight's read-only `read_artifact_chunk` tool from inside the sandbox. The script assembles a bounded copy and verifies its SHA-256 before processing. Base64 and host paths never enter the creator conversation. Derived files return through TrueForge's `sandbox_artifacts` handoff and become new immutable Greenlight artifacts.


## Run locally

Requirements:

- Node.js 22+
- pnpm 9+
- FFmpeg and FFprobe
- `whisper-cli` plus a local Whisper model
- TrueForge
- an OpenRouter API key

```bash
pnpm install
cp .env.example .env
openssl rand -hex 32
```

Put the generated value in `GREENLIGHT_MCP_AUTH_TOKEN`. Put provider credentials only in the ignored `.env` file.

Start TrueForge:

```bash
npx @truefoundry/trueforge
```

Standalone TrueForge includes a local sandbox fallback on supported macOS and Linux hosts. Confirm it before a demo with `GET /api/v1/capabilities`; `sandbox.enabled` must be `true`. A cloud sandbox provider is optional for the local judged flow.

Start Greenlight, then configure TrueForge:

```bash
pnpm dev
pnpm trueforge:configure
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

Greenlight imports its four custom skills from Git because that is TrueForge's skill boundary. The repository must be publicly cloneable before sandbox skill loading can work. Keep it private during owner-only development; make it public for the hackathon submission, then rerun `pnpm trueforge:configure`. Never put a GitHub token in a skill URL.

The optional Remotion authoring view is:

```bash
pnpm dev:render
```

## Connect YouTube

Greenlight wraps the existing uploader at `GREENLIGHT_YOUTUBE_UPLOADER` and uses the profile named by `GREENLIGHT_YOUTUBE_PROFILE`.

Authenticate that profile with the uploader, then set `GREENLIGHT_YOUTUBE_CHANNEL_ID` to the only channel Greenlight may use. The Studio shows the connected channel but never receives the OAuth credential path or token.

Uploads are always unlisted first. Publishing and scheduling are separate TrueForge-approved actions. Greenlight exposes no delete-video tool.

## Verify without spending money

```bash
pnpm verify
```

The gate runs formatting, lint, type checks, unit tests, and production builds. Provider tests inject fake responses. They do not call paid APIs or YouTube.

## Safety model

- Imported media is copied into content-addressed project storage. Originals stay untouched.
- Every edit creates an immutable content revision.
- Creator gestures save immediately and remain undoable.
- AI edits preview against the same reducer that will persist them.
- Generated files cross TrueForge's sandbox download boundary and Greenlight's media validator.
- Word-accurate cuts require measured transcript timing. Missing timing fails instead of guessing.
- Upload, publication, and scheduling are idempotent and channel-allowlisted.
- A changed video or metadata snapshot requires fresh approval.
- No credential, arbitrary host path, or raw chain-of-thought is shown to the model or creator UI.

## Repository map

- `apps/studio`: React, Tailwind, TanStack Query, timeline, Program, AI, and Release surfaces
- `apps/mcp`: production tools, read API, providers, artifacts, rendering, and YouTube boundary
- `apps/render`: Remotion composition and render entrypoint
- `packages/contracts`: canonical Zod schemas, derived types, and pure patch reducer
- `agents/producer`: TrueForge manifest and root instructions
- `agents/skills`: four small Greenlight-specific TrueForge skills
- `research`: dated hackathon, TrueForge, provider, Remotion, and design references

## Honest limits

- Greenlight targets 30 to 120 second evidence-led videos, not multi-hour productions.
- It does not promise views, revenue, or autonomous channel growth.
- Custom TrueForge skills require a public Git source at runtime.
- The YouTube OAuth profile must be connected manually on the trusted host.
- Codex subscription image generation is a trusted-machine capability, not a hosted multi-tenant provider.
- The final paid transcription, unlisted upload, and release rehearsal remain manual pre-submission gates.

## Attribution and disclosure


