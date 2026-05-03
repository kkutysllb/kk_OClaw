"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import SolarSystem from "@/components/ui/solar-system";
import { WordRotate } from "@/components/ui/word-rotate";
import { cn } from "@/lib/utils";

export function Hero({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-full flex-col items-center justify-center",
        className,
      )}
    >
      <div className="absolute inset-0 z-0">
        <SolarSystem starCount={180} particleCount={50} />
      </div>
      <div className="container-md relative z-10 mx-auto flex h-screen flex-col items-center justify-start pt-[52vh]">
        <h1 className="flex flex-wrap items-center justify-center gap-2 text-4xl font-bold md:text-6xl">
          <WordRotate
            words={[
              "深度研究",
              "采集数据",
              "分析数据",
              "生成网页",
              "氛围编程",
              "制作幻灯片",
              "生成图像",
              "生成播客",
              "生成视频",
              "创作歌曲",
              "整理邮件",
              "做任何事",
              "学任何东西",
            ]}
          />{" "}
          <div className="bg-gradient-to-r from-cyan-300 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            就用 KKOCLAW
          </div>
        </h1>
        <p className="text-muted-foreground mt-8 scale-105 text-center text-2xl text-shadow-sm max-w-3xl">
          一个开源的智能体编排平台，可深度研究、编写代码并创造内容。
          <br />
          由沙箱、记忆、工具、技能和子智能体驱动——
          <br />
          自主处理从数分钟到数小时不等的复杂任务。
        </p>
        <Link href="/workspace">
          <Button className="size-lg mt-8 scale-108" size="lg">
            <span className="text-md">探索平台</span>
            <ChevronRightIcon className="size-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
