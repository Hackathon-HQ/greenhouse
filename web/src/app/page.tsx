"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles } from "lucide-react";
import {
  freshBuildSteps,
  initialBuilding,
  initialBuilt,
  reviewSeeds,
  type BuildingSeed,
  type BuiltSeed,
} from "@/lib/data";
import { Sidebar } from "@/components/sidebar";
import { SeedDetail } from "@/components/seed-detail";
import { EvidencePanel } from "@/components/evidence-panel";
import { ActionBar } from "@/components/action-bar";

type Decision = "approve" | "deny";

const cardVariants = {
  enter: { opacity: 0, y: 14, scale: 0.99 },
  center: { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir * 520,
    rotate: dir * 5,
    scale: 0.95,
  }),
};

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 px-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border bg-soft">
        <Sparkles className="size-5 text-ink" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
          You&rsquo;re all caught up
        </h2>
        <p className="max-w-[320px] text-[14px] leading-6 text-sub">
          Every seed in the queue has been reviewed. Hunt the open web for fresh app ideas.
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="mt-1 flex h-10 items-center gap-2 rounded-[10px] bg-accent px-4 text-[13.5px] font-medium text-white transition-transform active:scale-95"
      >
        <Sparkles className="size-4" />
        Hunt for more seeds
      </button>
    </div>
  );
}

export default function Home() {
  const [building, setBuilding] = useState<BuildingSeed[]>(initialBuilding);
  const [built] = useState<BuiltSeed[]>(initialBuilt);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [flash, setFlash] = useState<Decision | null>(null);
  const lock = useRef(false);

  const current = reviewSeeds[index];

  const decide = useCallback(
    (kind: Decision) => {
      if (lock.current) return;
      const seed = reviewSeeds[index];
      if (!seed) return;

      lock.current = true;
      setTimeout(() => {
        lock.current = false;
      }, 360);

      setDirection(kind === "approve" ? 1 : -1);
      setFlash(kind);
      setTimeout(() => setFlash(null), 220);

      if (kind === "approve") {
        setBuilding((prev) => [
          {
            id: `build-${seed.id}-${index}`,
            title: seed.title,
            age: "now",
            meta: `${seed.sources.length} sources · ${seed.confidence}% · Building`,
            steps: freshBuildSteps(),
          },
          ...prev,
        ]);
      }

      setIndex((i) => i + 1);
    },
    [index],
  );

  const reset = useCallback(() => {
    setDirection(1);
    setIndex(0);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "a" || e.key === "A" || e.key === "ArrowRight") {
        e.preventDefault();
        decide("approve");
      } else if (e.key === "d" || e.key === "D" || e.key === "ArrowLeft") {
        e.preventDefault();
        decide("deny");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide]);

  return (
    <div className="flex h-full w-full bg-app">
      <Sidebar building={building} built={built} />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <AnimatePresence mode="popLayout" custom={direction} initial={false}>
            {current ? (
              <motion.div
                key={current.id}
                custom={direction}
                variants={cardVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
                className="flex min-h-0 flex-1 flex-col"
              >
                <SeedDetail seed={current} />
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
                className="flex min-h-0 flex-1 flex-col items-center justify-center"
              >
                <EmptyState onReset={reset} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <ActionBar
          onDeny={() => decide("deny")}
          onApprove={() => decide("approve")}
          disabled={!current}
          flash={flash}
        />
      </main>

      <EvidencePanel sources={current?.sources ?? []} signalCount={current?.signalCount ?? 0} />
    </div>
  );
}
