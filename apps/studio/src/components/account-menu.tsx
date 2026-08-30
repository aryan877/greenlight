import { LogOut, UserRound } from "lucide-react";

export const AccountMenu = () => (
  <details className="group relative">
    <summary className="flex h-9 cursor-pointer list-none items-center gap-2 border border-line-subtle px-3 text-xs font-medium text-ink-secondary transition-colors hover:border-line-strong hover:bg-hover hover:text-ink [&::-webkit-details-marker]:hidden">
      <UserRound size={14} />
      Account
    </summary>
    <div className="absolute right-0 top-10 z-50 w-48 border border-line bg-surface p-2 shadow-2xl">
      <div className="border-b border-line-subtle px-2 py-2">
        <p className="text-xs font-medium text-ink">Signed in</p>
        <p className="mt-1 text-[10px] text-ink-tertiary">Demo workspace</p>
      </div>
      <form method="post" action="/auth/logout" className="pt-1.5">
        <button
          type="submit"
          className="flex h-9 w-full items-center gap-2 px-2 text-left text-xs font-medium text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
        >
          <LogOut size={14} />
          Log out
        </button>
      </form>
    </div>
  </details>
);
