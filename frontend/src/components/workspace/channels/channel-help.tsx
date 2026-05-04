"use client";

import { ArrowLeftIcon, ExternalLinkIcon, MessageCircleIcon } from "lucide-react";

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

const CHANNEL_ICON_COLORS: Record<string, string> = {
  dingtalk: "bg-sky-500/10 text-sky-500",
  discord: "bg-indigo-500/10 text-indigo-500",
  feishu: "bg-blue-500/10 text-blue-500",
  slack: "bg-purple-500/10 text-purple-500",
  telegram: "bg-cyan-500/10 text-cyan-500",
  wechat: "bg-emerald-500/10 text-emerald-500",
  wecom: "bg-teal-500/10 text-teal-500",
};

const GRADIENT_COLORS: Record<string, string> = {
  dingtalk: "from-sky-400 to-blue-400",
  discord: "from-indigo-400 to-violet-400",
  feishu: "from-blue-400 to-cyan-400",
  slack: "from-purple-400 to-fuchsia-400",
  telegram: "from-cyan-400 to-sky-400",
  wechat: "from-emerald-400 to-green-400",
  wecom: "from-teal-400 to-emerald-400",
};

/** Step-by-step guide content per channel. */
const GUIDE_CONTENT: Record<string, {
  intro: string;
  steps: string[];
  links: { label: string; url: string }[];
}> = {
  dingtalk: {
    intro: "钉钉（DingTalk）是阿里巴巴集团打造的企业级智能移动办公平台。配置后用户可通过钉钉机器人或群聊与 KKOCLAW 交互。",
    steps: [
      "登录钉钉开放平台（open.dingtalk.com），创建一个企业内部应用。",
      "在「凭证与基础信息」页面获取 Client ID（AppKey）和 Client Secret（AppSecret）。",
      "在「权限管理」中配置所需权限（如群聊读写、消息收发等）。",
      "在「事件订阅」中配置回调 URL（格式：{你的域名}/api/channels/dingtalk/webhook）。",
      "将获取到的 Client ID 和 Client Secret 填入上方凭证字段。",
      "启用渠道并保存配置，重启服务后即可生效。",
    ],
    links: [
      { label: "钉钉开放平台", url: "https://open.dingtalk.com" },
      { label: "钉钉机器人文档", url: "https://open.dingtalk.com/document/orgapp/robot-overview" },
    ],
  },
  discord: {
    intro: "Discord 是全球广受欢迎的社区通讯平台。配置后可通过 Discord Bot 与 KKOCLAW 在频道或私信中对话。",
    steps: [
      "访问 Discord Developer Portal（discord.com/developers/applications），创建一个新应用。",
      "在「Bot」页面点击「Add Bot」创建机器人，获取 Bot Token。",
      "在「OAuth2 → URL Generator」中生成邀请链接，勾选 bot 和 applications.commands 权限。",
      "使用邀请链接将机器人添加到你的 Discord 服务器。",
      "在「Privileged Gateway Intents」中启用 Message Content Intent（读取消息内容）。",
      "将 Bot Token 填入上方凭证字段。",
      "启用渠道并保存配置，重启服务后即可生效。",
    ],
    links: [
      { label: "Discord Developer Portal", url: "https://discord.com/developers/applications" },
      { label: "Discord Bot 文档", url: "https://discord.com/developers/docs/intro" },
    ],
  },
  feishu: {
    intro: "飞书（Feishu/Lark）是字节跳动旗下企业协作平台，支持流式响应。配置后用户可在飞书群聊或机器人中与 KKOCLAW 对话。",
    steps: [
      "登录飞书开放平台（open.feishu.cn），创建一个企业自建应用。",
      "在「凭证与基础信息」页面获取 App ID 和 App Secret。",
      "在「权限管理」中添加所需权限：im:message、im:message.p2p_msg、im:message.group_msg 等。",
      "在「事件订阅」中配置请求 URL（格式：{你的域名}/api/channels/feishu/webhook），并订阅 im.message.receive_v1 事件。",
      "发布应用并获取管理员审批。",
      "将 App ID 和 App Secret 填入上方凭证字段。",
      "启用渠道并保存配置，重启服务后即可生效。",
    ],
    links: [
      { label: "飞书开放平台", url: "https://open.feishu.cn" },
      { label: "飞书机器人开发指南", url: "https://open.feishu.cn/document/home/develop-a-bot-in-5-minutes" },
    ],
  },
  slack: {
    intro: "Slack 是全球流行的团队沟通工具。配置后可通过 Slack Bot 与 KKOCLAW 在频道或私信中对话。",
    steps: [
      "访问 Slack API 控制台（api.slack.com/apps），创建一个新应用。",
      "选择「From scratch」，输入应用名称并选择工作区。",
      "在「OAuth & Permissions」页面，添加 Bot Token Scopes：chat:write、channels:history、groups:history、im:history、mpim:history。",
      "安装应用到工作区，获取 Bot User OAuth Token。",
      "在「Socket Mode」页面启用 Socket Mode，生成 App-Level Token（类型为 connections:write）。",
      "在「Event Subscriptions」页面启用事件订阅（如使用 HTTP 模式），配置 Request URL。",
      "将 Bot Token 和 App Token 填入上方凭证字段。",
      "启用渠道并保存配置，重启服务后即可生效。",
    ],
    links: [
      { label: "Slack API 控制台", url: "https://api.slack.com/apps" },
      { label: "Slack Bot 文档", url: "https://api.slack.com/bot-users" },
    ],
  },
  telegram: {
    intro: "Telegram 是注重隐私与速度的即时通讯平台。配置后用户可通过 Telegram Bot 与 KKOCLAW 对话。",
    steps: [
      "在 Telegram 中搜索 @BotFather 并发送 /newbot 命令创建机器人。",
      "按提示设置机器人名称（显示名）和用户名（必须以 bot 结尾）。",
      "创建成功后 @BotFather 会返回 HTTP API Token（Bot Token）。",
      "（可选）发送 /setprivacy 到 @BotFather 设置机器人的隐私模式。",
      "（可选）发送 /setcommands 到 @BotFather 设置机器人的命令列表。",
      "将 Bot Token 填入上方凭证字段。",
      "启用渠道并保存配置，重启服务后即可生效。",
    ],
    links: [
      { label: "Telegram Bot API 文档", url: "https://core.telegram.org/bots/api" },
      { label: "BotFather 使用指南", url: "https://core.telegram.org/bots#6-botfather" },
    ],
  },
  wechat: {
    intro: "微信（WeChat）是中国最广泛使用的即时通讯平台。配置后用户可通过微信公众号或企业微信与 KKOCLAW 交互。",
    steps: [
      "登录微信公众平台（mp.weixin.qq.com），注册并认证一个公众号（服务号或订阅号）。",
      "在「开发 → 基本配置」页面获取 AppID 和 AppSecret，并配置服务器 URL 和 Token。",
      "在「设置与开发 → 接口权限」中申请所需接口权限。",
      "将公众号的 Token 填入上方凭证字段。",
      "配置服务器地址（URL）指向你的 KKOCLAW 实例。",
      "启用渠道并保存配置，重启服务后即可生效。",
    ],
    links: [
      { label: "微信公众平台", url: "https://mp.weixin.qq.com" },
      { label: "微信公众平台开发文档", url: "https://developers.weixin.qq.com/doc/offiaccount/Getting_Started/Overview.html" },
    ],
  },
  wecom: {
    intro: "企业微信（WeCom）是腾讯推出的专业企业通讯与办公平台。配置后用户可通过企业微信机器人或应用与 KKOCLAW 交互，支持流式响应。",
    steps: [
      "登录企业微信管理后台（work.weixin.qq.com），进入「应用管理」页面。",
      "创建一个自建应用或在已有应用中配置机器人。",
      "在应用详情页获取 Bot ID（AgentId）和 Bot Secret（Secret）。",
      "在「接收消息」中配置回调 URL（格式：{你的域名}/api/channels/wecom/webhook）。",
      "在「企业可信 IP」中配置服务器 IP 白名单。",
      "将 Bot ID 和 Bot Secret 填入上方凭证字段。",
      "启用渠道并保存配置，重启服务后即可生效。",
    ],
    links: [
      { label: "企业微信管理后台", url: "https://work.weixin.qq.com" },
      { label: "企业微信开发者文档", url: "https://developer.work.weixin.qq.com/document" },
    ],
  },
};

interface ChannelHelpProps {
  name: string;
  displayName: string;
  credentialKeys: string[];
  onBack: () => void;
}

export function ChannelHelp({
  name,
  displayName,
  credentialKeys,
  onBack,
}: ChannelHelpProps) {
  const { t } = useI18n();

  const guide = GUIDE_CONTENT[name];
  const iconColor =
    CHANNEL_ICON_COLORS[name] ?? "bg-violet-500/10 text-violet-500";
  const gradient =
    GRADIENT_COLORS[name] ?? "from-violet-400 to-purple-400";

  if (!guide) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <p className="text-muted-foreground text-sm">暂无该渠道的帮助文档</p>
        <Button variant="outline" onClick={onBack}>
          <ArrowLeftIcon className="mr-1.5 h-4 w-4" />
          返回配置
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={true} onOpenChange={() => onBack()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-lg">
        {/* Accent bar */}
        <div className={`h-1.5 w-full rounded-t-lg bg-gradient-to-r ${gradient}`} />

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
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconColor}`}>
                <MessageCircleIcon className="h-4 w-4" />
              </span>
              {displayName} — {t.channels.guide}
            </DialogTitle>
          </div>
          <DialogDescription className="pl-16">
            {guide.intro}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-4">
          {/* Configuration Steps */}
          <div>
            <h3 className="text-sm font-semibold mb-3">配置步骤</h3>
            <ol className="space-y-3">
              {guide.steps.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="text-sm text-muted-foreground leading-relaxed">
                    {step}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <Separator />

          {/* Credential Fields Reference */}
          {credentialKeys.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">需要配置的凭证</h3>
              <div className="space-y-1.5">
                {credentialKeys.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2"
                  >
                    <span className="text-sm font-mono">{key}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Related Links */}
          {guide.links.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">相关链接</h3>
              <div className="space-y-1.5">
                {guide.links.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-2 text-sm text-violet-500 hover:bg-muted/50 transition-colors"
                  >
                    <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
                    <span>{link.label}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
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
