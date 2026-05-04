"use client";

import { ArrowLeftIcon, ClockIcon, HelpCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/core/i18n/hooks";

const EXAMPLES: { label: string; cron: string }[] = [
  { label: "每小时执行", cron: "0 0 * * * *" },
  { label: "每天上午 9 点", cron: "0 0 9 * * *" },
  { label: "每天中午 12 点", cron: "0 0 12 * * *" },
  { label: "每天下午 6 点", cron: "0 0 18 * * *" },
  { label: "每周一上午 9 点", cron: "0 0 9 * * 1" },
  { label: "每周五下午 5 点", cron: "0 0 17 * * 5" },
  { label: "每月 1 号上午 8 点", cron: "0 0 8 1 * *" },
  { label: "每 5 分钟", cron: "0 */5 * * * *" },
  { label: "每 30 分钟", cron: "0 */30 * * * *" },
  { label: "每天凌晨 2 点", cron: "0 0 2 * * *" },
];

interface CronHelpProps {
  onBack: () => void;
}

export function CronHelp({ onBack }: CronHelpProps) {
  const { t } = useI18n();

  return (
    <Dialog open={true} onOpenChange={() => onBack()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-lg">
        {/* Accent bar */}
        <div className="h-1.5 w-full rounded-t-lg bg-gradient-to-r from-orange-400 to-amber-400" />

        <DialogHeader className="px-6 pt-5">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onBack}
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
                <HelpCircleIcon className="h-4 w-4" />
              </span>
              {t.crons.guide}
            </DialogTitle>
          </div>
          <DialogDescription className="pl-16">
            {t.crons.guideIntro}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-4">
          {/* Cron Syntax */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-orange-500/10 text-orange-500">
                <ClockIcon className="h-3.5 w-3.5" />
              </span>
              {t.crons.guideCronSyntax}
            </h3>
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                {t.crons.guideCronFormat}
              </p>
              <table className="w-full text-xs text-muted-foreground">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-1.5 pr-2 font-medium">字段</th>
                    <th className="text-left py-1.5 pr-2 font-medium">含义</th>
                    <th className="text-left py-1.5 font-medium">取值范围</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/30">
                    <td className="py-1 pr-2 font-mono">秒</td>
                    <td className="py-1 pr-2">second</td>
                    <td className="py-1 font-mono">0-59</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-1 pr-2 font-mono">分</td>
                    <td className="py-1 pr-2">minute</td>
                    <td className="py-1 font-mono">0-59</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-1 pr-2 font-mono">时</td>
                    <td className="py-1 pr-2">hour</td>
                    <td className="py-1 font-mono">0-23</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-1 pr-2 font-mono">日</td>
                    <td className="py-1 pr-2">day of month</td>
                    <td className="py-1 font-mono">1-31</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-1 pr-2 font-mono">月</td>
                    <td className="py-1 pr-2">month</td>
                    <td className="py-1 font-mono">1-12</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-2 font-mono">周</td>
                    <td className="py-1 pr-2">day of week</td>
                    <td className="py-1 font-mono">0-7 (0和7=周日)</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-muted-foreground/60 text-xs mt-3">
                特殊字符：<code className="bg-muted px-1 rounded">*</code> 任意值{" "}
                <code className="bg-muted px-1 rounded">,</code> 列举{" "}
                <code className="bg-muted px-1 rounded">-</code> 范围{" "}
                <code className="bg-muted px-1 rounded">/</code> 步进{" "}
                <code className="bg-muted px-1 rounded">?</code> 不指定
              </p>
            </div>
          </div>

          {/* Examples */}
          <div>
            <h3 className="text-sm font-semibold mb-3">{t.crons.guideExamples}</h3>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="text-left py-2 px-3 font-medium">场景</th>
                    <th className="text-left py-2 px-3 font-mono font-medium">Cron 表达式</th>
                  </tr>
                </thead>
                <tbody>
                  {EXAMPLES.map((ex) => (
                    <tr key={ex.cron} className="border-t border-border/30">
                      <td className="py-2 px-3 text-muted-foreground">{ex.label}</td>
                      <td className="py-2 px-3 font-mono">{ex.cron}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Separator />

          {/* Model note */}
          <div>
            <h3 className="text-sm font-semibold mb-2">{t.crons.model}</h3>
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t.crons.guideModelNote}
              </p>
            </div>
          </div>
        </div>

        <Separator />

        <div className="px-6 pb-5 pt-4">
          <Button variant="outline" onClick={onBack} className="w-full">
            <ArrowLeftIcon className="mr-1.5 h-4 w-4" />
            返回配置
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
