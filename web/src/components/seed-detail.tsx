import type { ReviewSeed } from "@/lib/data";

export function SeedDetail({ seed }: { seed: ReviewSeed }) {
  return (
    <div className="scroll-area flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-[56px] pt-[8vh] pb-16">
      {/* Just the idea — big, centered, the thing you read and swipe on. */}
      <p className="w-full max-w-[880px] text-center text-[clamp(30px,3.8vw,44px)] font-semibold leading-[1.28] tracking-[-0.022em] text-ink text-pretty">
        {seed.lead}
      </p>
    </div>
  );
}
