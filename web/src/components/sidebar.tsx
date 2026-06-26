import { Check, Code, Eye } from "lucide-react";
import type { BuildingSeed, BuiltSeed } from "@/lib/data";

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-1.5 pb-0.5">
      <span className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-ink">
        {label}
      </span>
      <span className="font-mono text-[10.5px] font-medium tracking-[0.04em] text-muted">
        {count}
      </span>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-3 py-3 text-[12px] leading-[18px] text-muted">
      {children}
    </p>
  );
}

function CardShell({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`flex flex-col rounded-xl border border-border bg-app px-[13px] py-3 transition-colors duration-150 hover:border-border-strong ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      {children}
    </div>
  );
}

function CardHead({ title, age }: { title: string; age: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-[7px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/seed.svg" alt="" width={15} height={16} className="shrink-0" />
        <span className="truncate text-[13.5px] font-medium tracking-[-0.005em] text-ink">
          {title}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[10.5px] text-muted">{age}</span>
    </div>
  );
}

function BuildingCard({ seed, onSelect }: { seed: BuildingSeed; onSelect?: () => void }) {
  const activeIndex = seed.steps.findIndex((s) => !s.done);
  return (
    <CardShell onClick={onSelect}>
      <CardHead title={seed.title} age={seed.age} />
      <span className="mt-[9px] font-mono text-[11px] tracking-[-0.01em] text-sub">{seed.meta}</span>
      {seed.log ? (
        <div className="mt-[9px] flex items-center gap-[7px]">
          <span className="size-[6px] shrink-0 animate-pulse rounded-full bg-ink" />
          <span className="truncate font-mono text-[10.5px] leading-[15px] tracking-[-0.01em] text-muted">
            {seed.log}
          </span>
        </div>
      ) : null}
      <div className="mt-[11px] flex flex-col gap-[7px]">
        {seed.steps.map((step, i) => {
          const active = i === activeIndex;
          return (
            <div key={step.label} className="flex items-center gap-[9px]">
              {step.done ? (
                <span className="flex size-[15px] shrink-0 items-center justify-center rounded-[5px] bg-ink">
                  <Check className="size-2.5 text-white" strokeWidth={3} />
                </span>
              ) : (
                <span
                  className={`size-[15px] shrink-0 rounded-[5px] border-[1.5px] ${
                    active ? "animate-pulse border-ink" : "border-border-strong"
                  }`}
                />
              )}
              <span
                className={`text-[11.5px] ${
                  step.done ? "text-sub" : active ? "text-ink" : "text-muted"
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}

function ActionChip({
  icon: Icon,
  label,
  strong,
  href,
}: {
  icon: typeof Eye;
  label: string;
  strong?: boolean;
  href?: string;
}) {
  const className = `flex h-[26px] items-center gap-[5px] rounded-[7px] border bg-app px-[9px] transition-colors hover:bg-soft ${
    strong ? "border-border-strong" : "border-border"
  }`;
  const inner = (
    <>
      <Icon className={`size-[13px] ${strong ? "text-ink" : "text-sub"}`} strokeWidth={2} />
      <span className={`text-[11.5px] font-medium ${strong ? "text-ink" : "text-sub"}`}>
        {label}
      </span>
    </>
  );
  // Keep chip links working without opening the card's detail modal.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className} onClick={stop}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={stop}>
      {inner}
    </button>
  );
}

function BuiltCard({ seed, onSelect }: { seed: BuiltSeed; onSelect?: () => void }) {
  return (
    <CardShell onClick={onSelect}>
      <CardHead title={seed.title} age={seed.age} />
      <span className="mt-[10px] font-mono text-[11px] tracking-[-0.01em] text-sub">{seed.meta}</span>
      <div className="mt-[11px] flex flex-wrap items-center gap-1.5">
        <ActionChip icon={Eye} label="View" strong href={seed.previewUrl} />
        <ActionChip
          icon={Code}
          label="Open in Cursor"
          href={seed.workdir ? `cursor://file/${seed.workdir}` : undefined}
        />
      </div>
    </CardShell>
  );
}

export function Sidebar({
  building,
  built,
  onSelect,
}: {
  building: BuildingSeed[];
  built: BuiltSeed[];
  onSelect?: (kind: "building" | "built", id: string) => void;
}) {
  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-r border-border bg-soft">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border px-3.5 pt-4 pb-3.5">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Seeds</span>
      </div>
      <div className="scroll-area flex flex-1 flex-col gap-5 overflow-y-auto px-3.5 py-4">
        <section className="flex flex-col gap-1.5">
          <SectionLabel label="BUILDING" count={building.length} />
          {building.length === 0 ? (
            <EmptyHint>Approve an idea to start building it here.</EmptyHint>
          ) : (
            building.map((seed) => (
              <BuildingCard
                key={seed.id}
                seed={seed}
                onSelect={onSelect ? () => onSelect("building", seed.id) : undefined}
              />
            ))
          )}
        </section>
        <section className="flex flex-col gap-1.5">
          <SectionLabel label="BUILT" count={built.length} />
          {built.length === 0 ? (
            <EmptyHint>Finished builds will appear here.</EmptyHint>
          ) : (
            built.map((seed) => (
              <BuiltCard
                key={seed.id}
                seed={seed}
                onSelect={onSelect ? () => onSelect("built", seed.id) : undefined}
              />
            ))
          )}
        </section>
      </div>
    </aside>
  );
}
