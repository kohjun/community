"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ShieldCheck, UserRound, ArrowRight } from "lucide-react";
import type { MyProfile, ProfileAgeBand, ProfileGender } from "@/domain/profile";
import { isProfileReadyForApplication, safeProfileReturnTo } from "@/domain/profile";
import { onboardingInputSchema } from "@/domain/validation";
import { CATEGORIES } from "@/domain/categories";
import { communityRequest } from "@/lib/api-client";
import { Button } from "./ui/button";
import { ParticipationShell } from "./participation-shell";

export function ProfileOnboarding({
  initial,
  returnTo = "/mypage",
}: {
  initial: MyProfile;
  returnTo?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    nickname: initial.nickname,
    phoneNumber: initial.phoneNumber ?? "",
    region: initial.region,
    ageBand: initial.ageBand,
    gender: initial.gender,
    interests: initial.interests,
    consent: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const gate = useRef(false);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  const ready = isProfileReadyForApplication(initial);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (gate.current) return;
    const parsed = onboardingInputSchema.safeParse({
      ...draft,
      bio: initial.bio,
      avatar: initial.avatar,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "입력한 정보를 확인해주세요.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      await communityRequest<MyProfile>("/me/onboarding", "POST", parsed.data, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      router.push(safeProfileReturnTo(returnTo));
      router.refresh();
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "기본정보를 저장하지 못했어요.");
    } finally {
      gate.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <ParticipationShell advertising={false}>
      <section className="profile-onboarding" aria-labelledby="onboarding-title">
        <div className="onboarding-brand">
          <UserRound size={19} />
          <span>나의 슬리퍼 프로필</span>
        </div>
        <h1 id="onboarding-title">
          {ready ? "내 기본정보를 확인해요" : "반가워요. 나를 소개해주세요"}
        </h1>
        <p className="onboarding-subtitle">
          한 번 저장하면 모임을 신청할 때 다시 입력할 필요 없어요.
        </p>
        <div className="onboarding-steps" aria-label="회원 이용 준비">
          <span>
            <Check size={14} />
            로그인
          </span>
          <b>2</b>
          <span>기본정보</span>
          <ArrowRight size={13} />
          <span>모임 참여</span>
        </div>
        <form onSubmit={submit} aria-busy={busy}>
          <fieldset disabled={busy}>
            <div className="onboarding-required-heading">
              <h2>기본정보</h2>
              <span>필수</span>
            </div>
            <label className="onboarding-field" htmlFor="onboarding-nickname">
              닉네임
              <input
                id="onboarding-nickname"
                required
                minLength={2}
                maxLength={24}
                autoComplete="nickname"
                value={draft.nickname}
                onChange={(e) => setDraft((current) => ({ ...current, nickname: e.target.value }))}
              />
              <small>커뮤니티와 행사에서 사용할 이름이에요. 2~24자로 입력해주세요.</small>
            </label>
            <label className="onboarding-field" htmlFor="onboarding-phone">
              휴대폰 번호
              <input
                id="onboarding-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                maxLength={40}
                value={draft.phoneNumber}
                placeholder="010-1234-5678"
                onChange={(e) =>
                  setDraft((current) => ({ ...current, phoneNumber: e.target.value }))
                }
              />
              <small>모임 신청 시 연락처로 사용돼요. 공개 프로필에는 표시되지 않아요.</small>
            </label>
            <p className="onboarding-verification">
              <ShieldCheck size={16} />
              {initial.phoneVerifiedAt && draft.phoneNumber === initial.phoneNumber
                ? "휴대폰 번호 인증 완료"
                : "현재는 번호 형식만 확인해요. 문자 인증은 준비 중입니다."}
            </p>
            <details className="onboarding-optional">
              <summary>
                취향과 활동정보 <span>선택</span>
              </summary>
              <label className="onboarding-field" htmlFor="onboarding-region">
                활동 지역
                <input
                  id="onboarding-region"
                  maxLength={80}
                  value={draft.region}
                  placeholder="서울 · 성수"
                  onChange={(e) => setDraft((current) => ({ ...current, region: e.target.value }))}
                />
              </label>
              <div className="onboarding-select-grid">
                <label className="onboarding-field" htmlFor="onboarding-age">
                  연령대
                  <select
                    id="onboarding-age"
                    value={draft.ageBand ?? ""}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        ageBand: (e.target.value || null) as ProfileAgeBand | null,
                      }))
                    }
                  >
                    <option value="">선택 안 함</option>
                    <option value="20s">20대</option>
                    <option value="30s">30대</option>
                    <option value="40s">40대</option>
                    <option value="50plus">50대 이상</option>
                  </select>
                </label>
                <label className="onboarding-field" htmlFor="onboarding-gender">
                  성별
                  <select
                    id="onboarding-gender"
                    value={draft.gender ?? ""}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        gender: (e.target.value || null) as ProfileGender | null,
                      }))
                    }
                  >
                    <option value="">선택 안 함</option>
                    <option value="female">여성</option>
                    <option value="male">남성</option>
                    <option value="other">그 외</option>
                  </select>
                </label>
              </div>
              <p className="onboarding-privacy-note">
                연령대와 성별은 공개 프로필에 표시되지 않아요.
              </p>
              <span className="onboarding-field">관심 있는 콘텐츠</span>
              <div className="onboarding-interest-picker">
                {CATEGORIES.filter(
                  (category) => !["knowledge", "lab", "crew"].includes(category.slug),
                ).map((category) => (
                  <button
                    key={category.slug}
                    type="button"
                    aria-pressed={draft.interests.includes(category.slug)}
                    className={draft.interests.includes(category.slug) ? "selected" : ""}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        interests: current.interests.includes(category.slug)
                          ? current.interests.filter((slug) => slug !== category.slug)
                          : [...current.interests, category.slug],
                      }))
                    }
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </details>
            <label className="onboarding-consent">
              <input
                type="checkbox"
                required
                checked={draft.consent}
                onChange={(e) => setDraft((current) => ({ ...current, consent: e.target.checked }))}
              />
              <span>
                이용규칙과 개인정보 안내를 확인하고, 닉네임과 연락처 저장에 동의해요.
                <small>행사 신청 때는 해당 행사 담당자에게 전달할 정보를 별도로 확인해요.</small>
              </span>
            </label>
            {error && (
              <p className="onboarding-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="onboarding-submit">
              {busy ? "저장 중…" : "저장하고 계속하기"}
              <ArrowRight size={16} />
            </Button>
          </fieldset>
        </form>
        <div className="policy-links">
          <Link href="/policies/community">이용규칙</Link>
          <Link href="/policies/privacy">개인정보 안내</Link>
        </div>
        <Link href="/mypage" className="onboarding-later">
          다음에 입력하기
        </Link>
      </section>
    </ParticipationShell>
  );
}
