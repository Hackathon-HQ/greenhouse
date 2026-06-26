import { ChevronRight } from "lucide-react";
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
    <>
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[680px] flex-col px-[46px] pt-12 pb-8">
          {/* Hero: the idea is the thing you swipe on — big and central. */}
          <div className="flex items-center justify-center gap-2">
            <MetaLabel>IDEA</MetaLabel>
            <span className="h-3 w-px bg-border" />
            <MetaLabel>{seed.confidence}% CONFIDENCE</MetaLabel>
          </div>

          <h1 className="mt-4 text-center text-[clamp(34px,4.2vw,46px)] font-bold leading-[1.05] tracking-[-0.035em] text-ink text-balance">
            {seed.title}
          </h1>

          {/* The lead is the centerpiece you read & swipe on: large + centered. */}
          <p className="mx-auto mt-7 max-w-[620px] text-center text-[clamp(24px,3.1vw,34px)] font-medium leading-[1.3] tracking-[-0.02em] text-ink text-pretty">
            {seed.lead}
          </p>

          {/* Supporting metadata — compact, de-emphasized. */}
          <div className="mt-12 h-px w-full shrink-0 bg-border" />

          <section className="mt-7 flex flex-col gap-3">
            <MetaLabel>WHY THIS SHOULD EXIST</MetaLabel>
            <div className="flex flex-wrap gap-1.5">
              {seed.why.map((point) => (
                <span
                  key={point}
                  className="inline-flex items-center rounded-full border border-border bg-soft px-3 py-1.5 text-[12.5px] leading-tight text-sub"
                >
                  {point}
                </span>
              ))}
            </div>
          </section>

          <section className="mt-6 flex flex-col gap-3">
            <MetaLabel>FIRST VERSION</MetaLabel>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
              {seed.firstVersion.map((step, i) => (
                <div key={step} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <ChevronRight className="size-[13px] shrink-0 text-muted" strokeWidth={2} />
                  )}
                  <span className="flex h-[28px] items-center rounded-[8px] border border-border bg-soft px-2.5 text-[12px] font-medium text-sub">
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
