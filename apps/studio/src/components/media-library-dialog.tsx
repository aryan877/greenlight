import type { Artifact, MediaLibraryResult } from "@greenlight/contracts";
import { Film, Library, Music2, Search, Volume2, X } from "lucide-react";
import { useState } from "react";

import {
  useImportMediaLibraryAsset,
  useMediaLibraryCapabilities,
  useMediaLibrarySearch,
} from "../hooks/use-greenlight-queries.js";
import { cx } from "./controls.js";

type LibraryUse = "broll" | "music" | "sound_effect";

export type PlacedLibraryAsset = {
  artifact: Artifact;
  licenseArtifact: Artifact;
  result: MediaLibraryResult;
};

const useOptions: Array<{
  Icon: typeof Film;
  id: LibraryUse;
  label: string;
}> = [
  { id: "broll", label: "B-roll", Icon: Film },
  { id: "music", label: "Music", Icon: Music2 },
  { id: "sound_effect", label: "Sound", Icon: Volume2 },
];

const seconds = (value: number | null) =>
  value === null ? null : `${value.toFixed(value >= 10 ? 0 : 1)}s`;

export const MediaLibraryDialog = ({
  open,
  projectId,
  onClose,
  onPlace,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onPlace: (input: PlacedLibraryAsset) => Promise<void> | void;
}) => {
  const [use, setUse] = useState<LibraryUse>("broll");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [placingId, setPlacingId] = useState<string | null>(null);
  const capabilities = useMediaLibraryCapabilities();
  const search = useMediaLibrarySearch(query, use, open);
  const importAsset = useImportMediaLibraryAsset(projectId);
  if (!open) return null;

  const unavailable =
    use === "broll" && capabilities.data?.pexels.available === false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Media library"
      className="fixed inset-0 z-[120] grid place-items-center bg-ink/35 p-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-float">
        <header className="flex shrink-0 items-center gap-3 border-b border-line-subtle px-4 py-3">
          <span className="grid size-9 place-items-center rounded-full bg-action-soft text-action">
            <Library size={16} />
          </span>
          <div>
            <h2 className="text-[15px] font-medium text-ink">Media library</h2>
            <p className="text-[10px] text-ink-tertiary">
              Search licensed sources, then place an immutable copy.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close media library"
            onClick={onClose}
            className="ml-auto grid size-8 place-items-center rounded-full text-ink-tertiary hover:bg-hover hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle px-4 py-3">
          <div className="flex rounded-full bg-surface-sunken p-1">
            {useOptions.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setUse(id);
                  setQuery("");
                }}
                className={cx(
                  "flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] text-ink-tertiary",
                  use === id && "bg-surface-raised text-ink shadow-monitor",
                )}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          <form
            className="flex min-w-[260px] flex-1 items-center rounded-full border border-line bg-surface px-3 focus-within:border-action"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(draft.trim());
            }}
          >
            <Search size={14} className="text-ink-caption" />
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                use === "broll"
                  ? "Search people, places, objects, or actions"
                  : use === "music"
                    ? "Search mood, genre, or instrument"
                    : "Search impact, whoosh, click, ambience"
              }
              className="h-10 min-w-0 flex-1 bg-transparent px-2 text-[12px] text-ink outline-none placeholder:text-ink-caption"
            />
            <button
              type="submit"
              disabled={draft.trim().length < 2}
              className="rounded-full bg-control px-3 py-1.5 text-[10px] font-medium text-control-ink disabled:opacity-35"
            >
              Search
            </button>
          </form>
        </div>

        <div className="scroll-stable min-h-0 flex-1 overflow-y-auto p-4">
          {unavailable ? (
            <div className="grid min-h-52 place-items-center text-center">
              <div>
                <Film className="mx-auto text-ink-caption" size={24} />
                <p className="mt-3 text-[12px] font-medium text-ink">
                  B-roll search needs a Pexels key
                </p>
                <p className="mt-1 text-[10px] text-ink-tertiary">
                  Add PEXELS_API_KEY to the server environment. The key never
                  enters the browser or agent.
                </p>
              </div>
            </div>
          ) : search.isFetching ? (
            <div className="grid min-h-52 place-items-center text-[11px] text-ink-tertiary">
              Searching licensed media…
            </div>
          ) : search.isError ? (
            <div className="grid min-h-52 place-items-center text-center text-[11px] text-error">
              Search failed. Check the provider connection and retry.
            </div>
          ) : query.length < 2 ? (
            <div className="grid min-h-52 place-items-center text-center">
              <div>
                <Search className="mx-auto text-ink-caption" size={24} />
                <p className="mt-3 text-[12px] font-medium text-ink">
                  Describe the shot or sound you need
                </p>
                <p className="mt-1 text-[10px] text-ink-tertiary">
                  Results keep their source, creator, and license receipt.
                </p>
              </div>
            </div>
          ) : search.data?.length ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {search.data.map((result) => {
                const busy = placingId === result.provider_asset_id;
                return (
                  <article
                    key={`${result.provider}:${result.provider_asset_id}:${result.use}`}
                    className="overflow-hidden rounded-xl border border-line bg-surface-raised"
                  >
                    <div className="grid aspect-video place-items-center overflow-hidden bg-canvas">
                      {result.kind === "video" ? (
                        <img
                          src={result.preview_url}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <audio
                          src={result.preview_url}
                          controls
                          preload="none"
                          className="w-[88%]"
                        />
                      )}
                    </div>
                    <div className="p-3">
                      <div className="flex items-start gap-2">
                        <h3 className="min-w-0 flex-1 text-[11px] font-medium leading-4 text-ink">
                          {result.title}
                        </h3>
                        {seconds(result.duration_seconds) ? (
                          <span className="font-mono text-[8px] text-ink-caption">
                            {seconds(result.duration_seconds)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-ink-tertiary">
                        {[result.creator, result.license]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <a
                        href={result.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-[9px] text-action underline-offset-2 hover:underline"
                      >
                        {result.provider === "pexels"
                          ? "View on Pexels"
                          : "View licensed source"}
                      </a>
                      <button
                        type="button"
                        disabled={busy || importAsset.isPending}
                        onClick={() => {
                          setPlacingId(result.provider_asset_id);
                          void importAsset
                            .mutateAsync(result)
                            .then((imported) =>
                              onPlace({
                                artifact: imported.artifact,
                                licenseArtifact: imported.licenseArtifact,
                                result,
                              }),
                            )
                            .then(() => onClose())
                            .finally(() => setPlacingId(null));
                        }}
                        className="mt-3 h-8 w-full rounded-full bg-control text-[10px] font-medium text-control-ink disabled:opacity-40"
                      >
                        {busy ? "Importing…" : "Place on timeline"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="grid min-h-52 place-items-center text-[11px] text-ink-tertiary">
              No compatible results found.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
