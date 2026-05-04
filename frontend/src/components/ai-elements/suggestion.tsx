"use client";

import type { LucideIcon } from "lucide-react";
import { Children, type ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const STAGGER_DELAY_MS = 60;
const STAGGER_DELAY_MS_OFFSET = 250;

/** Color theme for a suggestion tag */
export interface SuggestionColorTheme {
  /** Background class, e.g. "bg-orange-500/10" */
  bg: string;
  /** Text color class, e.g. "text-orange-600" */
  text: string;
  /** Icon color class, e.g. "text-orange-500" */
  icon: string;
  /** Border class, e.g. "border-orange-500/20" */
  border: string;
  /** Hover background class */
  hoverBg: string;
}

export type SuggestionsProps = ComponentProps<typeof ScrollArea>;

export const Suggestions = ({
  className,
  children,
  ...props
}: SuggestionsProps) => (
  <ScrollArea className="overflow-x-auto whitespace-normal" {...props}>
    <div
      className={cn("flex w-full flex-wrap items-center gap-2", className)}
      data-slot="suggestions-list"
    >
      {Children.map(children, (child, index) =>
        child != null ? (
          <span
            className="animate-fade-in-up max-w-full opacity-0"
            style={{
              animationDelay: `${STAGGER_DELAY_MS_OFFSET + index * STAGGER_DELAY_MS}ms`,
            }}
          >
            {child}
          </span>
        ) : (
          child
        ),
      )}
    </div>
    <ScrollBar className="hidden" orientation="horizontal" />
  </ScrollArea>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: React.ReactNode;
  icon?: LucideIcon;
  onClick?: () => void;
  /** Optional color theme — when provided, renders as a colorful tag */
  colorTheme?: SuggestionColorTheme;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  icon: Icon,
  variant = "outline",
  size = "sm",
  colorTheme,
  children,
  ...props
}: SuggestionProps) => {
  const handleClick = () => {
    onClick?.();
  };

  // When a colorTheme is provided, use colorful tag style
  if (colorTheme) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-medium transition-all duration-200 cursor-pointer whitespace-nowrap",
          "hover:-translate-y-0.5 hover:shadow-md",
          colorTheme.bg,
          colorTheme.text,
          colorTheme.border,
          `hover:${colorTheme.hoverBg}`,
          className,
        )}
      >
        {Icon && <Icon className={cn("size-4", colorTheme.icon)} />}
        {children ?? suggestion}
      </button>
    );
  }

  // Fallback: original muted style
  return (
    <Button
      className={cn(
        "text-muted-foreground dark:bg-background h-auto max-w-full cursor-pointer rounded-full px-4 py-2 text-center text-xs font-normal whitespace-normal",
        className,
      )}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {Icon && <Icon className="size-4" />}
      {children ?? suggestion}
    </Button>
  );
};
