import { describe, expect, it } from "vitest";

import type { PendingToolApproval } from "../hooks/use-producer-agent.js";
import {
  approvalCopy,
  groupExecutionEvents,
  groupProducerEvents,
} from "./producer-panel.js";

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

  it("describes a combined picture, narration, and caption patch as one cut", () => {
    expect(
      approvalCopy(
        pending("apply_editor_patch", {
          instruction_summary: "Build the cut",
          selection: {
            project_id: "project_demo",
            base_content_package_artifact_id: "artifact_content",
            scene_ids: ["scene_hook"],
            track_ids: ["visual", "voice", "caption", "track_visuals"],
            item_ids: [],
            gap_ids: [],
            artifact_ids: ["artifact_video", "artifact_voice"],
            time_range_seconds: null,
            playhead_seconds: 0,
          },
          operations: [
            {
              type: "update_scene",
              scene_id: "scene_hook",
              narration_artifact_id: "artifact_voice",
              captions_artifact_id: "artifact_captions",
              visual: { artifact_ids: ["artifact_video"] },
            },
            {
              type: "upsert_video_track",
              track: {
                id: "track_visuals",
                name: "Visuals",
                kind: "video",
                protected: true,
                visible: true,
                clips: [
                  {
                    id: "clip_hook",
                    scene_id: "scene_hook",
                    label: "Hook",
                    artifact_id: "artifact_video",
                    timeline_start_seconds: 0,
                    source_in_seconds: 0,
                    source_out_seconds: 5,
                    source_duration_seconds: 10,
                    duration_seconds: 5,
                    playback_rate: 1,
                    fit: "cover",
                    opacity: 1,
                    provenance_artifact_id: null,
                  },
                ],
              },
            },
            {
              type: "upsert_audio_track",
              track: {
                id: "track_narration",
                name: "Narration",
                role: "narration",
                locale: "en",
                muted: false,
                solo: false,
                export_enabled: true,
                gain: 1,
                clips: [],
              },
            },
          ],
        }),
        null,
      ),
    ).toMatchObject({
      title: "Build the complete 1-scene cut",
      action: "Build cut",
    });
  });

  it("counts transitions and explains the cut-level change", () => {
    expect(
      approvalCopy(
        pending("apply_editor_patch", {
          instruction_summary: "Add subtle transitions at the cuts",
          selection: {
            project_id: "project_demo",
            base_content_package_artifact_id: "artifact_content",
            scene_ids: [],
            track_ids: [],
            item_ids: [],
            gap_ids: [],
            artifact_ids: [],
            time_range_seconds: null,
            playhead_seconds: 0,
          },
          operations: [
            {
              type: "upsert_transition_track",
              track: {
                id: "track_transitions",
                name: "Transitions",
                kind: "transition",
                protected: false,
                visible: true,
                clips: [
                  {
                    id: "clip_transition_one",
                    label: "Crossfade",
                    from_item_id: "video_scene_one",
                    to_item_id: "video_scene_two",
                    cut_seconds: 5,
                    duration_seconds: 0.4,
                    preset_id: "crossfade",
                    parameters: {},
                    sound_artifact_id: null,
                  },
                  {
                    id: "clip_transition_two",
                    label: "Crossfade",
                    from_item_id: "video_scene_two",
                    to_item_id: "video_scene_three",
                    cut_seconds: 10,
                    duration_seconds: 0.4,
                    preset_id: "crossfade",
                    parameters: {},
                    sound_artifact_id: null,
                  },
                ],
              },
            },
          ],
        }),
        null,
      ),
    ).toEqual({
      title: "Add 2 subtle transitions",
      detail:
        "Place them on the 2 real cuts. Scene timing, narration, captions, and release stay unchanged.",
      action: "Add transitions",
    });
  });

  it("summarizes a combined polish patch as one creator decision", () => {
    expect(
      approvalCopy(
        pending("apply_editor_patch", {
          instruction_summary: "Polish the locked cut",
          selection: {
            project_id: "project_demo",
            base_content_package_artifact_id: "artifact_content",
            scene_ids: [],
            track_ids: [
              "transition",
              "music",
              "release",
              "track_transitions",
              "track_music",
            ],
            item_ids: [],
            gap_ids: [],
            artifact_ids: [
              "artifact_music",
              "artifact_thumb_a",
              "artifact_thumb_b",
              "artifact_thumb_c",
            ],
            time_range_seconds: null,
            playhead_seconds: 0,
          },
          operations: [
            {
              type: "upsert_transition_track",
              track: {
                id: "track_transitions",
                name: "Transitions",
                kind: "transition",
                protected: false,
                visible: true,
                clips: [
                  {
                    id: "clip_transition_one",
                    label: "Crossfade",
                    from_item_id: "video_scene_one",
                    to_item_id: "video_scene_two",
                    cut_seconds: 5,
                    duration_seconds: 0.4,
                    preset_id: "crossfade",
                    parameters: {},
                    sound_artifact_id: null,
                  },
                ],
              },
            },
            {
              type: "upsert_audio_track",
              track: {
                id: "track_music",
                name: "Music",
                role: "music",
                locale: null,
                voice_label: null,
                muted: false,
                solo: false,
                export_enabled: true,
                gain: 0.4,
                ducking: { enabled: true, reduction_db: -12 },
                clips: [],
              },
            },
            {
              type: "update_release",
              release: {
                thumbnail_artifact_id: null,
                thumbnail_candidate_artifact_ids: [
                  "artifact_thumb_a",
                  "artifact_thumb_b",
                  "artifact_thumb_c",
                ],
                destination: "unlisted",
                publish_at: null,
              },
            },
          ],
        }),
        null,
      ),
    ).toEqual({
      title: "Polish the locked cut",
      detail:
        "Add 1 transition, a quiet ducked music bed, 3 thumbnail candidates. Scene timing, narration, and captions stay unchanged.",
      action: "Apply polish",
    });
  });
});

describe("Producer conversation grouping", () => {
  it("keeps one turn's tools and approval in one execution block", () => {
    const blocks = groupProducerEvents([
      {
        id: "creator",
        turnId: "turn_one",
        kind: "instruction",
        label: "Add quiet music.",
        detail: "",
        sceneIds: [],
      },
      {
        id: "search",
        turnId: "turn_one",
        kind: "tool",
        label: "Searched licensed music",
        detail: "Openverse MCP",
        sceneIds: [],
      },
      {
        id: "approval",
        turnId: "turn_one",
        kind: "approval",
        label: "Review before continuing",
        detail: "",
        sceneIds: [],
      },
      {
        id: "reply",
        turnId: "turn_one",
        kind: "message",
        label: "Music is ready for review.",
        detail: "",
        sceneIds: [],
      },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({
      kind: "turn",
      turnId: "turn_one",
      events: [{ id: "search" }, { id: "approval" }, { id: "reply" }],
    });
  });

  it("counts repeated tool work without hiding how many calls ran", () => {
    const events = ["one", "two", "three"].map((id) => ({
      id,
      turnId: "turn_one",
      kind: "tool" as const,
      label: "Ran bounded analysis",
      detail: "TrueForge",
      sceneIds: [],
      status: "done" as const,
      tool: { callId: id, name: "exec", server: null },
    }));

    expect(groupExecutionEvents(events)).toMatchObject([
      { event: { label: "Ran bounded analysis" }, count: 3 },
    ]);
  });

  it("keeps unresolved failures and hides a failed attempt after its retry succeeds", () => {
    const failed = {
      id: "failed",
      turnId: "turn_one",
      kind: "tool" as const,
      label: "Editor change was rejected",
      detail: "This action did not complete.",
      sceneIds: [],
      status: "error" as const,
      tool: {
        callId: "failed",
        name: "apply_editor_patch",
        server: "greenlight",
      },
    };
    const succeeded = {
      ...failed,
      id: "succeeded",
      label: "Applied the editor change",
      detail: "Greenlight MCP",
      status: "done" as const,
      tool: { ...failed.tool, callId: "succeeded" },
    };

    expect(groupExecutionEvents([failed])).toHaveLength(1);
    expect(groupExecutionEvents([failed, succeeded])).toMatchObject([
      { event: { id: "succeeded" }, count: 1 },
    ]);
  });
});
