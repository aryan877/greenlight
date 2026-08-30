import { LogOut, UserRound } from "lucide-react";

export const AccountMenu = () => (
  <details className="group relative">
    <summary className="flex h-8 cursor-pointer list-none items-center gap-2 border border-line-subtle px-2.5 text-[10px] font-medium text-ink-secondary hover:border-line-strong hover:text-ink [&::-webkit-details-marker]:hidden">
      <UserRound size={13} />
      Account
    </summary>
    <div className="absolute right-0 top-10 z-50 w-48 border border-line bg-surface p-2 shadow-2xl">
      <div className="border-b border-line-subtle px-2 py-2">
        <p className="text-[10px] font-medium text-ink">Demo account</p>
        <p className="mt-0.5 text-[9px] text-ink-tertiary">
          Hackathon workspace
        </p>
      </div>
      <form method="post" action="/auth/logout" className="pt-1.5">
        <button
          type="submit"
          className="flex h-8 w-full items-center gap-2 px-2 text-left text-[10px] text-ink-secondary hover:bg-hover hover:text-ink"
        >
          <LogOut size={12} />
          Log out
        </button>
      </form>
    </div>
  </details>
);
