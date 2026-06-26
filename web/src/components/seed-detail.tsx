import type { ReviewSeed } from "@/lib/data";

export function SeedDetail({ seed }: { seed: ReviewSeed }) {
  return (
    <div className="scroll-area flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-[56px] pt-[10vh] pb-16">
      {/* A clean, centered Tinder-style card: just the idea, with room to breathe. */}
      <div className="flex w-full max-w-[860px] flex-col items-center">
        <h1 className="text-center text-[clamp(32px,4vw,44px)] font-bold leading-[1.06] tracking-[-0.035em] text-ink text-balance">
          {seed.title}
        </h1>

        {/* The lead is the centerpiece you read & swipe on — large, wide, centered. */}
        <p className="mt-8 w-full max-w-[820px] text-center text-[clamp(24px,3.1vw,34px)] font-medium leading-[1.34] tracking-[-0.02em] text-ink text-pretty">
          {seed.lead}
        </p>
      </div>
    </div>
  );
}
