"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, ArrowUpRight, Sparkles } from "lucide-react";
import { appRequest } from "@/lib/api-client";
import { notifyPushSettingsChanged } from "@/lib/push-onboarding-events";
import { ParticipationShell } from "./participation-shell";
import { PushOnboardingEntry } from "./push-onboarding";

export function LoginPage({
  localTestLoginAvailable = false,
  returnTo = "/",
  socialLoginAvailable = false,
  initialNotice = "",
}: {
  localTestLoginAvailable?: boolean;
  returnTo?: string;
  socialLoginAvailable?: boolean;
  initialNotice?: string;
}) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState(initialNotice);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  const gate = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  const prepared = () => {
    setFailed(false);
    setNotice("로그인 연결을 준비하고 있어요. 이용 관련 도움이 필요하면 문의하기를 이용해주세요.");
  };

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (gate.current) return;
    if (!localTestLoginAvailable) {
      prepared();
      return;
    }
    const form = event.currentTarget;
    const fields = new FormData(form);
    const controller = new AbortController();
    request.current = controller;
    gate.current = true;
    setBusy(true);
    setFailed(false);
    setNotice("");
    try {
      const result = await appRequest<{ nickname: string; redirect: string }>(
        "/api/auth/test/login",
        "POST",
        {
          username: String(fields.get("email") ?? "").trim(),
          password: String(fields.get("password") ?? ""),
        },
        controller.signal,
      );
      if (!mounted.current || controller.signal.aborted) return;
      form.reset();
      setNotice("로그인했어요. 잠시만 기다려주세요.");
      notifyPushSettingsChanged();
      router.push(
        result.redirect === "/signup"
          ? `/signup?returnTo=${encodeURIComponent(returnTo)}`
          : returnTo,
      );
      router.refresh();
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted) return;
      setFailed(true);
      setNotice(cause instanceof Error ? cause.message : "로그인하지 못했어요. 다시 시도해주세요.");
    } finally {
      gate.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <ParticipationShell advertising={false}>
      <div className="login-page">
        <div className="login-layout">
          <section className="login-card" aria-labelledby="login-title">
            <Link href="/" className="login-brand">
              <img src="/images/sliper-logo.png" alt="" />
              <span>
                sliper<b>.</b>
              </span>
            </Link>
            <h2 id="login-title">반가워요, 슬리퍼에 오신 걸 환영해요</h2>
            <p className="login-subtitle">취향 맞는 사람들과 새로운 주말을 시작해요.</p>
            <div className="auth-status">
              <Sparkles size={14} />
              {localTestLoginAvailable
                ? "로컬 테스트 계정 로그인"
                : socialLoginAvailable
                  ? "카카오·구글 계정으로 간편하게 시작하기"
                  : "로그인 연결 준비 중"}
            </div>
            {localTestLoginAvailable && (
              <form onSubmit={login} aria-busy={busy}>
                <label className="sr-only" htmlFor="login-email">
                  아이디(이메일)
                </label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="아이디(이메일)"
                  disabled={busy}
                  required
                />
                <div className="password-field">
                  <label className="sr-only" htmlFor="login-password">
                    비밀번호
                  </label>
                  <input
                    id="login-password"
                    name="password"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="비밀번호"
                    disabled={busy}
                    required
                  />
                  <button
                    type="button"
                    aria-label={show ? "비밀번호 숨기기" : "비밀번호 보기"}
                    disabled={busy}
                    onClick={() => setShow((value) => !value)}
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <button type="submit" className="login-submit" disabled={busy}>
                  {busy ? "로그인 중…" : "로그인"}
                </button>
              </form>
            )}
            <div className="login-help">
              <Link href="/help">로그인 도움말</Link>
              <span>·</span>
              <Link href="/signup">기본 정보 입력</Link>
            </div>
            <div className="login-divider">
              <span />
              간편하게 시작하기
              <span />
            </div>
            {(["kakao", "google"] as const).map((provider) =>
              socialLoginAvailable ? (
                <form key={provider} method="post" action="/api/auth/start">
                  <input type="hidden" name="provider" value={provider} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button type="submit" className={"social-login " + provider} disabled={busy}>
                    <span aria-hidden="true">{provider === "kakao" ? "●" : "G"}</span>
                    {provider === "kakao" ? "카카오로 시작하기" : "Google로 시작하기"}
                  </button>
                </form>
              ) : (
                <button
                  key={provider}
                  className={"social-login " + provider}
                  disabled={busy}
                  onClick={prepared}
                >
                  <span aria-hidden="true">{provider === "kakao" ? "●" : "G"}</span>
                  {provider === "kakao" ? "카카오로 시작하기" : "Google로 시작하기"}
                </button>
              ),
            )}
            {notice && (
              <p className="login-notice" role={failed ? "alert" : "status"}>
                {notice}
              </p>
            )}
            <Link className="login-explore" href="/">
              먼저 둘러볼게요
              <ArrowUpRight size={15} />
            </Link>
            <PushOnboardingEntry />
            <p className="login-privacy">
              {localTestLoginAvailable
                ? "테스트 계정 정보는 이 기기의 개발 환경에서만 사용돼요. 비밀번호는 해시로 보관해요."
                : "로그인 후 이용규칙과 개인정보 안내를 확인하고 기본정보를 입력할 수 있어요."}
            </p>
          </section>
        </div>
      </div>
    </ParticipationShell>
  );
}
