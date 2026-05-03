"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import Galaxy from "@/components/ui/galaxy";
import { Input } from "@/components/ui/input";
import { ShineBorder } from "@/components/ui/shine-border";
import SpotlightCard from "@/components/ui/spotlight-card";
import { getCsrfHeaders } from "@/core/api/fetcher";
import { useAuth } from "@/core/auth/AuthProvider";
import { parseAuthError } from "@/core/auth/types";

type SetupMode = "loading" | "init_admin" | "change_password";

export default function SetupPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [mode, setMode] = useState<SetupMode>("loading");

  // --- Shared state ---
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // --- Change-password mode only ---
  const [currentPassword, setCurrentPassword] = useState("");

  useEffect(() => {
    let cancelled = false;

    if (isAuthenticated && user?.needs_setup) {
      setMode("change_password");
    } else if (!isAuthenticated) {
      // Check if the system has no users yet
      void fetch("/api/v1/auth/setup-status")
        .then((r) => r.json())
        .then((data: { needs_setup?: boolean }) => {
          if (cancelled) return;
          if (data.needs_setup) {
            setMode("init_admin");
          } else {
            // System already set up and user is not logged in — go to login
            router.push("/login");
          }
        })
        .catch(() => {
          if (!cancelled) router.push("/login");
        });
    } else {
      // Authenticated but needs_setup is false — already set up
      router.push("/workspace");
    }

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, router]);

  // ── Init-admin handler ─────────────────────────────────────────────
  const handleInitAdmin = async (e: React.SubmitEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password: newPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        const authError = parseAuthError(data);
        setError(authError.message);
        return;
      }

      router.push("/workspace");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Change-password handler ────────────────────────────────────────
  const handleChangePassword = async (e: React.SubmitEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCsrfHeaders(),
        },
        credentials: "include",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          new_email: email || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        const authError = parseAuthError(data);
        setError(authError.message);
        return;
      }

      router.push("/workspace");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (mode === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  // ── Admin initialization form ──────────────────────────────────────
  if (mode === "init_admin") {
    return (
      <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0 bg-black/50">
          <Galaxy
            mouseRepulsion={false}
            starSpeed={0.2}
            density={0.6}
            glowIntensity={0.35}
            twinkleIntensity={0.3}
            speed={0.5}
          />
        </div>
        <FlickeringGrid
          className="absolute inset-0 z-10 opacity-20"
          squareSize={4}
          gridGap={4}
          color="#6366f1"
          maxOpacity={0.1}
          flickerChance={0.12}
        />
        <div className="absolute top-1/4 left-1/4 size-96 rounded-full bg-purple-500/20 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 size-96 rounded-full bg-cyan-500/20 blur-[120px]" />
        <div className="relative z-20 w-full max-w-md">
          <div className="relative overflow-hidden rounded-3xl">
            <ShineBorder
              borderWidth={2}
              duration={10}
              shineColor={["#06b6d4", "#a855f7", "#ec4899"]}
            />
            <SpotlightCard
              className="border-border/40 bg-background/70 space-y-6 rounded-3xl border p-8 backdrop-blur-xl"
              spotlightColor="rgba(168, 85, 247, 0.15)"
            >
          <div className="text-center">
            <h1 className="bg-linear-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-4xl font-bold text-transparent">
              KKOCLAW
            </h1>
            <p className="text-muted-foreground mt-2">Create admin account</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Set up the administrator account to get started.
            </p>
          </div>
          <form onSubmit={handleInitAdmin} className="space-y-2">
            <div className="flex flex-col space-y-1">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-border/50 focus:border-purple-500/50 transition-colors"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Password (min. 8 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="border-border/50 focus:border-purple-500/50 transition-colors"
              />
            </div>
            <div className="flex flex-col space-y-1">
              <label htmlFor="confirmPassword" className="text-sm font-medium">
                Confirm Password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="border-border/50 focus:border-purple-500/50 transition-colors"
              />
            </div>
            {error && <p className="ms-1 text-sm text-red-400">{error}</p>}
            <div className="relative group">
              <div className="absolute -inset-1 bg-linear-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-xl blur opacity-60 group-hover:opacity-100 transition duration-500" />
              <Button
                type="submit"
                className="relative w-full bg-linear-to-r from-cyan-600 via-purple-600 to-pink-600 hover:from-cyan-700 hover:via-purple-700 hover:to-pink-700 text-white shadow-lg shadow-purple-500/25 transition-all duration-300"
                disabled={loading}
              >
                {loading ? "Creating account…" : "Create Admin Account"}
              </Button>
            </div>
          </form>
            </SpotlightCard>
          </div>
        </div>
      </div>
    );
  }

  // ── Change-password form (needs_setup after login) ─────────────────
  return (
    <div className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden">
      <div className="absolute inset-0 z-0 bg-black/50">
        <Galaxy
          mouseRepulsion={false}
          starSpeed={0.2}
          density={0.6}
          glowIntensity={0.35}
          twinkleIntensity={0.3}
          speed={0.5}
        />
      </div>
      <FlickeringGrid
        className="absolute inset-0 z-10 opacity-20"
        squareSize={4}
        gridGap={4}
        color="#6366f1"
        maxOpacity={0.1}
        flickerChance={0.12}
      />
      <div className="absolute top-1/4 left-1/4 size-96 rounded-full bg-purple-500/20 blur-[120px]" />
      <div className="absolute bottom-1/4 right-1/4 size-96 rounded-full bg-cyan-500/20 blur-[120px]" />
      <div className="relative z-20 w-full max-w-md">
        <div className="relative overflow-hidden rounded-3xl">
          <ShineBorder
            borderWidth={2}
            duration={10}
            shineColor={["#06b6d4", "#a855f7", "#ec4899"]}
          />
          <SpotlightCard
            className="border-border/40 bg-background/70 space-y-6 rounded-3xl border p-8 backdrop-blur-xl"
            spotlightColor="rgba(168, 85, 247, 0.15)"
          >
        <div className="text-center">
          <h1 className="bg-linear-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-4xl font-bold text-transparent">
            KKOCLAW
          </h1>
          <p className="text-muted-foreground mt-2">
            Complete admin account setup
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Set your real email and a new password.
          </p>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <Input
            type="email"
            placeholder="Your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border-border/50 focus:border-purple-500/50 transition-colors"
          />
          <Input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="border-border/50 focus:border-purple-500/50 transition-colors"
          />
          <Input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="border-border/50 focus:border-purple-500/50 transition-colors"
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className="border-border/50 focus:border-purple-500/50 transition-colors"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="relative group">
            <div className="absolute -inset-1 bg-linear-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-xl blur opacity-60 group-hover:opacity-100 transition duration-500" />
            <Button
              type="submit"
              className="relative w-full bg-linear-to-r from-cyan-600 via-purple-600 to-pink-600 hover:from-cyan-700 hover:via-purple-700 hover:to-pink-700 text-white shadow-lg shadow-purple-500/25 transition-all duration-300"
              disabled={loading}
            >
              {loading ? "Setting up…" : "Complete Setup"}
            </Button>
          </div>
        </form>
          </SpotlightCard>
        </div>
      </div>
    </div>
  );
}
