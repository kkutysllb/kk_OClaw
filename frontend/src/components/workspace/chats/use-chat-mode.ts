import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { useI18n } from "@/core/i18n/hooks";

/**
 * Extract the thread_id segment from a workspace chat URL.
 *
 * See ``use-thread-chat.ts`` for why we parse from ``usePathname()`` rather
 * than ``useParams()`` in the Electron desktop static-export build.
 */
function parseThreadIdFromPath(pathname: string | null): string {
  if (!pathname) return "new";
  const match = pathname.match(/\/chats\/([^/?#]+)/);
  const raw = match?.[1];
  if (!raw) return "new";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Hook to determine if the chat is in a specific mode based on URL parameters, and to set an initial prompt input value accordingly.
 */
export function useSpecificChatMode() {
  const { t } = useI18n();
  const pathname = usePathname();
  const threadIdFromPath = parseThreadIdFromPath(pathname);
  const searchParams = useSearchParams();
  const promptInputController = usePromptInputController();
  const inputInitialValue = useMemo(() => {
    if (threadIdFromPath !== "new") {
      return undefined;
    }
    const mode = searchParams.get("mode");
    if (mode === "skill") {
      return t.inputBox.createSkillPrompt;
    }
    if (mode === "cron") {
      return t.inputBox.createCronPrompt;
    }
    return undefined;
  }, [threadIdFromPath, searchParams, t.inputBox.createSkillPrompt, t.inputBox.createCronPrompt]);
  const lastInitialValueRef = useRef<string | undefined>(undefined);
  const setInputRef = useRef(promptInputController.textInput.setInput);
  setInputRef.current = promptInputController.textInput.setInput;
  useEffect(() => {
    if (
      inputInitialValue &&
      inputInitialValue !== lastInitialValueRef.current
    ) {
      lastInitialValueRef.current = inputInitialValue;
      setTimeout(() => {
        setInputRef.current(inputInitialValue);
        const textarea = document.querySelector("textarea");
        if (textarea) {
          textarea.focus();
          textarea.selectionStart = textarea.value.length;
          textarea.selectionEnd = textarea.value.length;
        }
      }, 100);
    }
  }, [inputInitialValue]);
}
