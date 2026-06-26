import { CheckCircle2, XCircle } from "lucide-react";

type Decision = "approve" | "deny";

function Kbd({ children, tone }: { children: React.ReactNode; tone: Decision }) {
  return (
    <span
      className={`flex h-5 min-w-5 items-center justify-center rounded-md px-[5px] font-mono text-[11px] font-medium ${
        tone === "deny" ? "bg-deny/15 text-deny" : "bg-approve/15 text-approve"
      }`}
    >
      {children}
    </span>
  );
}

export function ActionBar({
  onDeny,
  onApprove,
  disabled,
  flash,
}: {
  onDeny: () => void;
  onApprove: () => void;
  disabled?: boolean;
  flash: Decision | null;
}) {
  return (
    <div className="flex h-[76px] w-full shrink-0 items-center gap-3.5 border-t border-border bg-app px-6">
      <button
        type="button"
        onClick={onDeny}
        disabled={disabled}
        className={`flex h-[52px] flex-1 items-center justify-center gap-2.5 rounded-xl bg-deny-soft text-deny transition-all duration-150 hover:brightness-[0.97] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 ${
          flash === "deny" ? "scale-[0.98] brightness-95" : ""
        }`}
      >
        <XCircle className="size-[18px]" strokeWidth={2} />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Deny</span>
        <Kbd tone="deny">D</Kbd>
      </button>
      <button
        type="button"
        onClick={onApprove}
        disabled={disabled}
        className={`flex h-[52px] flex-1 items-center justify-center gap-2.5 rounded-xl bg-approve-soft text-approve transition-all duration-150 hover:brightness-[0.97] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 ${
          flash === "approve" ? "scale-[0.98] brightness-95" : ""
        }`}
      >
        <CheckCircle2 className="size-[18px]" strokeWidth={2} />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Approve</span>
        <Kbd tone="approve">A</Kbd>
      </button>
    </div>
  );
}
