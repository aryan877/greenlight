import type { EvidenceLedger, Scene } from "@greenlight/contracts";
import { Check, ExternalLink } from "lucide-react";

import { formatTime } from "../editor/model.js";

export const InspectorPanel = ({
  scene,
  sourceLedger,
}: {
  scene: Scene | null;
  sourceLedger: EvidenceLedger | null;
}) => (
  <div className="scroll-stable h-full overflow-y-auto p-3">
    {scene ? (
      <div className="space-y-4">
        <div>
          <h3 className="text-[13px] font-medium">{scene.title}</h3>
        </div>
        <dl className="divide-y divide-line-subtle border-y border-line-subtle text-[10px]">
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-tertiary">Duration</dt>
            <dd className="font-mono">{formatTime(scene.duration_seconds)}</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-tertiary">Speed</dt>
            <dd className="font-mono">{scene.playback_rate.toFixed(2)}×</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-tertiary">Treatment</dt>
            <dd>{scene.visual.treatment}</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-tertiary">Visual assets</dt>
            <dd>{scene.visual.artifact_ids.length}</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-tertiary">Voice</dt>
            <dd>{scene.narration_artifact_id ? "ready" : "draft"}</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-tertiary">Captions</dt>
            <dd>{scene.captions_artifact_id ? "ready" : "draft"}</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-tertiary">Transcript</dt>
            <dd>{scene.transcript_artifact_id ? "timed" : "needed"}</dd>
          </div>
        </dl>
        <div>
          <h4 className="text-[10px] font-medium">Narration</h4>
          <p className="mt-2 text-[10px] leading-5 text-ink-secondary">
            {scene.narration}
          </p>
        </div>
        {scene.claim_ids.length > 0 ? (
          <div>
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-medium">Sources used here</h4>
              <span className="text-[9px] text-ink-caption">
                {scene.claim_ids.length} checked
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {scene.claim_ids.map((claimId) => {
                const claim = sourceLedger?.claims.find(
                  (candidate) => candidate.id === claimId,
                );
                const sources =
                  claim?.source_ids.flatMap((sourceId) => {
                    const source = sourceLedger?.sources.find(
                      (candidate) => candidate.id === sourceId,
                    );
                    return source ? [source] : [];
                  }) ?? [];
                return (
                  <div
                    key={claimId}
                    className="rounded-lg border border-line-subtle bg-surface-sunken p-2.5"
                  >
                    <div className="flex gap-2">
                      <Check
                        size={12}
                        className="mt-0.5 shrink-0 text-action"
                      />
                      <p className="text-[10px] leading-4 text-ink-secondary">
                        {claim?.text ?? claimId}
                      </p>
                    </div>
                    {sources.map((source) => (
                      <a
                        key={source.id}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 flex items-center gap-1.5 text-[9px] text-ink-tertiary no-underline hover:text-ink"
                      >
                        <ExternalLink size={10} />
                        <span className="truncate">{source.title}</span>
                      </a>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    ) : (
      <p className="text-[11px] text-ink-tertiary">No scene selected.</p>
    )}
  </div>
);
