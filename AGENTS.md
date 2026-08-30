# Greenlight contributor instructions

Greenlight is a TrueForge-native video production studio. Preserve the product promise: creators can edit directly, ask the Producer for help, inspect its work, and keep final control over release.

## Non-negotiable safety

- Keep TrueForge visible as the agent runtime.
- Stage YouTube uploads for review before any public release.
- Require explicit approval for public or scheduled release.
- Never expose credentials, tokens, host paths, private media, or deployment configuration.
- Use only media the owner may legally use and retain source attribution.
- Keep claim-to-source coverage intact for factual videos.
- Never add channel-wide mutation or destructive video-management tools.

## Engineering rules

- Keep one typed edit contract for direct timeline gestures and Producer proposals.
- Preserve stable IDs, immutable revisions, local undo/redo, and frame-accurate boundaries.
- Validate external input at the trusted service boundary.
- Keep direct editing immediate; only Producer-requested work enters the agent loop.
- Make approvals understandable, cancellable, durable across refresh, and scoped to the exact proposed change.
- Keep creator-facing UI free of internal IDs, paths, payloads, protocol noise, and raw tool output.
- Do not add silent provider fallbacks. Fail clearly when the configured capability is unavailable.
- Remove superseded code and tests in the same change. Preserve unrelated work.

## Quality gate

Run `pnpm verify` before pushing. It must pass formatting, lint, type checking, tests, and every workspace build.

Keep operational runbooks, credentials, infrastructure details, live acceptance notes, and private research outside the repository.
