"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Check, Smartphone, ChevronDown, ArrowRight } from "lucide-react";
import { appRequest, RequestError } from "@/lib/api-client";
import {
  getPushSettings,
  pushBrowserSupport,
  pushPermissionRecoveryMessage,
  startPushEnrollment,
  type PushBrowserSupport,
  type PushPreferences,
  type PushSettingsView,
} from "@/lib/push-client";
import { notifyPushSettingsChanged } from "@/lib/push-onboarding-events";
import { Button } from "./ui/button";
import { PushOnboardingGuideButton } from "./push-onboarding";

const PREFERENCES: { key: keyof PushPreferences; label: string; description: string }[] = [
  {
    key: "announcements",
    label: "공지방 새 공지",
    description: "참가한 모임의 담당자가 올린 공지",
  },
  { key: "comments", label: "댓글과 답글", description: "내 글에 달린 댓글과 내 댓글의 답글" },
  {
    key: "participation",
    label: "참가·환불 상태",
    description: "참가 확정, 행사 변경과 환불 완료",
  },
  {
    key: "subscriptions",
    label: "구독한 새 모집글",
    description: "관심사와 호스트의 새로운 모집 소식",
  },
  { key: "reminders", label: "참가 행사 리마인더", description: "확정한 행사 시작 전 일정 안내" },
];

export function PushSettings() {
  const [support, setSupport] = useState<PushBrowserSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [settings, setSettings] = useState<PushSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loggedOut, setLoggedOut] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const available = pushBrowserSupport();
    setSupport(available);
    const refreshPermission = () => {
      if ("Notification" in window) setPermission(Notification.permission);
    };
    refreshPermission();
    window.addEventListener("focus", refreshPermission);
    void (async () => {
      try {
        const registration =
          available === "supported"
            ? await navigator.serviceWorker.getRegistration("/")
            : undefined;
        const existing = registration ? await registration.pushManager.getSubscription() : null;
        const data = await getPushSettings(existing, controller.signal);
        if (controller.signal.aborted) return;
        setSubscription(existing);
        setSettings(data);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setLoggedOut(cause instanceof RequestError && cause.code === "UNAUTHENTICATED");
        setError(cause instanceof Error ? cause.message : "알림 설정을 불러오지 못했어요.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
      controller.abort();
      window.removeEventListener("focus", refreshPermission);
    };
  }, []);

  async function perform(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (cause) {
      if (!mounted.current) return;
      setLoggedOut(cause instanceof RequestError && cause.code === "UNAUTHENTICATED");
      setError(cause instanceof Error ? cause.message : "알림 설정을 처리하지 못했어요.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function enable() {
    if (inFlight.current || support !== "supported" || !settings?.enabled || !settings.publicKey)
      return;
    // The helper requests permission synchronously in this button click.
    const enrollment = startPushEnrollment(settings);
    void perform(async () => {
      try {
        const result = await enrollment;
        if (!mounted.current) return;
        setSubscription(result.subscription);
        setSettings(result.settings);
        setMessage("이 기기에서 Sliper 알림을 받아요.");
        notifyPushSettingsChanged();
      } finally {
        if (mounted.current && "Notification" in window) setPermission(Notification.permission);
      }
    });
  }

  async function disable() {
    if (!subscription) return;
    await perform(async () => {
      await appRequest("/api/push/subscriptions", "DELETE", { endpoint: subscription.endpoint });
      if (mounted.current)
        setSettings((previous) =>
          previous
            ? {
                ...previous,
                currentDevice: false,
                subscriptions: Math.max(0, previous.subscriptions - 1),
              }
            : previous,
        );
      const removed = await subscription.unsubscribe();
      if (!removed) throw new Error("사이트 연결은 해제됐어요. 브라우저 알림 권한도 확인해주세요.");
      if (!mounted.current) return;
      setSubscription(null);
      const data = await getPushSettings(null);
      if (!mounted.current) return;
      setSettings(data);
      setMessage("이 기기의 알림 연결을 해제했어요. 다른 기기의 설정은 유지됩니다.");
      notifyPushSettingsChanged();
    });
  }

  async function updatePreference(key: keyof PushPreferences, checked: boolean) {
    if (!settings) return;
    await perform(async () => {
      await appRequest("/api/push/settings", "PATCH", {
        ...settings.preferences,
        [key]: checked,
      });
      const data = await getPushSettings(subscription);
      if (!mounted.current) return;
      setSettings(data);
      setMessage("알림 종류를 저장했어요. 연결된 기기에 함께 적용됩니다.");
      notifyPushSettingsChanged();
    });
  }

  async function retry() {
    await perform(async () => {
      const registration =
        support === "supported" ? await navigator.serviceWorker.getRegistration("/") : undefined;
      const existing = registration ? await registration.pushManager.getSubscription() : null;
      const data = await getPushSettings(existing);
      if (!mounted.current) return;
      setSettings(data);
      setSubscription(existing);
      setLoggedOut(false);
    });
  }

  async function test() {
    if (!subscription) return;
    await perform(async () => {
      await appRequest("/api/push/test", "POST", { endpoint: subscription.endpoint });
      if (mounted.current)
        setMessage("테스트 알림 발송을 요청했어요. 잠금 화면이나 알림 센터를 확인해주세요.");
    });
  }

  const bound = Boolean(subscription && settings?.currentDevice);
  const connected = bound && permission === "granted";
  const notice =
    support === "insecure"
      ? "휴대폰 알림은 HTTPS 주소에서 사용할 수 있어요. 현재 Wi-Fi 로컬 주소에서는 알림을 켤 수 없어요."
      : support === "ios-install"
        ? "아이폰·아이패드는 iOS 16.4 이상에서 사용할 수 있어요. 공유 → 홈 화면에 추가한 뒤, 홈 화면의 Sliper를 열어 알림을 켜주세요."
        : support === "unsupported"
          ? "이 브라우저는 웹푸시를 지원하지 않아요. 지원하는 브라우저에서 다시 열어주세요."
          : permission === "denied"
            ? pushPermissionRecoveryMessage()
            : settings && !settings.enabled
              ? "알림 발송 연결을 준비하고 있어요. 준비가 완료되면 이 기기에서 알림을 켤 수 있어요."
              : "알림을 허용하면 사이트를 닫아도 새 소식을 받을 수 있어요.";

  const canEnable =
    support === "supported" &&
    permission !== "denied" &&
    settings?.enabled &&
    !!settings.publicKey &&
    !loggedOut;
  const needsGuide =
    support === "ios-install" ||
    support === "insecure" ||
    support === "unsupported" ||
    permission === "denied";
  const guideLabel =
    support === "ios-install"
      ? "홈 화면에 추가하는 방법"
      : permission === "denied"
        ? "알림 허용 방법 보기"
        : "이 기기에서 알림 받는 방법";
  return (
    <details className="push-settings-compact">
      <summary aria-label="내 알림 설정 펼치기">
        <Bell size={17} aria-hidden="true" />
        <span className="push-settings-summary-title">내 알림 설정</span>
        <span className="push-settings-summary-state">
          {connected ? <Check size={12} /> : <Smartphone size={12} />}
          {loading ? "확인 중" : connected ? "연결됨" : "연결 안 됨"}
        </span>
        <ChevronDown size={16} className="push-settings-chevron" aria-hidden="true" />
      </summary>
      <div className="push-settings-body">
        <p className="push-settings-notice">{notice}</p>
        {loading && (
          <p className="push-settings-caption" role="status">
            알림 설정을 불러오고 있어요.
          </p>
        )}
        {!settings && !loading && !loggedOut && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void retry()}
          >
            설정 다시 불러오기
          </Button>
        )}
        {settings && (
          <>
            <fieldset disabled={busy || loggedOut} className="push-settings-preferences">
              <legend className="sr-only">받을 알림 종류</legend>
              {PREFERENCES.map((item) => (
                <div key={item.key} className="push-settings-preference-row">
                  <span className="push-settings-preference-copy">
                    <strong id={"push-preference-" + item.key}>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className="push-settings-toggle-state" aria-hidden="true">
                    {settings.preferences[item.key] ? "ON" : "OFF"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    className="push-settings-switch"
                    aria-labelledby={"push-preference-" + item.key}
                    aria-checked={settings.preferences[item.key]}
                    onClick={() => void updatePreference(item.key, !settings.preferences[item.key])}
                  >
                    <span />
                  </button>
                </div>
              ))}
            </fieldset>
            <div className="push-settings-actions">
              {bound ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || loggedOut || !settings.enabled}
                    onClick={() => void test()}
                  >
                    테스트 알림
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy || loggedOut}
                    onClick={() => void disable()}
                  >
                    <BellOff size={14} />이 기기 연결 해제
                  </Button>
                </>
              ) : canEnable ? (
                <Button type="button" size="sm" disabled={busy} onClick={() => void enable()}>
                  <Bell size={14} />
                  {busy ? "연결 중…" : "이 기기에서 알림 받기"}
                </Button>
              ) : needsGuide && permission !== "granted" ? (
                <PushOnboardingGuideButton className="push-settings-guide-button">
                  {guideLabel}
                  <ArrowRight size={13} />
                </PushOnboardingGuideButton>
              ) : null}
            </div>
            <p className="push-settings-caption">
              연결된 기기 {settings.subscriptions}개 · 알림 종류는 계정 전체에 적용돼요.
            </p>
          </>
        )}
        {error && (
          <p className="push-settings-error" role="alert">
            {error}
          </p>
        )}
        {loggedOut && (
          <Link href="/login" className="push-settings-login">
            로그인하고 설정하기 →
          </Link>
        )}
        {message && (
          <p className="push-settings-message" role="status">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
