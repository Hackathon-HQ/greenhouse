"use client";

import { useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import type { ReviewSeed } from "@/lib/data";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{children}</h2>
  );
}

function Composer({ seedTitle }: { seedTitle: string }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setValue("");
      }}
      className="flex h-12 items-center justify-between gap-2.5 rounded-xl border border-border bg-app pr-2 pl-4 transition-colors focus-within:border-border-strong"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`Ask AI about ${seedTitle}…`}
        aria-label="Ask AI about this idea"
        className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-muted focus:outline-none"
      />
      <button
        type="submit"
        aria-label="Send"
        className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-accent text-white transition-transform active:scale-95"
      >
        <ArrowRight className="size-4" strokeWidth={2} />
      </button>
    </form>
  );
}

export function SeedDetail({ seed }: { seed: ReviewSeed }) {
  return (
    <>
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-[22px] px-[46px] pt-9 pb-6">
          <h1 className="text-[34px] font-semibold leading-[38px] tracking-[-0.025em] text-ink">
            {seed.title}
          </h1>

          <div className="h-px w-full shrink-0 bg-border" />

          <div className="flex flex-col gap-[22px]">
            <p className="text-[17px] leading-[27px] tracking-[-0.01em] text-ink">{seed.lead}</p>

            <section className="flex flex-col gap-3">
              <SectionHeading>Why this should exist</SectionHeading>
              <ul className="flex flex-col gap-[9px]">
                {seed.why.map((point) => (
                  <li key={point} className="flex items-start gap-2">
                    <span className="flex h-6 w-3.5 shrink-0 items-center">
                      <span className="size-[5px] rounded-full bg-muted" />
                    </span>
                    <span className="text-[15px] leading-6 text-ink">{point}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="flex flex-col gap-[13px]">
              <SectionHeading>First version</SectionHeading>
              <div className="flex flex-wrap items-center gap-2">
                {seed.firstVersion.map((step, i) => (
                  <div key={step} className="flex items-center gap-2">
                    {i > 0 && <ChevronRight className="size-[15px] shrink-0 text-muted" strokeWidth={2} />}
                    <span className="flex h-[34px] items-center rounded-[9px] border border-border bg-soft px-[13px] text-[13px] font-medium text-ink">
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-[11px]">
              <SectionHeading>Prototype scope</SectionHeading>
              <p className="text-[15px] leading-6 text-ink">{seed.scope}</p>
            </section>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-[46px] pt-2 pb-5">
        <Composer seedTitle={seed.title} />
      </div>
    </>
  );
}
