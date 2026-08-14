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
  bid: "text-bid glow-bid border-bid/25",
  ask: "text-ask glow-ask border-ask/25",
  primary: "text-primary glow-gold border-primary/25",
  neutral: "text-foreground",
};

const badgeClasses: Record<string, string> = {
  bid: "bg-bid/15 text-bid border-bid/25",
  ask: "bg-ask/15 text-ask border-ask/25",
  primary: "bg-primary/15 text-primary border-primary/25",
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
        "panel-interactive relative overflow-hidden p-4.5 flex flex-col justify-between",
        tone && toneClasses[tone],
      )}
    >
      {/* Top Row: Label, Badge, Actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">
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

        <div className="flex items-center gap-1.5">
          {action}
          {icon ? (
            <span className={cn("p-1 rounded-md bg-surface-2 text-muted-foreground", tone && toneClasses[tone])}>
              {icon}
            </span>
          ) : null}
        </div>
      </div>

      {/* Center Value */}
      <div className="my-2.5">
        <div className={cn("num text-2xl font-bold tracking-tight text-foreground", tone && toneClasses[tone])}>
          {value}
        </div>
        {subvalue ? <div className="num mt-0.5 text-xs text-muted-foreground">{subvalue}</div> : null}
      </div>

      {/* Bottom Row: Hint & Trend */}
      {(hint || trend) && (
        <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2 text-[0.72rem] text-muted-foreground">
          {hint ? <div className="truncate">{hint}</div> : <div />}
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
