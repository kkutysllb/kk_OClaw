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
        <SolarSystem starCount={300} particleCount={120} />
      </div>
      <div className="container-md relative z-10 mx-auto flex h-screen flex-col items-center justify-start pt-[28vh]">
        {/* KK 商业标记 */}
        <div className="text-5xl font-black bg-gradient-to-r from-pink-500 via-red-400 via-amber-400 via-yellow-300 via-emerald-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent select-none mb-4">
          KK
        </div>
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
          <span className="bg-gradient-to-r from-cyan-300 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            就用 OClaw
          </span>
        </h1>
        <p className="text-muted-foreground mt-6 scale-105 text-center text-2xl text-shadow-sm max-w-3xl">
          一个开源的智能体编排平台，可深度研究、编写代码并创造内容。
          <br />
          由沙箱、记忆、工具、技能和子智能体驱动——
          <br />
          自主处理从数分钟到数小时不等的复杂任务。
        </p>
        <Link href="/workspace" className="group mt-14">
          <div className="relative inline-block">
            {/* Outer glow ring */}
            <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 opacity-75 blur-sm transition-all duration-500 group-hover:opacity-100 group-hover:blur-md" />
            {/* Inner glow on hover */}
            <div className="absolute -inset-2 rounded-xl bg-gradient-to-r from-cyan-400/30 via-purple-500/30 to-pink-500/30 blur-2xl opacity-0 transition-all duration-700 group-hover:opacity-100" />
            <Button
              className="relative h-12 px-10 text-lg font-semibold bg-gradient-to-r from-cyan-600 via-purple-600 to-pink-600 hover:from-cyan-500 hover:via-purple-500 hover:to-pink-500 text-white shadow-xl shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-500 hover:scale-105 rounded-xl border-0"
              size="lg"
            >
              <span className="text-md">探索平台</span>
              <ChevronRightIcon className="size-5 transition-all duration-300 group-hover:translate-x-1" />
            </Button>
          </div>
        </Link>
      </div>
    </div>
  );
}
