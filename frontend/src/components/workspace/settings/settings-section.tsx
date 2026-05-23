import { cn } from "@/lib/utils";

export function SettingsSection({
  className,
  title,
  description,
  icon,
  children,
}: {
  className?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={cn(className)}>
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-lg font-semibold">
          {icon}
          {title}
        </div>
        {description && (
          <div className="text-muted-foreground text-sm">{description}</div>
        )}
      </header>
      <main className="mt-4">{children}</main>
    </section>
  );
}
