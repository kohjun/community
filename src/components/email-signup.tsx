"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { loginHref } from "@/domain/login-return";
import { appRequest } from "@/lib/api-client";
import { notifyPushSettingsChanged } from "@/lib/push-onboarding-events";
import { ParticipationShell } from "./participation-shell";

type SignupResult =
  { status: "confirmation_required" } | { status: "authenticated"; redirect: string };

export function EmailSignup({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [error, setError] = useState("");
  const login = loginHref(returnTo);

  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get("password") ?? "");
    if (password !== fields.get("confirmPassword")) {
      setError("비밀번호 확인이 일치하지 않아요.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await appRequest<SignupResult>(
        "/api/auth/password",
        "POST",
        { action: "signup", email: fields.get("email"), password, returnTo },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (result.status === "confirmation_required") {
        setConfirmationRequired(true);
      } else {
        notifyPushSettingsChanged();
        router.push(result.redirect);
        router.refresh();
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "회원가입을 완료하지 못했어요.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <ParticipationShell advertising={false}>
      <section className="profile-onboarding" aria-labelledby="email-signup-title">
        <h1 id="email-signup-title">
          {confirmationRequired ? "메일함을 확인해주세요" : "이메일로 회원가입"}
        </h1>
        {confirmationRequired ? (
          <div className="onboarding-guest" role="status">
            <p>
              가입 가능한 이메일이라면 확인 링크를 보내드려요. 링크를 열어 인증한 뒤 닉네임과
              연락처를 입력하면 가입이 끝나요.
            </p>
            <p>이미 계정이 있거나 다른 기기에서 이메일을 확인했다면 로그인 화면을 이용해주세요.</p>
            <Link className="account-primary" href={login}>
              로그인으로 이동
            </Link>
          </div>
        ) : (
          <>
            <p className="onboarding-subtitle">
              이메일을 로그인 아이디로 사용해요. 이메일 확인 후 기본정보를 입력해주세요.
            </p>
            <form className="email-signup-form" method="post" onSubmit={submit} aria-busy={busy}>
              <fieldset disabled={busy}>
                <label className="onboarding-field">
                  이메일 아이디
                  <input
                    name="email"
                    type="email"
                    autoComplete="username"
                    maxLength={254}
                    required
                  />
                </label>
                <label className="onboarding-field">
                  비밀번호
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={72}
                    required
                  />
                  <small>8자 이상 입력해주세요.</small>
                </label>
                <label className="onboarding-field">
                  비밀번호 확인
                  <input
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </label>
                {error && (
                  <p className="onboarding-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="login-submit" type="submit">
                  {busy ? "가입 요청 중…" : "이메일 확인하기"}
                </button>
              </fieldset>
            </form>
            <div className="login-help">
              <Link href={login}>이미 계정이 있거나 카카오·구글로 가입하시나요?</Link>
            </div>
          </>
        )}
      </section>
    </ParticipationShell>
  );
}
