import { describe, expect, it } from "vitest";

import type { PendingToolApproval } from "../hooks/use-producer-agent.js";
import { approvalCopy } from "./producer-panel.js";

const pending = (
  toolName: string,
  argumentsValue: Record<string, unknown>,
): PendingToolApproval => ({
  eventId: "event_approval",
  turnId: "turn_approval",
  threadId: "thread_root",
  toolCallId: "call_approval",
  toolName,
  arguments: argumentsValue,
});

describe("Producer approval language", () => {
  it("names Pexels imports without exposing implementation details", () => {
    expect(
      approvalCopy(
        pending("import_media_library_asset", {
          provider: "pexels",
          use: "broll",
        }),
        null,
      ),
    ).toMatchObject({
      title: "Import licensed Pexels B-roll",
      action: "Import B-roll",
    });
  });

  it("explains voice generation before the timeline edit", () => {
    expect(
      approvalCopy(
        pending("generate_voice", {
          scene_id: "scene_hook",
          locale: "hi-IN",
        }),
        null,
      ),
    ).toMatchObject({
      title: "Generate voice",
      action: "Generate voice",
    });
  });

  it("describes a music patch as background music", () => {
    expect(
      approvalCopy(
        pending("apply_editor_patch", {
          instruction_summary: "Add a quiet licensed music bed",
          selection: {
            project_id: "project_demo",
            base_content_package_artifact_id: "artifact_content",
            scene_ids: [],
            track_ids: [],
            item_ids: [],
            gap_ids: [],
            artifact_ids: ["artifact_music"],
            time_range_seconds: null,
            playhead_seconds: 0,
          },
          operations: [
            {
              type: "upsert_audio_track",
              track: {
                id: "track_music",
                name: "Documentary pulse",
                role: "music",
                locale: null,
                muted: false,
                solo: false,
                gain: 0.22,
                ducking: { enabled: true, reduction_db: -18 },
                clips: [
                  {
                    id: "clip_music",
                    scene_id: "scene_hook",
                    label: "Documentary pulse",
                    artifact_id: "artifact_music",
                    timeline_start_seconds: 0,
                    source_in_seconds: 0,
                    duration_seconds: 8,
                    transcript_artifact_id: null,
                    captions_artifact_id: null,
                  },
                ],
              },
            },
          ],
        }),
        null,
      ),
    ).toMatchObject({
      title: "Add background music",
      action: "Add music",
    });
  });
});
