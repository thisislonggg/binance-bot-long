import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string;
  icon?: ReactNode;
  hint?: ReactNode;
  tone?: "bid" | "ask" | "primary";
};

const toneClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  bid: "text-bid shadow-[var(--shadow-glow-bid)]",
  ask: "text-ask shadow-[var(--shadow-glow-ask)]",
  primary: "text-primary",
};

export function StatCard({ label, value, icon, hint, tone }: StatCardProps) {
  return (
    <div className={cn("panel p-4", tone && (tone === "bid" || tone === "ask") && toneClasses[tone])}>
      <div className="flex items-center justify-between text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        <span>{label}</span>
        {icon ? <span className={tone ? toneClasses[tone] : undefined}>{icon}</span> : null}
      </div>
      <div className={cn("num mt-2 text-2xl font-semibold", tone && toneClasses[tone])}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
