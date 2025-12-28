import { OrderCallAgent } from "@/components/OrderCallAgent";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-zinc-100 px-6 py-12 font-sans text-zinc-900 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 dark:text-zinc-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <div className="space-y-2">
          <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-purple-700 dark:border-purple-500/40 dark:bg-purple-500/10 dark:text-purple-100">
            Flipkart Agent Studio
          </span>
          <h1 className="text-4xl font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
            Voice agent for automated order confirmations
          </h1>
          <p className="max-w-2xl text-base text-zinc-600 dark:text-zinc-400">
            Run end-to-end voice call simulations to validate cash-on-delivery
            and high value orders. Scripted cues keep conversations on track
            while you capture outcomes in one click.
          </p>
        </div>

        <OrderCallAgent />
      </div>
    </div>
  );
}
