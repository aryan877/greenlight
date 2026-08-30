import { Check, ChevronDown, Clock3, FolderOpen, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ProjectSummary } from "../api/greenlight.js";
import { cx } from "./controls.js";

const updatedLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));

export const ProjectSwitcher = ({
  projects,
  activeId,
  creating,
  onSelect,
  onCreate,
}: {
  projects: ProjectSummary[];
  activeId: string | null;
  creating: boolean;
  onSelect: (projectId: string) => void;
  onCreate: (topic: string) => Promise<void>;
}) => {
  const active = projects.find((project) => project.id === activeId) ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  return (
    <>
      <div ref={menuRef} className="relative ml-4 min-w-0">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex h-8 max-w-[430px] items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
        >
          <span className="min-w-0 truncate text-[12px] font-medium text-ink">
            {active?.brief.topic ?? "Choose a project"}
          </span>
          <ChevronDown
            size={13}
            className={cx(
              "shrink-0 text-ink-caption transition-transform duration-150",
              menuOpen && "rotate-180",
            )}
          />
        </button>

        {menuOpen ? (
          <div
            role="menu"
            className="absolute left-0 top-10 z-40 w-[520px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-float"
          >
            <div className="flex items-center border-b border-line-subtle p-2">
              <span className="px-2 text-[10px] font-medium text-ink-tertiary">
                Project history
              </span>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setCreateOpen(true);
                  setError(null);
                }}
                className="ml-auto flex h-8 items-center gap-1.5 rounded-md bg-control px-3 text-[11px] font-medium text-control-ink hover:bg-control-hover"
              >
                <Plus size={13} /> New project
              </button>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-1.5">
              {projects.map((project) => {
                const selected = project.id === activeId;
                return (
                  <button
                    role="menuitem"
                    type="button"
                    key={project.id}
                    onClick={() => {
                      onSelect(project.id);
                      setMenuOpen(false);
                    }}
                    className={cx(
                      "group flex w-full gap-2.5 rounded-md px-2.5 py-2.5 text-left hover:bg-hover",
                      selected && "bg-action-soft/60",
                    )}
                  >
                    <span
                      className={cx(
                        "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-surface-sunken text-ink-tertiary",
                        selected && "bg-surface text-action",
                      )}
                    >
                      {selected ? (
                        <Check size={13} />
                      ) : (
                        <FolderOpen size={13} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                          {project.brief.topic}
                        </span>
                        <span className="shrink-0 text-[9px] capitalize text-ink-caption">
                          {project.stage.replaceAll("_", " ")}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-[9px] text-ink-tertiary">
                        <Clock3 size={10} /> {updatedLabel(project.updated_at)}{" "}
                        · {project.artifact_count} files
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {createOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create a new project"
          className="fixed inset-0 z-50 grid place-items-center bg-ink/25 p-5 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creating) {
              setCreateOpen(false);
            }
          }}
        >
          <form
            className="w-full max-w-md overflow-hidden rounded-xl border border-line bg-surface shadow-float"
            onSubmit={(event) => {
              event.preventDefault();
              const value = topic.trim();
              if (value.length < 8 || creating) return;
              setError(null);
              void onCreate(value)
                .then(() => {
                  setTopic("");
                  setCreateOpen(false);
                })
                .catch((reason: unknown) => {
                  setError(
                    reason instanceof Error
                      ? reason.message.replaceAll("_", " ")
                      : "Could not create the project",
                  );
                });
            }}
          >
            <div className="flex items-center border-b border-line-subtle px-4 py-3">
              <div>
                <h2 className="text-[17px] font-medium tracking-[-0.02em] text-ink">
                  Start a new project
                </h2>
                <p className="mt-1 text-[11px] text-ink-tertiary">
                  Your current project is already saved.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
                className="ml-auto grid size-8 place-items-center rounded-md text-ink-tertiary hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                <X size={15} />
              </button>
            </div>
            <div className="p-4">
              <label className="block text-[11px] font-medium text-ink-secondary">
                Video topic
                <input
                  autoFocus
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="What should this production be about?"
                  className="mt-2 h-10 w-full rounded-md border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink-caption focus:border-action"
                />
              </label>
              {error ? (
                <p className="mt-2 text-[10px] text-error">{error}</p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-line-subtle px-4 py-3">
              <button
                type="button"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
                className="h-9 rounded-md px-3 text-[11px] text-ink-tertiary hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={topic.trim().length < 8 || creating}
                className="h-9 rounded-md bg-control px-4 text-[11px] font-medium text-control-ink hover:bg-control-hover disabled:opacity-45"
              >
                {creating ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
};
