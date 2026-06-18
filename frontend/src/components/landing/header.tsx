import { GitHubLogoIcon } from "@radix-ui/react-icons";

import { cn } from "@/lib/utils";

export type HeaderProps = {
  className?: string;
  homeURL?: string;
};

export async function Header({ className, homeURL }: HeaderProps) {
  return (
    <header
      className={cn(
        "container-md fixed top-0 right-0 left-0 z-20 mx-auto flex h-16 items-center justify-between backdrop-blur-xs",
        className,
      )}
    >
      <div className="flex items-center gap-6">
        <a href={homeURL ?? "/"}>
          <h1 className="font-serif text-xl">
            <span className="bg-gradient-to-r from-pink-500 via-amber-400 via-yellow-300 to-cyan-400 bg-clip-text text-transparent font-extrabold tracking-wider">
              KK
            </span>
            <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              OClaw
            </span>
          </h1>
        </a>
      </div>
      <nav className="mr-8 ml-auto flex items-center gap-8 text-sm font-medium">
        <a
          href="https://github.com/kkutysllb/kk_OClaw"
          target="_blank"
          rel="noopener noreferrer"
          className="text-secondary-foreground hover:text-foreground transition-colors"
        >
          Docs
        </a>
        <a
          href="https://github.com/kkutysllb/kk_OClaw"
          target="_blank"
          rel="noopener noreferrer"
          className="text-secondary-foreground hover:text-foreground transition-colors"
        >
          <GitHubLogoIcon className="size-5" />
        </a>
      </nav>
      <hr className="from-border/0 via-border/70 to-border/0 absolute top-16 right-0 left-0 z-10 m-0 h-px w-full border-none bg-linear-to-r" />
    </header>
  );
}
