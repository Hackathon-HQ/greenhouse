import { faviconUrl, type Source } from "@/lib/data";

function SourceItem({ source, first }: { source: Source; first: boolean }) {
  return (
    <a
      href={source.url || `https://${source.domain}`}
      target="_blank"
      rel="noreferrer"
      className={`group flex gap-3 py-[14px] transition-colors ${
        first ? "" : "border-t border-border"
      }`}
    >
      <span className="flex size-[26px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-border bg-app">
        {/* Real favicon pulled from the source's domain, like ChatGPT citations. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={faviconUrl(source.host)}
          alt=""
          width={18}
          height={18}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-[17px] object-contain"
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-semibold text-ink group-hover:underline">
            {source.name}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-muted">{source.age}</span>
        </div>
        {source.quote ? (
          <p className="text-[14.5px] leading-[22px] tracking-[-0.005em] text-ink">{source.quote}</p>
        ) : null}
        <span className="truncate font-mono text-[11px] text-muted">{source.domain}</span>
      </div>
    </a>
  );
}

export function EvidencePanel({
  sources,
  signalCount,
}: {
  sources: Source[];
  signalCount: number;
}) {
  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-soft">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border px-[18px]">
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Evidence</span>
        <span className="font-mono text-[11px] tracking-[0.01em] text-sub">
          {signalCount} signals
        </span>
      </div>
      <div className="scroll-area flex flex-1 flex-col overflow-y-auto px-4 pt-4 pb-[18px]">
        <span className="pb-1.5 font-mono text-[10.5px] font-medium tracking-[0.09em] text-ink">
          SOURCE SIGNALS
        </span>
        {sources.length === 0 ? (
          <p className="py-3 text-[13px] leading-6 text-muted">No seed under review.</p>
        ) : (
          sources.map((source, i) => (
            <SourceItem key={source.id} source={source} first={i === 0} />
          ))
        )}
      </div>
    </aside>
  );
}
