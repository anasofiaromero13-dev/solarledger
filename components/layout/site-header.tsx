import { cn } from "@/lib/utils";

type SiteHeaderProps = {
  className?: string;
};

export function SiteHeader({ className }: SiteHeaderProps) {
  return (
    <header
      className={cn(
        "border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80",
        className,
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <span className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          SolarLedger
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          Next.js 14 · TypeScript · Tailwind · Supabase
        </span>
      </div>
    </header>
  );
}
