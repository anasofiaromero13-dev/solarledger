import { SiteHeader } from "@/components/layout/site-header";
import { SolarLedgerHero } from "@/components/solar-ledger-hero";

export default function Home() {
  return (
    <div className="min-h-screen font-[family-name:var(--font-geist-sans)]">
      <SiteHeader />
      <main>
        <SolarLedgerHero />
      </main>
    </div>
  );
}
