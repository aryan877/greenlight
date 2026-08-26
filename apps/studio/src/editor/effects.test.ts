import { type ContentPackage } from "@greenlight/contracts";
import { describe, expect, it } from "vitest";

import { buildTransitionTrackEdit } from "./effects.js";
import { timelineItems, videoItemId } from "./model.js";

const content: ContentPackage = {
  version: 1,
  project_id: "project_effects",
  headline: "A precise transition test",
  dek: "Transitions target one exact persisted cut.",
  scenes: ["one", "two", "three"].map((id, index) => ({
    id: `scene_${id}`,
    kind: index === 0 ? ("hook" as const) : ("explanation" as const),
    title: `Scene ${id}`,
    narration: `Narration ${id}`,
    narration_artifact_id: null,
    captions_artifact_id: null,
    transcript_artifact_id: null,
    claim_ids: [],
    duration_seconds: 10,
    playback_rate: 1,
    visual: {
      treatment: "openmoji" as const,
      prompt: null,
      artifact_ids: [],
      accent: "signal" as const,
    },
  })),
  localized_narration_tracks: [],
  metadata: {
    title: "A precise transition test",
    description: "Transition test fixture.",
    tags: ["editing"],
    category_id: "28",
    made_for_kids: false,
    contains_synthetic_media: true,
  },
  release: {
    thumbnail_artifact_id: null,
    destination: "unlisted",
    publish_at: null,
  },
};

describe("transition edits", () => {
  it("targets the cut nearest the requested timeline time", () => {
    const edit = buildTransitionTrackEdit({
      content,
      items: timelineItems(content),
      targetSeconds: 18,
      preset: "push",
      createClipId: () => "clip_nearest_cut",
    });

    expect(edit?.clip).toMatchObject({
      id: "clip_nearest_cut",
      from_item_id: videoItemId("scene_two"),
      to_item_id: videoItemId("scene_three"),
      cut_seconds: 20,
      preset_id: "push",
    });
  });

  it("never treats an empty gap as a transition cut", () => {
    const withGap = structuredClone(content);
    withGap.scenes[0]!.gap_after_seconds = 3.6;

    const edit = buildTransitionTrackEdit({
      content: withGap,
      items: timelineItems(withGap),
      targetSeconds: 10,
      preset: "crossfade",
      createClipId: () => "clip_after_gap",
    });

    expect(edit?.clip).toMatchObject({
      id: "clip_after_gap",
      from_item_id: videoItemId("scene_two"),
      to_item_id: videoItemId("scene_three"),
      cut_seconds: 23.6,
    });
  });

  it("returns the exact new clip even when the same preset exists elsewhere", () => {
    const withOlderCrossfade = structuredClone(content);
    withOlderCrossfade.transition_tracks = [
      {
        id: "track_transitions",
        name: "Transitions",
        kind: "transition",
        protected: false,
        visible: true,
        clips: [
          {
            id: "clip_older_crossfade",
            label: "Crossfade",
            from_item_id: videoItemId("scene_one"),
            to_item_id: videoItemId("scene_two"),
            cut_seconds: 10,
            duration_seconds: 0.4,
            preset_id: "crossfade",
            parameters: {},
            sound_artifact_id: null,
          },
        ],
      },
    ];

    const edit = buildTransitionTrackEdit({
      content: withOlderCrossfade,
      items: timelineItems(withOlderCrossfade),
      targetSeconds: 20,
      preset: "crossfade",
      createClipId: () => "clip_exact_new_crossfade",
    });

    expect(edit?.clip.id).toBe("clip_exact_new_crossfade");
    expect(edit?.operation.track.clips.map((clip) => clip.id)).toEqual([
      "clip_older_crossfade",
      "clip_exact_new_crossfade",
    ]);
  });

  it("updates an existing cut without changing its stable identity", () => {
    const initial = buildTransitionTrackEdit({
      content,
      items: timelineItems(content),
      targetSeconds: 10,
      preset: "crossfade",
      createClipId: () => "clip_stable_cut",
    });
    const withInitial = {
      ...content,
      transition_tracks: initial ? [initial.operation.track] : [],
    } satisfies ContentPackage;

    const revised = buildTransitionTrackEdit({
      content: withInitial,
      items: timelineItems(withInitial),
      targetSeconds: 10,
      preset: "dip_to_black",
      createClipId: () => "clip_should_not_be_used",
    });

    expect(revised?.clip).toMatchObject({
      id: "clip_stable_cut",
      preset_id: "dip_to_black",
      cut_seconds: 10,
    });
    expect(revised?.operation.track.clips).toHaveLength(1);
  });
});
