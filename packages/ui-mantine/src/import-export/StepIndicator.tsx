import { IconCheck } from "@tabler/icons-react";
import { Fragment } from "react";

/**
 * Compact horizontal step indicator: small numbered dots with 13px labels,
 * the current step in the accent colour, finished steps with a check.
 */
export function StepIndicator({ steps, active, "aria-label": ariaLabel = "Steps" }: { steps: string[]; active: number; "aria-label"?: string }) {
  return (
    <ol aria-label={ariaLabel} style={{ display: "flex", alignItems: "center", gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
      {steps.map((label, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <Fragment key={label}>
            {i > 0 && (
              <li aria-hidden style={{ flex: "0 1 24px", minWidth: 8, height: 1, background: "var(--mantine-color-default-border)" }} />
            )}
            <li
              aria-current={current ? "step" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", fontSize: 13 }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  fontSize: 11,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: done || current ? "var(--mantine-primary-color-contrast, #fff)" : "var(--mantine-color-dimmed)",
                  background: done || current ? "var(--mantine-primary-color-filled)" : "transparent",
                  border: done || current ? "none" : "1px solid var(--mantine-color-default-border)",
                }}
              >
                {done ? <IconCheck size={11} stroke={2.5} /> : i + 1}
              </span>
              <span style={{ fontWeight: current ? 500 : 400, color: current ? "var(--mantine-color-text)" : "var(--mantine-color-dimmed)" }}>
                {label}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
