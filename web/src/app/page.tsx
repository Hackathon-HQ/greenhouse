"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles } from "lucide-react";
import {
  freshBuildSteps,
  initialBuilding,
  initialBuilt,
  reviewSeeds as mockReviewSeeds,
  type BuildingSeed,
  type BuiltSeed,
  type ReviewSeed,
} from "@/lib/data";
import {
  apiBaseUrl,
  build as buildIdea,
  discover,
  getFeed,
  subscribeStream,
  type AppIdea,
  type BuildArtifact,
} from "@/lib/api";
import { appIdeaToSeed, isTerminalBuild, latestLogLine, signalCountFor, stepsFromArtifact } from "@/lib/map";
import { Sidebar } from "@/components/sidebar";
import { SeedDetail } from "@/components/seed-detail";
import { EvidencePanel } from "@/components/evidence-panel";
import { ActionBar } from "@/components/action-bar";
import { BuildDetail, type BuildDetailData } from "@/components/build-detail";
import type { BuildStatus } from "@/lib/api";

type Decision = "approve" | "deny";

/** Lightweight per-idea metadata used to render building/built cards. */
type IdeaMeta = { title: string; confidence: number; signalCount: number };

/** Recover the BuildStatus from a building card's meta suffix (e.g. "… · Building"). */
function statusFromBuildingMeta(meta: string): BuildStatus {
  const tail = meta.split("·").pop()?.trim().toLowerCase() ?? "";
  if (tail === "queued") return "queued";
  if (tail === "failed") return "failed";
  if (tail === "skipped") return "skipped";
  return "building";
}

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

function EmptyState({ onReset, loading }: { onReset: () => void; loading: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 px-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border bg-soft">
        <Sparkles className={`size-5 text-ink ${loading ? "animate-pulse" : ""}`} />
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
          {loading ? "Hunting the open web…" : "You’re all caught up"}
        </h2>
        <p className="max-w-[320px] text-[14px] leading-6 text-sub">
          {loading
            ? "Scouting Reddit, X, Hacker News and the open web for fresh app ideas. New seeds will appear as they’re found."
            : "Every seed in the queue has been reviewed. Hunt the open web for fresh app ideas."}
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        disabled={loading}
        className="mt-1 flex h-10 items-center gap-2 rounded-[10px] bg-accent px-4 text-[13.5px] font-medium text-white transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Sparkles className={`size-4 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Hunting…" : "Hunt for more seeds"}
      </button>
    </div>
  );
}

export default function Home() {
  const [seeds, setSeeds] = useState<ReviewSeed[]>(mockReviewSeeds);
  const [building, setBuilding] = useState<BuildingSeed[]>(initialBuilding);
  const [built, setBuilt] = useState<BuiltSeed[]>(initialBuilt);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [flash, setFlash] = useState<Decision | null>(null);
  const [hunting, setHunting] = useState(false);
  const [selectedBuild, setSelectedBuild] = useState<
    { kind: "building" | "built"; id: string } | null
  >(null);
  const lock = useRef(false);
  /** id -> meta, so build SSE events can render cards without the seed in view. */
  const ideaMeta = useRef<Map<string, IdeaMeta>>(new Map());

  const current = seeds[index];

  // Remember enough about each idea to render building/built cards later.
  const rememberIdeas = useCallback((ideas: AppIdea[]) => {
    for (const idea of ideas) {
      ideaMeta.current.set(idea.id, {
        title: idea.title,
        confidence: Math.round((idea.score ?? 0) * 100),
        signalCount: signalCountFor(idea),
      });
    }
  }, []);

  // Initial feed load (with offline fallback to the static mock seeds).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ideas = await getFeed();
        if (cancelled) return;
        rememberIdeas(ideas);
        if (ideas.length) {
          setSeeds(ideas.map(appIdeaToSeed));
          setIndex(0);
        }
      } catch (err) {
        console.warn("[apptok] feed fetch failed, using offline mock seeds:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rememberIdeas]);

  // Apply a build artifact to the building/built lists.
  const applyBuild = useCallback((a: BuildArtifact) => {
    const meta = ideaMeta.current.get(a.ideaId);
    const title = meta?.title ?? a.ideaId;
    const sourcesN = meta?.signalCount ?? 0;
    const conf = meta?.confidence ?? 0;

    if (a.status === "succeeded") {
      // "View" must hit the HOSTED preview route — the artifact's previewUrl is a
      // server-side file:// path a browser can't open.
      const hostedPreview = `${apiBaseUrl()}/api/builds/${encodeURIComponent(a.ideaId)}/preview`;
      setBuilding((prev) => prev.filter((b) => b.id !== a.ideaId));
      setBuilt((prev) => {
        if (prev.some((b) => b.id === a.ideaId)) {
          return prev.map((b) =>
            b.id === a.ideaId
              ? { ...b, previewUrl: hostedPreview, workdir: a.workdir ?? b.workdir, logs: a.logs }
              : b,
          );
        }
        return [
          {
            id: a.ideaId,
            title,
            age: "now",
            meta: `${sourcesN} sources · ${conf}% · Built`,
            previewUrl: hostedPreview,
            workdir: a.workdir,
            logs: a.logs,
          },
          ...prev,
        ];
      });
      return;
    }

    // queued / building / failed / skipped -> reflect on a building card.
    const steps = stepsFromArtifact(a);
    const log = latestLogLine(a.logs);
    setBuilding((prev) => {
      const idx = prev.findIndex((b) => b.id === a.ideaId);
      if (idx === -1) {
        const label = isTerminalBuild(a.status) ? a.status : "Building";
        return [
          {
            id: a.ideaId,
            title,
            age: "now",
            meta: `${sourcesN} sources · ${conf}% · ${label[0].toUpperCase()}${label.slice(1)}`,
            log,
            logs: a.logs,
            steps,
          },
          ...prev,
        ];
      }
      return prev.map((b) =>
        b.id === a.ideaId ? { ...b, steps, log: log || b.log, logs: a.logs } : b,
      );
    });
  }, []);

  // Live stream: new ideas refill the queue; build events drive the sidebar.
  useEffect(() => {
    const unsubscribe = subscribeStream({
      onIdea: (ideas) => {
        if (ideas.length) setHunting(false);
        rememberIdeas(ideas);
        setSeeds((prev) => {
          const known = new Set(prev.map((s) => s.id));
          const fresh = ideas.filter((i) => !known.has(i.id)).map(appIdeaToSeed);
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      },
      onBuild: applyBuild,
    });
    return unsubscribe;
  }, [applyBuild, rememberIdeas]);

  const decide = useCallback(
    (kind: Decision) => {
      if (lock.current) return;
      const seed = seeds[index];
      if (!seed) return;

      lock.current = true;
      setTimeout(() => {
        lock.current = false;
      }, 360);

      setDirection(kind === "approve" ? 1 : -1);
      setFlash(kind);
      setTimeout(() => setFlash(null), 220);

      if (kind === "approve") {
        // Optimistic building card keyed by the idea id so build SSE matches it.
        setBuilding((prev) => {
          if (prev.some((b) => b.id === seed.id)) return prev;
          return [
            {
              id: seed.id,
              title: seed.title,
              age: "now",
              meta: `${seed.sources.length} sources · ${seed.confidence}% · Building`,
              steps: freshBuildSteps(),
            },
            ...prev,
          ];
        });
        // Kick off the real build; queued artifact + SSE drive the steps.
        buildIdea(seed.id)
          .then(applyBuild)
          .catch((err) => console.warn("[apptok] build request failed:", err));
      }

      setIndex((i) => i + 1);
    },
    [seeds, index, applyBuild],
  );

  const reset = useCallback(() => {
    setDirection(1);
    setIndex(0);
    // Hunt the open web for more seeds; results stream back via SSE.
    setHunting(true);
    discover()
      .then((ideas) => {
        rememberIdeas(ideas);
        setSeeds((prev) => {
          const known = new Set(prev.map((s) => s.id));
          const fresh = ideas.filter((i) => !known.has(i.id)).map(appIdeaToSeed);
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      })
      .catch((err) => console.warn("[apptok] discover failed:", err))
      .finally(() => setHunting(false));
  }, [rememberIdeas]);

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

  // Resolve the selected card from live state by id, so the modal updates LIVE
  // as new build artifacts stream in while it's open.
  let selectedBuildData: BuildDetailData | null = null;
  if (selectedBuild) {
    if (selectedBuild.kind === "building") {
      const seed = building.find((b) => b.id === selectedBuild.id);
      if (seed) {
        selectedBuildData = {
          title: seed.title,
          status: statusFromBuildingMeta(seed.meta),
          meta: seed.meta,
          steps: seed.steps,
          logs: seed.logs,
        };
      } else {
        // The card may have moved to BUILT (build succeeded) while open.
        const promoted = built.find((b) => b.id === selectedBuild.id);
        if (promoted) {
          selectedBuildData = {
            title: promoted.title,
            status: "succeeded",
            meta: promoted.meta,
            logs: promoted.logs,
            previewUrl: promoted.previewUrl,
            workdir: promoted.workdir,
          };
        }
      }
    } else {
      const seed = built.find((b) => b.id === selectedBuild.id);
      if (seed) {
        selectedBuildData = {
          title: seed.title,
          status: "succeeded",
          meta: seed.meta,
          logs: seed.logs,
          previewUrl: seed.previewUrl,
          workdir: seed.workdir,
        };
      }
    }
  }

  return (
    <div className="flex h-full w-full bg-app">
      <Sidebar building={building} built={built} onSelect={(kind, id) => setSelectedBuild({ kind, id })} />

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
                <EmptyState onReset={reset} loading={hunting} />
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

      <AnimatePresence>
        {selectedBuildData ? (
          <BuildDetail
            key={selectedBuild?.id ?? "build-detail"}
            build={selectedBuildData}
            onClose={() => setSelectedBuild(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
