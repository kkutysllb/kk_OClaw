"use client";

import { LogOutIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetch, getCsrfHeaders } from "@/core/api/fetcher";
import { useAuth } from "@/core/auth/AuthProvider";
import { parseAuthError } from "@/core/auth/types";

import { SettingsSection } from "./settings-section";

export function AccountSettingsPage() {
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError("两次密码不一致");
      return;
    }
    if (newPassword.length < 8) {
      setError("密码长度不能少于8位");
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
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        const authError = parseAuthError(data);
        setError(authError.message);
        return;
      }

      setMessage("密码修改成功");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("网络错误，请重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection title="个人资料">
        <div className="space-y-2">
          <div className="grid grid-cols-[max-content_max-content] items-center gap-4">
            <span className="text-muted-foreground text-sm">邮箱</span>
            <span className="text-sm font-medium">{user?.email ?? "—"}</span>
            <span className="text-muted-foreground text-sm">角色</span>
            <span className="text-sm font-medium capitalize">
              {user?.system_role ?? "—"}
            </span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="修改密码"
        description="更新您的账户密码。"
      >
        <form onSubmit={handleChangePassword} className="max-w-sm space-y-3">
          <Input
            type="password"
            placeholder="当前密码"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="新密码"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
          <Input
            type="password"
            placeholder="确认新密码"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          {message && <p className="text-sm text-green-500">{message}</p>}
          <Button type="submit" variant="outline" size="sm" disabled={loading}>
            {loading ? "更新中…" : "更新密码"}
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection title="" description="">
        <Button
          variant="destructive"
          size="sm"
          onClick={logout}
          className="gap-2"
        >
          <LogOutIcon className="size-4" />
          退出登录
        </Button>
      </SettingsSection>
    </div>
  );
}
