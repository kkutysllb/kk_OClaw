"use client";

import { XIcon } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  Suggestion,
  Suggestions,
} from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

/**
 * Follow-up suggestions panel state & wiring.
 *
 * Historically the follow-up suggestions were rendered inside <InputBox/>,
 * directly above the prompt input. Because <InputBox/> lives in the page's
 * `absolute bottom-0 z-30` floating container, the suggestions panel floated
 * over the message list and crowded the input area — making it hard for users
 * to continue typing.
 *
 * This context decouples the **data/logic** (owned by InputBox, which has
 * access to the thread stream, fetch logic and prompt-input controller) from
 * the **rendering** (owned by MessageList, which renders the panel as the last
 * element of the conversation flow). The panel is now "anchored" to the page
 * content instead of floating over it.
 */
export interface FollowupsData {
  suggestions: string[];
  loading: boolean;
}

interface FollowupsContextValue {
  data: FollowupsData;
  hidden: boolean;
  setData: (data: FollowupsData) => void;
  setHidden: (hidden: boolean) => void;
  /** Clear suggestions + reset hidden flag (e.g. when sending a new message). */
  reset: () => void;
  /** Invoke the registered click handler (fills the prompt input & submits). */
  clickSuggestion: (suggestion: string) => void;
  /** InputBox registers its click handler here so the panel can trigger it. */
  registerClickHandler: (handler: (suggestion: string) => void) => void;
}

const FollowupsContext = createContext<FollowupsContextValue | null>(null);

export function FollowupsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<FollowupsData>({
    suggestions: [],
    loading: false,
  });
  const [hidden, setHidden] = useState(false);
  const clickHandlerRef = useRef<((suggestion: string) => void) | null>(null);

  const registerClickHandler = useCallback(
    (handler: (suggestion: string) => void) => {
      clickHandlerRef.current = handler;
    },
    [],
  );

  const clickSuggestion = useCallback((suggestion: string) => {
    clickHandlerRef.current?.(suggestion);
  }, []);

  const reset = useCallback(() => {
    setData({ suggestions: [], loading: false });
    setHidden(false);
  }, []);

  // Memoize the context value so consumers don't re-render every time the
  // Provider re-renders. Without this, `{...}` creates a new object reference
  // on every render, which — combined with InputBox's useEffect that syncs
  // data back into the context — triggers an infinite update loop.
  const value = useMemo<FollowupsContextValue>(
    () => ({
      data,
      hidden,
      setData,
      setHidden,
      reset,
      clickSuggestion,
      registerClickHandler,
    }),
    [
      data,
      hidden,
      reset,
      clickSuggestion,
      registerClickHandler,
    ],
  );

  return (
    <FollowupsContext.Provider value={value}>
      {children}
    </FollowupsContext.Provider>
  );
}

export function useFollowupsContext() {
  const ctx = useContext(FollowupsContext);
  if (!ctx) {
    throw new Error(
      "useFollowupsContext must be used within a FollowupsProvider",
    );
  }
  return ctx;
}

/**
 * Pure presentation component that renders the follow-up suggestions panel.
 * Intended to be placed at the end of the message list so the suggestions
 * become part of the conversation flow rather than a floating overlay above
 * the input box.
 */
export function FollowupPanel({ className }: { className?: string }) {
  const { t } = useI18n();
  const { data, hidden, setHidden, clickSuggestion } = useFollowupsContext();

  if (hidden) {
    return null;
  }

  if (data.loading) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="text-muted-foreground bg-background/80 rounded-full border px-4 py-2 text-xs backdrop-blur-sm">
          {t.inputBox.followupLoading}
        </div>
      </div>
    );
  }

  if (data.suggestions.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Suggestions className="min-h-16 w-fit items-start">
        {data.suggestions.map((s) => (
          <Suggestion
            key={s}
            suggestion={s}
            onClick={() => clickSuggestion(s)}
          />
        ))}
        <Button
          aria-label={t.common.close}
          className="text-muted-foreground cursor-pointer rounded-full px-3 text-xs font-normal"
          variant="outline"
          size="sm"
          type="button"
          onClick={() => setHidden(true)}
        >
          <XIcon className="size-4" />
        </Button>
      </Suggestions>
    </div>
  );
}
