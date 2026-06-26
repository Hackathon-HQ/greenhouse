import type { ReviewSeed } from "@/lib/data";

function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-muted">
      {children}
    </span>
  );
}

export function SeedDetail({ seed }: { seed: ReviewSeed }) {
  return (
    <div className="scroll-area flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
      {/* A clean, centered Tinder-style card: just the idea. */}
      <div className="mx-auto flex max-w-[720px] flex-col items-center px-[46px] py-12">
        <div className="flex items-center justify-center gap-2">
          <MetaLabel>IDEA</MetaLabel>
          <span className="h-3 w-px bg-border" />
          <MetaLabel>{seed.confidence}% CONFIDENCE</MetaLabel>
        </div>

        <h1 className="mt-5 text-center text-[clamp(34px,4.2vw,46px)] font-bold leading-[1.05] tracking-[-0.035em] text-ink text-balance">
          {seed.title}
        </h1>

        {/* The lead is the centerpiece you read & swipe on: large + centered. */}
        <p className="mx-auto mt-7 max-w-[640px] text-center text-[clamp(24px,3.1vw,34px)] font-medium leading-[1.3] tracking-[-0.02em] text-ink text-pretty">
          {seed.lead}
        </p>
      </div>
    </div>
  );
}
