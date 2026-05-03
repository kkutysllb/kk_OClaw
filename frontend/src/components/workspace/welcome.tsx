"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { AuroraText } from "../ui/aurora-text";

let waved = false;

export function Welcome({
  className,
  mode,
}: {
  className?: string;
  mode?: "ultra" | "pro" | "thinking" | "flash";
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const isUltra = useMemo(() => mode === "ultra", [mode]);
  const colors = useMemo(() => {
    if (isUltra) {
      return ["#efefbb", "#e9c665", "#e3a812"];
    }
    return ["#22d3ee", "#a855f7", "#ec4899"];
  }, [isUltra]);
  useEffect(() => {
    waved = true;
  }, []);
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col items-center justify-center gap-2 px-8 py-8 text-center",
        className,
      )}
    >
      <div className="relative">
        {/* Background glow */}
        <div className="absolute -inset-8 rounded-full bg-purple-500/15 blur-3xl" />
        <div className="relative text-2xl font-bold">
        {searchParams.get("mode") === "skill" ? (
          <span className="bg-linear-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-transparent">
            ✨ {t.welcome.createYourOwnSkill} ✨
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <div className={cn("inline-block text-3xl", !waved ? "animate-bounce" : "")}>
              {isUltra ? "🚀" : "👋"}
            </div>
            <AuroraText colors={isUltra ? ["#efefbb", "#e9c665", "#e3a812"] : ["#a78bfa", "#6366f1", "#3b82f6"]}>
              {t.welcome.greeting}
            </AuroraText>
          </div>
        )}
      </div>
      </div>
      {searchParams.get("mode") === "skill" ? (
        <div className="text-muted-foreground text-sm">
          {t.welcome.createYourOwnSkillDescription.includes("\n") ? (
            <pre className="font-sans whitespace-pre">
              {t.welcome.createYourOwnSkillDescription}
            </pre>
          ) : (
            <p>{t.welcome.createYourOwnSkillDescription}</p>
          )}
        </div>
      ) : (
        <div className="text-muted-foreground text-sm">
          {t.welcome.description.includes("\n") ? (
            <pre className="font-sans whitespace-pre">
              {t.welcome.description}
            </pre>
          ) : (
            <p>{t.welcome.description}</p>
          )}
        </div>
      )}
    </div>
  );
}
