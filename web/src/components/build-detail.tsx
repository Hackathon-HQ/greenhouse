"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Check, Code, Eye, X } from "lucide-react";
import type { BuildStatus } from "@/lib/api";
import type { BuildStep } from "@/lib/data";

/** Visual config for each build status pill. */
const STATUS_PILL: Record<BuildStatus, { label: string; className: string; pulse?: boolean }> = {
  queued: { label: "Queued", className: "bg-soft text-sub border-border" },
  building: { label: "Building", className: "bg-soft text-ink border-border-strong", pulse: true },
  succeeded: { label: "Succeeded", className: "bg-approve-soft text-approve border-approve-soft" },
  failed: { label: "Failed", className: "bg-deny-soft text-deny border-deny-soft" },
  skipped: { label: "Skipped", className: "bg-soft text-muted border-border" },
};

/** Strip the channel prefix + collapse whitespace on a single log line. */
function cleanLine(raw: string): string {
  return (raw ?? "")
    .replace(/^\s*\[(?:build|cursor|cursor:stdout|cursor:stderr)\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type BuildDetailData = {
  title: string;
  status: BuildStatus;
  meta: string;
  steps?: BuildStep[];
  logs?: string[];
  previewUrl?: string;
  workdir?: string;
};

function StatusPill({ status }: { status: BuildStatus }) {
  const pill = STATUS_PILL[status] ?? STATUS_PILL.queued;
  return (
    <span
      className={`flex h-[22px] items-center gap-[6px] rounded-full border px-[9px] text-[11px] font-medium ${pill.className}`}
    >
      {pill.pulse ? (
        <span className="size-[6px] animate-pulse rounded-full bg-ink" />
      ) : null}
      {pill.label}
    </span>
  );
}

function StepsList({ steps }: { steps: BuildStep[] }) {
  const activeIndex = steps.findIndex((s) => !s.done);
  return (
    <div className="flex flex-col gap-[9px]">
      {steps.map((step, i) => {
        const active = i === activeIndex;
        return (
          <div key={step.label} className="flex items-center gap-[9px]">
            {step.done ? (
              <span className="flex size-[16px] shrink-0 items-center justify-center rounded-[5px] bg-ink">
                <Check className="size-2.5 text-white" strokeWidth={3} />
              </span>
            ) : (
              <span
                className={`size-[16px] shrink-0 rounded-[5px] border-[1.5px] ${
                  active ? "animate-pulse border-ink" : "border-border-strong"
                }`}
              />
            )}
            <span
              className={`text-[12.5px] ${
                step.done ? "text-sub" : active ? "text-ink" : "text-muted"
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function BuildDetail({
  build,
  onClose,
}: {
  build: BuildDetailData;
  onClose: () => void;
}) {
  const { title, status, meta, steps, logs, previewUrl, workdir } = build;
  const consoleRef = useRef<HTMLDivElement>(null);
  const lines = logs ?? [];
  const isBuilding = status === "queued" || status === "building";

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Auto-scroll the console to the bottom whenever new lines arrive: the effect
  // re-runs on every change to lines.length and pins scrollTop to the full height.
  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/40 backdrop-blur-[2px]"
      />

      {/* Panel */}
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} build detail`}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex max-h-full w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-border bg-app shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2.5">
              <h2 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-ink">
                {title}
              </h2>
              <StatusPill status={status} />
            </div>
            <span className="font-mono text-[11px] tracking-[-0.01em] text-sub">{meta}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-7 shrink-0 items-center justify-center rounded-[8px] border border-border text-sub transition-colors hover:bg-soft hover:text-ink"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="scroll-area flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {isBuilding && steps && steps.length ? (
            <section className="flex flex-col gap-2.5">
              <span className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-ink">
                STEPS
              </span>
              <StepsList steps={steps} />
            </section>
          ) : null}

          {status === "failed" ? (
            <section className="flex flex-col gap-2">
              <span className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-deny">
                BUILD FAILED
              </span>
              <div className="rounded-lg border border-deny-soft bg-deny-soft/40 px-3 py-2.5">
                {(lines.length
                  ? lines.slice(-4).map(cleanLine).filter(Boolean)
                  : ["No build output was captured."]
                ).map((line, i) => (
                  <p
                    key={i}
                    className="font-mono text-[11px] leading-[17px] tracking-[-0.01em] text-deny"
                  >
                    {line}
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          {/* Live console — the centerpiece. */}
          <section className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-ink">
                CONSOLE
              </span>
              <span className="font-mono text-[10.5px] tracking-[0.04em] text-muted">
                {lines.length}
              </span>
              {status === "building" ? (
                <span className="ml-0.5 size-[6px] animate-pulse rounded-full bg-ink" />
              ) : null}
            </div>
            <div
              ref={consoleRef}
              className="scroll-area max-h-[320px] min-h-[120px] overflow-y-auto rounded-lg border border-border bg-soft py-1.5"
            >
              {lines.length === 0 ? (
                <p className="px-3 py-2 font-mono text-[11px] leading-[18px] text-muted">
                  Waiting for the agent…
                </p>
              ) : (
                lines.map((raw, i) => {
                  const cleaned = cleanLine(raw);
                  if (!cleaned) return null;
                  return (
                    <div
                      key={i}
                      className={`px-3 py-[3px] font-mono text-[11px] leading-[17px] tracking-[-0.01em] ${
                        i % 2 === 0 ? "text-sub" : "text-muted"
                      }`}
                    >
                      {cleaned}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Finished actions */}
          {status === "succeeded" ? (
            <div className="flex flex-wrap items-center gap-2">
              {previewUrl ? (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-[32px] items-center gap-[6px] rounded-[8px] border border-border-strong bg-app px-3 text-[12.5px] font-medium text-ink transition-colors hover:bg-soft"
                >
                  <Eye className="size-[14px] text-ink" strokeWidth={2} />
                  View preview
                </a>
              ) : null}
              <a
                href={workdir ? `cursor://file/${workdir}` : undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!workdir}
                className={`flex h-[32px] items-center gap-[6px] rounded-[8px] border border-border bg-app px-3 text-[12.5px] font-medium text-sub transition-colors hover:bg-soft ${
                  workdir ? "" : "pointer-events-none opacity-50"
                }`}
              >
                <Code className="size-[14px] text-sub" strokeWidth={2} />
                Open in Cursor
              </a>
            </div>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}
