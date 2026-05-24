"use client";
import Link from "next/link";
import type { ReactNode } from "react";

// Reusable empty-state with personality copy + action CTA.
// Use on /memory, /live, /leaderboard, /run/[id] not-found, etc.

type Action = { label: string; href?: string; onClick?: () => void };

export function EmptyState({
  icon,
  title,
  body,
  action,
  secondary,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: Action;
  secondary?: Action;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-10 sm:py-14 text-center card-pixel"
      style={{
        color: "var(--muted)",
        background: "rgba(var(--surface-rgb), 0.3)",
        backdropFilter: "blur(6px)",
      }}
    >
      {icon && (
        <div className="opacity-60 text-4xl" style={{ color: "var(--accent)" }}>
          {icon}
        </div>
      )}
      <h3 className="font-pixel text-base sm:text-lg tracking-wider m-0" style={{ color: "var(--fg)" }}>
        {title}
      </h3>
      {body && (
        <p className="max-w-md text-xs sm:text-sm font-mono m-0 px-4 leading-relaxed">{body}</p>
      )}
      {(action || secondary) && (
        <div className="flex flex-wrap gap-2 mt-2">
          {action && (action.href ? (
            <Link href={action.href} className="btn-pixel success" style={{ padding: "6px 14px", fontSize: 11 }}>
              {action.label}
            </Link>
          ) : (
            <button onClick={action.onClick} className="btn-pixel success" style={{ padding: "6px 14px", fontSize: 11 }}>
              {action.label}
            </button>
          ))}
          {secondary && (secondary.href ? (
            <Link href={secondary.href} className="btn-pixel ghost" style={{ padding: "6px 14px", fontSize: 11 }}>
              {secondary.label}
            </Link>
          ) : (
            <button onClick={secondary.onClick} className="btn-pixel ghost" style={{ padding: "6px 14px", fontSize: 11 }}>
              {secondary.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
