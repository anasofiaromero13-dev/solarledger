export function SolarLedgerHero() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
      <p className="text-sm font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
        M&A financial modeling
      </p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-neutral-900 dark:text-white sm:text-5xl">
        SolarLedger
      </h1>
      <p className="mt-4 text-lg text-neutral-600 dark:text-neutral-300">
        Institutional solar models, portfolio views, and data workflows—wired
        to Supabase with TypeScript and Tailwind.
      </p>
      <ul className="mt-8 space-y-2 text-sm text-neutral-700 dark:text-neutral-400">
        <li>
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
            app/
          </code>{" "}
          — routes and layouts
        </li>
        <li>
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
            components/
          </code>{" "}
          — UI building blocks
        </li>
        <li>
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
            lib/
          </code>{" "}
          — Supabase client + utilities
        </li>
        <li>
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
            types/
          </code>{" "}
          — shared TypeScript types
        </li>
      </ul>
    </section>
  );
}
