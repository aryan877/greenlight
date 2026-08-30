# Greenlight

Greenlight takes a sourced video idea to an editable cut and an unlisted YouTube review without taking release control away from the creator.

It combines a real multi-track editor with a TrueForge Producer agent. Direct editing stays immediate and local. Agent work stays visible, reviewable, and approval-gated. Remotion renders the exact timeline revision.

```text
idea → sourced script → editable timeline → checked render → unlisted review → creator approval
```

## What works

- Independent video, audio, caption, transition, track, gap, and selection state
- Frame-aligned trim, split, move, reorder, mute, undo, redo, and timeline zoom
- TrueForge sessions, subagents, skills, sandbox work, reconnect, compaction, and native approvals
- One typed edit-command model shared by direct gestures and Producer proposals
- Immutable content packages and media artifacts backed by SQLite
- Remotion video and thumbnail rendering with deterministic quality checks
- Optional provider-backed voice, transcription, image generation, B-roll, music, and effects
- YouTube staging as unlisted with locked-snapshot approval before publish or scheduling

## Why TrueForge is central

TrueForge runs the Producer loop rather than acting as a chat shell around another workflow. It owns turns, tool discovery, subagents, skills, Code Mode, approval pauses, session history, and context compaction.

TrueForge is TrueFoundry's open-source agent harness. TrueFoundry's broader AI Gateway and MCP Gateway products are separate optional integrations, not replacements for the harness Greenlight runs on.

Greenlight supplies a typed HTTP MCP service for production state and trusted side effects. The model sees immutable artifact IDs, never credentials or host paths.

```text
Creator
  ↕
Studio editor
  ↕ TrueForge SDK events
TrueForge Producer
  ├─ deferred research connectors
  ├─ bounded subagents
  ├─ lazy editorial skills
  ├─ sandboxed media work
  └─ Greenlight MCP
       ├─ contracts and revisions
       ├─ SQLite and artifacts
       ├─ providers and Remotion
       └─ YouTube release controls
```

## Repository layout

```text
apps/
  studio/       React editor and release interface
  mcp/          Runnable Greenlight MCP/API service
  render/       Deterministic Remotion renderer
packages/
  contracts/    Shared Zod schemas and edit invariants
agents/         TrueForge Producer definition and lazy skills
scripts/        Local setup utilities
```

The MCP service belongs in `apps/` because TrueForge connects to it as an independently runnable HTTP process. Shared reusable types remain in `packages/contracts`.

## Local setup

Requirements:

- Node.js 22+
- pnpm 9+
- FFmpeg and FFprobe
- TrueForge
- An OpenAI-compatible model route, configured through OpenRouter by default

```bash
pnpm install
cp .env.example .env
openssl rand -hex 32
```

Put the generated value in `GREENLIGHT_MCP_AUTH_TOKEN` and keep provider credentials only in the ignored `.env` file.

Configure and run the stack:

```bash
pnpm trueforge:configure
pnpm dev
```

Local services:

- TrueForge: `http://localhost:8790`
- Greenlight MCP/API: `http://localhost:8941`
- Studio: `http://localhost:4173`

## Development commands

```bash
pnpm dev             # run Studio, MCP, and Render development processes
pnpm dev:studio      # run only the editor
pnpm dev:mcp         # run only the MCP/API service
pnpm dev:render      # open Remotion Studio
pnpm studio:seed     # create local sample production state
pnpm verify          # format check, lint, typecheck, tests, and builds
```

Tests use local fixtures and fake provider/process responses. They do not make paid media calls, upload videos, or publish anything.

## Documentation and hackathon references

Use live sources so implementation decisions do not depend on stale documentation copies:

1. [TrueForge documentation index](https://trueforge.dev/llms.txt)
2. [TrueForge combined documentation](https://trueforge.dev/llms-full.txt)
3. [Official WeMakeDevs hackathon resources](https://www.wemakedevs.org/hackathons/trueforge/resources)

Downloaded research and private working notes belong under the Git-ignored `research/` directory. Do not commit documentation mirrors.

Repository documentation:

- [Product requirements](PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Architecture decisions](docs/decisions/)
- [AI assistance disclosure](AI_ASSISTANCE.md)
- [Attributions](docs/ATTRIBUTIONS.md)

## Release guarantees

- Uploads are always unlisted first.
- Publish and schedule require approval for the exact current content, metadata, evidence, quality, render, destination, and release hashes.
- Changed release state invalidates the prior approval.
- Release operations are idempotent and atomically claimed before external work.
- No video-delete or channel-wide mutation tool exists.

## Current limits

- The judged flow targets short-form, single-creator production.
- Word-accurate edits require measured transcription boundaries.
- Optional media providers need owner-supplied credentials and capability checks.
- Public release remains deliberately human-controlled.

The product contract and acceptance criteria live in [PRD.md](PRD.md).
