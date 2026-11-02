"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { appRequest } from "@/lib/api-client";
import { notifyPushSettingsChanged } from "@/lib/push-onboarding-events";

import { useSession } from "./session-provider";

export function TestAccountControls({ fallbackLogin = false }: { fallbackLogin?: boolean }) {
  const router = useRouter();
  const { session, clearSession } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const gate = useRef(false);
  const logoutRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      logoutRequest.current?.abort();
    };
  }, []);

  async function logout() {
    if (gate.current) return;
    gate.current = true;
    const controller = new AbortController();
    logoutRequest.current = controller;
    setBusy(true);
    setError("");
    try {
      await appRequest("/api/auth/logout", "POST", {}, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      clearSession();
      notifyPushSettingsChanged();
      router.push("/login");
      router.refresh();
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted) return;
      setError(
        cause instanceof Error ? cause.message : "로그아웃하지 못했어요. 다시 시도해주세요.",
      );
    } finally {
      gate.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!session?.available)
    return fallbackLogin ? (
      <Link className="login-link" href="/login">
        로그인
      </Link>
    ) : null;
  if (session.restricted)
    return (
      <Link className="login-link" href="/settings/account">
        계정 상태 확인
      </Link>
    );
  if (!session.authenticated)
    return (
      <Link className="login-link" href="/login">
        {session.restricted
          ? "계정 상태 확인"
          : session.mode === "supabase"
            ? "로그인"
            : "테스트 계정으로 로그인"}
      </Link>
    );

  return (
    <div className="account-controls flex flex-wrap items-center gap-2 text-xs text-slate-500">
      {session.role && (
        <Link href="/admin" className="text-blue-600">
          운영
        </Link>
      )}
      <span className="account-control-name max-w-40 truncate text-slate-700">
        {session.nickname ?? "테스트 회원"}
      </span>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="account-logout inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-blue-200 hover:text-blue-600 disabled:opacity-50"
      >
        <LogOut size={13} />
        {busy ? "로그아웃 중…" : "로그아웃"}
      </button>
      {error && (
        <p className="basis-full text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
