import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { TrueForgeIcon } from "../brand-icons.js";
import { producerPromptTemplates } from "../editor/producer-prompt-library.js";

export const PromptLibraryModal = ({
  onChoose,
  onClose,
}: {
  onChoose: (prompt: string) => void;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return producerPromptTemplates;
    return producerPromptTemplates.filter((template) =>
      [template.group, template.label, template.description, template.prompt]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-library-title"
        className="flex max-h-[min(760px,calc(100dvh-40px))] w-full max-w-5xl flex-col overflow-hidden border border-line bg-surface shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-line-subtle px-6 py-5">
          <div>
            <div className="mb-2 flex items-center gap-2 text-action">
              <TrueForgeIcon className="size-4" />
              <span className="font-mono text-[9px] uppercase tracking-[0.18em]">
                TrueForge playbooks
              </span>
            </div>
            <h2
              id="prompt-library-title"
              className="text-xl font-semibold tracking-[-0.03em] text-ink"
            >
              What should Greenlight do?
            </h2>
            <p className="mt-1 text-[11px] text-ink-tertiary">
              Choose a tested prompt. It fills the composer and never sends by
              itself.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close prompt library"
            title="Close prompt library"
            onClick={onClose}
            className="grid size-9 place-items-center border border-line-subtle text-ink-tertiary hover:bg-hover hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="border-b border-line-subtle px-6 py-3">
          <label className="flex h-9 items-center gap-2 border border-line bg-surface-sunken px-3 focus-within:border-action">
            <Search size={13} className="text-ink-caption" />
            <span className="sr-only">Search prompt library</span>
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search evidence, edit, audio, thumbnails…"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-caption"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filtered.map((template) => (
              <button
                key={template.label}
                type="button"
                onClick={() => onChoose(template.prompt)}
                className="group min-h-36 border border-line bg-surface p-4 text-left hover:border-action hover:bg-hover"
              >
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-action">
                  {template.group}
                </span>
                <strong className="mt-2 block text-[13px] font-semibold text-ink">
                  {template.label}
                </strong>
                <span className="mt-1 block text-[11px] leading-5 text-ink-secondary">
                  {template.description}
                </span>
                <span className="mt-3 line-clamp-2 block border-t border-line-subtle pt-3 text-[10px] leading-4 text-ink-tertiary">
                  {template.prompt}
                </span>
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="grid min-h-48 place-items-center text-[12px] text-ink-tertiary">
              No matching playbook.
            </div>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
};
