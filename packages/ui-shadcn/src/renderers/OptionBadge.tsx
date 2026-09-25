import type { Option } from "../internal/core-contracts";
import { optionToneStyle } from "../internal/options";
import { SG_ROOT, cn } from "../lib/cn";
import { Badge } from "../ui/badge";

/** A tone badge for a single select option (optional 8px dot). Renders nothing for an unknown/empty option. */
export function OptionBadge({ option, dot = false, className }: { option: Option | undefined; dot?: boolean; className?: string }) {
  if (!option) return null;
  return (
    <Badge variant="tone" style={optionToneStyle(option)} className={cn(SG_ROOT, "sg:max-w-full sg:cursor-default", className)}>
      {dot ? (
        <span aria-hidden data-testid="option-color-dot" className="sg:size-2 sg:shrink-0 sg:rounded-full sg:bg-[var(--sg-tone-dot)]" />
      ) : null}
      <span className="sg:truncate">{option.label}</span>
    </Badge>
  );
}
