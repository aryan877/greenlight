import type { Scene } from "@greenlight/contracts";
import { Clock3, Gauge, MessageSquareText, WandSparkles } from "lucide-react";

import { formatTime } from "../editor/model.js";

export const InspectorPanel = ({
  scene,
  onEdit,
}: {
  scene: Scene | null;
  onEdit: (instruction: string) => void;
}) => (
  <div className="scroll-stable h-full overflow-y-auto px-4 py-4">
    {scene ? (
      <div>
        <h3 className="text-[13px] font-medium leading-5 text-ink">
          {scene.title}
        </h3>

        <div className="mt-4 flex gap-4 border-y border-line-subtle py-3 text-[9px] text-ink-tertiary">
          <span className="flex items-center gap-1.5">
            <Clock3 size={11} /> {formatTime(scene.duration_seconds)}
          </span>
          <span className="flex items-center gap-1.5">
            <Gauge size={11} /> {scene.playback_rate.toFixed(2)}×
          </span>
        </div>

        <section className="mt-5">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-ink">
            <MessageSquareText size={12} className="text-ink-tertiary" />
            Script
          </div>
          <p className="mt-2 text-[11px] leading-5 text-ink-secondary">
            {scene.narration}
          </p>
        </section>

        <button
          type="button"
          onClick={() =>
            onEdit(
              `Revise the attached scene “${scene.title}”. Keep the rest of the cut unchanged and show me the proposed version before applying it.`,
            )
          }
          className="mt-5 flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[10px] font-medium text-ink-secondary hover:border-line-strong hover:bg-hover hover:text-ink"
        >
          <WandSparkles size={12} /> Revise with Producer
        </button>
      </div>
    ) : (
      <p className="text-[10px] text-ink-tertiary">
        Select a scene to inspect it.
      </p>
    )}
  </div>
);
