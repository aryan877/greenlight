<p align="center">
  <img src="apps/studio/src/assets/greenlight-logo.svg" alt="Greenlight" width="420" />
</p>

<p align="center"><strong>A TrueForge-native YouTube production studio with evidence, editing, rendering, and release in one controlled loop.</strong></p>

```text
research → sourced script → editable timeline → checked render → unlisted review
```

## Why Greenlight

Greenlight combines a real multi-track editor with a visible TrueForge Producer. Direct gestures and agent proposals use the same typed edit contract, every accepted change creates an immutable revision, and the creator keeps final release control.

- Click a scene to inspect its claims and source links in Evidence Lens.
- Edit video, audio, captions, transitions, tracks, and gaps independently.
- Preview Producer changes before Apply, Refine, or Cancel.
- See waveforms, normalize tracks, and duck music under narration.
- Check evidence, captions, audio, black frames, metadata, render, and disclosure together.
- Prepare three YouTube thumbnail candidates and choose the active one.
- Refresh during research and continue the same durable TrueForge thread.
- Stage to YouTube as unlisted; public or scheduled release requires exact-snapshot approval.

## TrueForge architecture

```text
Studio editor ───────┐
                     ├─ typed EditorPatchOperation → immutable revision
TrueForge Producer ──┘
  ├─ durable sessions and bounded subagents
  ├─ four lazy SKILL.md workflows
  ├─ sandbox and Code Mode
  └─ Greenlight MCP → providers → Remotion → quality → YouTube
```

`agents/producer` contains the saved Producer definition. `agents/skills/*` contains the git-backed skills registered by `scripts/configure-trueforge.mjs`. This matches TrueForge’s skill model: each configured repository path is rooted at a `SKILL.md` and loaded progressively in the sandbox.

TrueForge only clones public GitHub/GitLab skill repositories. While this repository is private, setup safely detaches the skills; rerun `pnpm trueforge:configure` after making the submission repository public.

## Run the demo

Requirements: Node.js 22+, pnpm 9+, FFmpeg/FFprobe, and an owner-configured model route.

```bash
pnpm install
cp .env.example .env
openssl rand -hex 32 # use as GREENLIGHT_MCP_AUTH_TOKEN

# First-time setup: start TrueForge, then run configure in another terminal.
pnpm trueforge
pnpm trueforge:configure

# Complete judged stack after configuration
# Stop the first TrueForge process before this command.
pnpm demo
```

- Studio: `http://localhost:4173`
- Greenlight MCP: `http://localhost:8941/mcp`
- TrueForge: `http://localhost:8790`

Demo order: start refresh-safe research, refresh the page, open Evidence Lens, make one direct edit and one Producer edit, show waveform/ducking, then open Release Readiness and the thumbnail candidates before staging unlisted.

## Repository

```text
apps/studio         React editor and Producer event projection
apps/mcp            MCP/API service and trusted side effects
apps/render         Deterministic Remotion renderer
packages/contracts  Shared Zod schemas and invariants
agents              Producer definition and lazy skills
scripts             Setup and demo utilities
```

Run the complete gate with:

```bash
pnpm verify
```

## Safety

- Models receive immutable artifact IDs, never credentials or host paths.
- Claim-to-source coverage is required before render and public release.
- Upload is always unlisted first.
- Changing a locked release input invalidates approval.
- No video-delete or channel-wide mutation tool exists.

## Qodo Code Review Evidence

<p>
  <a href="https://www.qodo.ai/media-kit/"><img src="https://www.qodo.ai/wp-content/uploads/2025/04/Group-2147203332.svg" alt="Qodo" height="38" /></a>&nbsp;&nbsp;
  <a href="https://trueforge.dev/"><img src="apps/studio/src/assets/trueforge-logomark.svg" alt="TrueForge" height="38" /></a>
</p>

- Submission PR: [aryan877/greenlight#1](https://github.com/aryan877/greenlight/pull/1)
- Run Qodo on the final head, resolve findings, and merge before submission.

See [PRD.md](PRD.md), [TrueForge docs](https://trueforge.dev/llms.txt), and the [official hackathon resources](https://www.wemakedevs.org/hackathons/trueforge/resources).
