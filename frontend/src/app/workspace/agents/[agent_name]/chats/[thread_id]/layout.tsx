import { ChatProviders } from "@/components/workspace/chats/chat-providers";

export function generateStaticParams() {
  return [{ agent_name: "__init__", thread_id: "new" }];
}

export default function AgentChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ChatProviders>{children}</ChatProviders>;
}
