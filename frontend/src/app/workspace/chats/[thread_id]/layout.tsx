import { ChatProviders } from "@/components/workspace/chats/chat-providers";

export function generateStaticParams() {
  return [{ thread_id: "new" }];
}

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ChatProviders>{children}</ChatProviders>;
}
