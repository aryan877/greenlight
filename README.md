# Greenlight

Greenlight is an evidence-first, approval-gated YouTube production agent built for the 2026 TrueForge Agent Harness Hackathon.

It turns a creator goal and sourced topic into a narrated, edited, packaged video; uploads the result to YouTube as unlisted; and pauses before making the exact release public. TrueForge owns the agent loop, sandbox work, subagents, approvals, and durable session history.

This folder currently contains planning artifacts only. Implementation starts after the hackathon opens on **August 24, 2026 at 07:00 UTC / 12:30 PM IST**.

## Read first

- [Product requirements](PRD.md)
- [Agent instructions and reference map](AGENTS.md)

## Product boundary

The minimum viable product completes one job:

> Given a topic and approved sources, produce one factual 45–90 second YouTube explainer, upload it as unlisted with complete metadata and a thumbnail, then require explicit human approval before public release.

The creator may want millions of views. Greenlight optimizes the controllable inputs—research, hook, retention structure, edit, packaging, and release—but never guarantees views or revenue.

Greenlight is not a general-purpose video editor, a long-form movie generator, or an engagement-farming bot.
