import type { LucideIcon } from "lucide-react";

export const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

export const IconButton = ({
  Icon,
  label,
  active,
  disabled = false,
  onClick,
  size = "md",
}: {
  Icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
}) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={active}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className={cx(
      "grid shrink-0 place-items-center rounded-full text-ink-tertiary transition-colors duration-100 ease-product hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30",
      size === "sm" ? "size-7" : "size-8",
      active && "bg-active text-action",
    )}
  >
    <Icon size={size === "sm" ? 14 : 15} strokeWidth={1.75} />
  </button>
);

export const ResizeHandle = ({
  direction,
  onPointerDown,
}: {
  direction: "horizontal" | "vertical";
  onPointerDown: React.PointerEventHandler;
}) => (
  <div
    role="separator"
    aria-orientation={direction === "vertical" ? "vertical" : "horizontal"}
    onPointerDown={onPointerDown}
    className={cx(
      "group relative z-[80] shrink-0 touch-none bg-line-subtle",
      direction === "vertical"
        ? "w-px cursor-col-resize"
        : "h-px cursor-row-resize",
    )}
  >
    <span
      className={cx(
        "absolute bg-transparent transition-colors group-hover:bg-action/25",
        direction === "vertical"
          ? "-left-1.5 inset-y-0 w-3"
          : "-top-1.5 inset-x-0 h-3",
      )}
    />
  </div>
);
