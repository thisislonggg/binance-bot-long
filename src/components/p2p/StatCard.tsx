import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string;
  subvalue?: string;
  icon?: ReactNode;
  hint?: ReactNode;
  tone?: "bid" | "ask" | "primary" | "neutral";
  action?: ReactNode;
  badge?: {
    text: string;
    variant?: "bid" | "ask" | "primary" | "neutral";
  };
  trend?: {
    value: string;
    positive?: boolean;
  };
};

const toneClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  bid: "text-bid border-bid/25",
  ask: "text-ask border-ask/25",
  primary: "text-primary border-primary/25",
  neutral: "text-foreground",
};

const badgeClasses: Record<string, string> = {
  bid: "bg-bid/10 text-bid border-bid/20",
  ask: "bg-ask/10 text-ask border-ask/20",
  primary: "bg-primary/10 text-primary border-primary/20",
  neutral: "bg-surface-2 text-muted-foreground border-border",
};


export function StatCard({
  label,
  value,
  subvalue,
  icon,
  hint,
  tone,
  action,
  badge,
  trend,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "panel-interactive relative min-w-0 overflow-hidden p-3 sm:p-4 flex flex-col justify-between",
        tone && toneClasses[tone],
      )}
    >
      {/* Top Row: Label, Badge, Actions */}
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-[0.65rem] font-semibold leading-tight tracking-wide text-muted-foreground uppercase">
            {label}
          </span>
          {badge ? (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[0.6rem] font-bold tracking-wider uppercase",
                badgeClasses[badge.variant ?? "neutral"],
              )}
            >
              {badge.text}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {action}
          {icon ? (
            <span className={cn("p-1 rounded-md bg-surface-2 text-muted-foreground", tone && toneClasses[tone])}>
              {icon}
            </span>
          ) : null}
        </div>
      </div>

      {/* Center Value */}
      <div className="my-2 min-w-0">
        <div className={cn("num truncate text-lg sm:text-xl font-bold tracking-tight text-foreground", tone && toneClasses[tone])}>
          {value}
        </div>
        {subvalue ? <div className="num mt-0.5 text-[0.7rem] leading-snug text-muted-foreground">{subvalue}</div> : null}
      </div>

      {/* Bottom Row: Hint & Trend */}
      {(hint || trend) && (
        <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2 text-[0.68rem] text-muted-foreground">
          {hint ? <div className="min-w-0 truncate">{hint}</div> : <div />}
          {trend ? (
            <span
              className={cn(
                "num font-semibold shrink-0",
                trend.positive ? "text-bid" : "text-ask",
              )}
            >
              {trend.value}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
