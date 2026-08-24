---
title: "Greenlight Product Requirements"
description: "Technical product requirements for an approval-gated, TrueForge-native YouTube production agent."
status: "Planning"
version: "1.0"
date: "2026-08-24"
---

# Greenlight Product Requirements

## Product summary

Greenlight is an evidence-first YouTube production crew with a human editor-in-chief.

You provide a channel, audience, creative goal, and seed topic or source. Greenlight studies the creator's approved channel signals, researches the topic, builds an evidence ledger, proposes competing hooks and packages, challenges its own claims, creates the narration and graphics, renders a 45–90 second video, checks the edit, and uploads it to the owner's YouTube channel as unlisted. It then stops at a TrueForge approval gate before making the exact release public or scheduling it.

The product is deliberately not “type a prompt, get AI video” and does not promise a view count. Its core value is controlled delegation: it optimizes the creative inputs a production team can control, completes the release workflow, and never takes ownership of the creator's public identity.

## Product thesis

Ambitious YouTubers can automate isolated parts of production, but they still move audience research, scripts, assets, voice tools, render tools, YouTube metadata, and publishing decisions between disconnected systems. Generic generation agents also fail in predictable ways: they optimize for empty clickbait, invent claims, lose source provenance, use unlicensed media, produce incoherent edits, upload duplicates, or publish before a person sees the result.

Greenlight makes the workflow one durable, inspectable agent session. Automation handles the reversible work; a person retains the final license to broadcast.

## Target user

The MVP serves one primary user:

> An ambitious YouTube creator who wants substantially more reach, publishes evidence-led short explainers, and owns the connected channel.

The user understands the audience and channel well enough to approve a creative direction and final cut but does not want to manually coordinate research, scripting, graphics, narration, editing, packaging, metadata, and uploading.

## Core job

Given a channel goal and topic, produce one evidence-led 45–90 second YouTube explainer with a defensible hook, complete edit, title and thumbnail package, and stage it on the owner's channel for one informed public-release decision.

## Product principles

1. **Evidence before eloquence.** Every factual claim must point to a source.
2. **Unlisted before public.** The agent may stage content autonomously but cannot broadcast autonomously.
3. **Exact approval.** The approval card must show the exact video, title, description, thumbnail, disclosure settings, channel, and content hash that will be published.
4. **A visible crew.** Research and verification work should fan out to subagents and remain visible in the session.
5. **A reproducible artifact.** The same versioned content package should produce the same timeline and metadata.
6. **Bring your own generation access.** The preferred local path uses the creator's existing ChatGPT/Codex subscription through a narrow Codex Bridge. API providers and procedural Remotion assets remain portable fallbacks.
7. **One finished workflow.** The MVP favors one excellent end-to-end release over a broad studio with partial features.
8. **Optimize inputs, never promise outcomes.** Greenlight can rank creative options using channel evidence and explicit heuristics; it cannot guarantee views, subscribers, or revenue.

## Why this can rank first

The official judging criteria are equally weighted. Greenlight is designed around all six rather than optimizing only for visual spectacle.

| Criterion | Greenlight evidence |
|---|---|
| Potential impact | Gives an ambitious creator a complete, reviewable production crew rather than another isolated generation tool |
| Creativity and originality | Treats public identity as a privileged production action, not video generation as a novelty |
| Technical excellence | Typed MCP boundary, versioned artifacts, idempotency, quality checks, OAuth isolation, and recovery tests |
| Sponsor-tool use | TrueForge runs the root agent, subagents, Code Mode, sandbox, approvals, Generative UI, session stream, and reconnect flow; Qodo reviews pull requests |
| Control and safety | Source coverage, media provenance, unlisted staging, exact publish approval, least-privilege OAuth, and audit history |
| Presentation | The three-minute demo ends with a real rendered video and a real approval-gated YouTube release |

## End-to-end experience

### 1. Create a production brief

You provide:

- Topic or thesis
- Target audience
- Channel goal and the creator's definition of success
- Desired duration from 45 to 90 seconds
- Format: 16:9 landscape for MVP
- Tone and call to action
- Approved URLs, documents, and optional media
- YouTube channel profile
- Required disclosure values, including made-for-kids and synthetic-media status

Greenlight confirms the channel identity before production begins.

When the creator connects read-only channel analytics, Greenlight may use the creator's own historical topic, title, thumbnail, and retention signals to form hypotheses. The workflow remains usable without analytics, and no score is presented as a prediction or guarantee.

### 2. Research in parallel

The root agent delegates bounded research questions to parallel subagents. Each subagent returns sources, candidate claims, publication dates, and uncertainty. The root agent merges the results into one evidence ledger.

The MVP uses no nested subagents. Subagents cannot ask you questions; unresolved choices return to the root agent.

### 3. Build and challenge the story

The root agent proposes:

- Three hooks
- One recommended narrative
- A timed script
- A scene-by-scene storyboard
- On-screen text and captions
- A title set, description, tags, and thumbnail concept

A verifier subagent checks whether each claim is supported and whether the hook overstates the evidence. Greenlight blocks rendering when a material claim lacks a source or when source conflicts remain unresolved.

### 4. Compile the production package

TrueForge Code Mode runs a deterministic compilation step in the sandbox. It converts the approved script, storyboard, and evidence ledger into a validated content package with scene timings, caption timings, asset references, and metadata.

The session displays the generated validation report and content hash. This is the visible sandbox moment in the demo.

### 5. Render and inspect

The Greenlight MCP service sends the content package to a constrained Remotion worker process. The worker produces:

- Preview MP4
- Poster frame
- Thumbnail PNG
- Captions file
- Render manifest with hashes and media metadata

Automated checks verify duration, resolution, codec, audio presence, peak/loudness bounds, caption overflow, missing assets, black frames, and content-package/hash consistency.

### 6. Upload as unlisted

After the render passes quality checks, Greenlight uploads the MP4 to the authenticated YouTube channel as unlisted. The upload includes:

- Title
- Description and source links
- Tags
- Category
- Made-for-kids setting
- Synthetic-media disclosure
- Custom thumbnail
- Subscriber-notification policy

Greenlight saves the returned YouTube video ID and polls the official processing status. It does not claim success until YouTube reports a usable processing state.

### 7. Request the license to broadcast

Greenlight presents an approval card containing:

- Channel name and ID
- Embedded unlisted preview link
- Final title, description, tags, and thumbnail
- Source-coverage and quality-check summaries
- Disclosure fields
- Public-now or scheduled release target
- Immutable release-snapshot hash

The `publish_video` or `schedule_video` MCP call pauses before execution. You may allow or deny it. A denial returns control to the root agent with your reason.

### 8. Publish and verify

After approval, the release tool revalidates that the unlisted video and release-snapshot hash have not changed. It changes privacy to public or applies the approved schedule, fetches the resulting YouTube state, and records the audit event.

## MVP capabilities

### Brief and project state

- Create one project from a structured brief
- Resume a project by ID in a later TrueForge turn
- Version scripts, storyboards, content packages, renders, and release metadata
- Show the current stage and blockers

### Research and evidence

- Accept approved URLs and user-provided source files
- Use web tools for public-source discovery
- Run parallel research subagents
- Store claim-to-source mappings and confidence
- Reject unsupported material claims
- Include source links in the YouTube description

### Script and storyboard

- Generate three hooks and select one with reasons
- Produce a 45–90 second narration script
- Produce timed scenes and captions
- Enforce readable on-screen text limits
- Generate title, description, tags, thumbnail brief, and call to action
- Preserve all revisions

### Rendering

- Render one 1920×1080, 30 fps composition
- Use deterministic, parameterized Remotion scenes
- Support text, shapes, screenshots, approved stills, simple charts, and optional narration
- Generate captions directly from the timed script
- Create a thumbnail and poster frame
- Return render progress and artifacts

### Visual and voice generation

- Detect an existing Codex ChatGPT login without reading or copying its tokens
- Offer **Codex subscription** as the preferred visual provider on a trusted machine
- Invoke Codex through its official App Server and local image-generation skill, not by scraping ChatGPT
- Save generated visuals into Greenlight's artifact store with prompt, provider, model/runtime version, hash, and provenance
- Support direct `gpt-image-2` and OpenRouter image models as optional API fallbacks
- Discover current OpenRouter image and speech models by output modality, then pin the selected model ID in each production package
- Generate narration through a pluggable TTS gateway; the initial audition set is Gemini 3.1 Flash TTS Preview, Grok Voice TTS 1.0, Fish Audio S2.1 Pro, and Microsoft MAI Voice 2 Flash
- Keep Remotion as the deterministic compositor for timing, captions, typography, transitions, and final MP4 output
- Fall back to procedural graphics and user-supplied narration when no media provider is connected

### YouTube OAuth and channel operations

- Use the existing local `youtube-uploader` OAuth profile store
- Verify the selected profile and channel before uploading
- Upload resumably as unlisted
- Set title, description, tags, category, audience, synthetic-media disclosure, and thumbnail
- Inspect video metadata and processing status
- Update metadata while the video remains unlisted
- Publish now or schedule only through TrueForge approval
- Support denial without losing the project session

### Human control

- Require approval for public or scheduled release
- Show exact arguments and release snapshot before approval
- Detect changes after approval and require a new approval
- Never reuse approval across a different video, metadata version, channel, or release time
- Preserve allow and deny events in session history

### Recovery and audit

- Reconnect to a running TrueForge turn using the last sequence number
- Resume after a browser refresh or dropped connection
- Make retries idempotent to prevent duplicate videos
- Persist project, render, upload, and release status
- Export a release report containing sources, checks, hashes, approvals, and final YouTube ID

## User interface

The MVP uses TrueForge's UI SDK and Generative UI instead of building a separate full editor.

### Production brief card

Shows required inputs, channel identity, duration, format, sources, and disclosure fields.

It also shows connection status for TrueForge, Codex subscription, narration provider, and YouTube. A provider badge must show whether work is subscription-backed, API-billed, or unavailable.

### Crew activity view

Shows root-agent and subagent threads separately, including research assignments and completion state.

### Evidence ledger

Lists each claim, supporting source, source date, confidence, and verifier result. Unsupported claims appear as blockers.

### Storyboard view

Shows scene number, time range, narration, visual, on-screen text, and source references. You can approve or request a revision through the root agent.

### Render and quality card

Shows render progress, output preview, duration, resolution, audio/caption checks, and artifact hashes.

### Release approval card

Shows the exact channel, unlisted video, metadata, thumbnail, disclosure values, publish timing, checks, and release hash with **Allow** and **Deny** actions.

### Release receipt

Shows final privacy/schedule state, YouTube URL, approval identity, timestamps, source coverage, and downloadable audit report.

## Agent roles

### Root producer

Owns the session, asks you questions, delegates work, merges results, chooses tools, handles revisions, and requests release approval. Only this agent communicates with you.

### Research subagents

Each answers one bounded question and returns structured candidate claims and sources. They never write project state directly.

### Claim verifier subagent

Attempts to disprove or weaken the proposed script. It flags unsupported claims, stale evidence, misleading hooks, missing disclosure, and source conflicts.

### Packaging step in Code Mode

This is deterministic sandbox execution, not another conversational persona. It validates schemas, computes timings, checks claim coverage, and emits the content package.

## Safety requirements

### Factual safety

- A material factual sentence must reference at least one evidence-ledger claim.
- Direct quotations require exact source text and attribution.
- Conflicting sources block the claim or force qualified wording.
- The verifier must run on the final script, not only the first draft.

### Media and copyright safety

- Every non-procedural asset records origin, license, creator, and allowed use.
- Greenlight rejects assets with unknown provenance.
- The demo uses owned, public-domain, permissively licensed, or generated media.
- Source links do not imply permission to reuse media from the source page.

### Account safety

- OAuth credentials remain in `~/.config/youtube-uploader/` with restrictive permissions.
- The model receives a profile alias and channel identity, never token content or credential paths.
- The uploader tool validates a configured channel allowlist.
- Public release requires a fresh, exact TrueForge approval.
- Delete-video capability is disabled for the hackathon agent.

### Command safety

- MCP tools accept typed IDs and validated metadata.
- The wrapper invokes the uploader with argument arrays, never a constructed shell string.
- The uploader resolves artifact paths server-side and rejects path traversal.
- Logs redact credentials and private source content.

## Non-functional requirements

| Area | Requirement |
|---|---|
| Reliability | A network retry must not create a second YouTube upload for the same idempotency key |
| Recovery | The client restores a running turn after reconnect and replays missed events |
| Performance | A standard 60-second template render should complete within five minutes on the demo Mac |
| Observability | Every tool call has a project ID, operation ID, duration, status, and redacted error cause |
| Security | Secrets never appear in model context, persisted project JSON, source control, screenshots, or normal logs |
| Reproducibility | A content-package version and renderer version identify the exact inputs for a render |
| Accessibility | Captions are always generated; essential meaning is not encoded by color alone |
| Portability | A judge can run the core workflow without the owner's private image-generation tooling |
| Explainability | Every blocked release names the failed requirement and the evidence needed to clear it |

## Success metrics

### Product metrics

- One prompt-to-unlisted workflow completes without manual file transfer.
- Every factual claim in the demo script has source coverage.
- The render passes all required automated checks.
- YouTube metadata and thumbnail match the approved release snapshot.
- Public release cannot occur without a recorded TrueForge approval.

### Hackathon metrics

- The demo visibly shows an MCP tool call, sandbox execution, parallel subagents, an approval pause, and session recovery.
- A judge can set up the repository from the README and complete the demo path.
- Qodo reviews appear on multiple substantive pull requests and findings are resolved or answered.
- The three-minute video clearly identifies which work TrueForge performs.

## Acceptance criteria

Greenlight MVP is complete when all conditions below pass:

1. A user creates a project with a topic, audience, sources, and YouTube profile.
2. Two or more subagents research separate questions in parallel.
3. The evidence ledger maps every material final-script claim to a source.
4. Code Mode validates and compiles the final content package in the TrueForge sandbox.
5. Remotion renders a playable 1920×1080 MP4 and thumbnail.
6. Automated quality checks pass or show a precise blocker.
7. The uploader verifies the allowed YouTube channel and creates one unlisted video with the final metadata.
8. The agent shows the unlisted result and exact release snapshot.
9. TrueForge emits `tool.approval_required` before `publish_video` or `schedule_video` executes.
10. Denying approval leaves the video unlisted and returns a useful next step.
11. Allowing approval publishes or schedules only the approved snapshot.
12. Repeating any upload or release request with the same idempotency key does not duplicate the action.
13. A dropped client reconnects to the turn and receives missed events.
14. The release receipt contains the final YouTube ID, sources, checks, hashes, and approval event.
15. No secret appears in the repository, agent transcript, release report, or demo recording.

## Non-goals for the hackathon

- Long-form video editing
- Photorealistic text-to-video generation
- Autonomous daily topic farming
- View, revenue, or recommendation optimization
- Comment moderation or replies
- Cross-posting to TikTok, Instagram, or LinkedIn
- Multiple editors or role-based review chains
- Automatic use of copyrighted clips
- Automatic deletion of YouTube content
- A full nonlinear timeline editor
- Mobile approval outside the TrueForge UI unless the core slice is already complete

## Three-minute demo story

### 0:00–0:20 — The job

Show the brief: “Explain why an agent harness is different from a chatbot in 60 seconds,” with official sources and the connected test channel.

### 0:20–0:50 — The crew

Show research and verifier subagent threads running in parallel. Surface the evidence ledger and one rejected unsupported hook.

### 0:50–1:20 — The sandbox

Show Code Mode compiling the final timed content package and checking source coverage. Display the content hash.

### 1:20–1:50 — The artifact

Show the Remotion render progress, automated quality report, finished video, and thumbnail.

### 1:50–2:15 — The real tool

Upload to the owner's YouTube channel as unlisted. Show the returned video ID and processing status.

### 2:15–2:45 — The license to broadcast

Ask the agent to publish. Show TrueForge pause on `tool.approval_required`, inspect the exact release card, and approve it. Show the resulting public or scheduled state.

### 2:45–3:00 — The harness

Refresh or briefly disconnect the UI, restore the session stream, and show the persisted release receipt. Close with the finished video playing.

## Dependencies and disclosures

- TrueForge is the required agent harness.
- Qodo reviews the repository pull requests.
- Remotion renders the video from a parameterized React composition.
- The existing open-source `youtube-uploader` CLI handles Google OAuth and the official YouTube Data API. Greenlight's MCP wrapper and approval policy are hackathon work.
- The preferred local visual path uses the owner's existing ChatGPT/Codex subscription through the official Codex App Server. Greenlight never receives the raw ChatGPT token.
- API-backed image and narration providers are optional fallbacks and require user-owned credentials. The UI labels subscription-backed and usage-billed providers accurately.
- A public showcase deployment may replay a completed project, but the submitted demo must show the real local TrueForge, Codex, render, and YouTube integrations.
- AI coding assistance must be disclosed in the submission.
