"use client";

import type { ReactNode } from "react";

import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ArtifactsProvider } from "@/components/workspace/artifacts";

export function ChatProviders({ children }: { children: ReactNode }) {
  return (
    <PromptInputProvider>
      <ArtifactsProvider>{children}</ArtifactsProvider>
    </PromptInputProvider>
  );
}
