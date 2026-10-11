"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowRight, Bell, Share2, Smartphone, X } from "lucide-react";
import { RequestError } from "@/lib/api-client";
import {
  getPushEnvironment,
  getPushSettings,
  registerPushWorker,
  startPushEnrollment,
  type PushSettingsView,
} from "@/lib/push-client";
import {
  pushOnboardingPhase,
  readPushOnboardingSnooze,
  snoozePushOnboarding,
  type PushEnvironment,
  type PushPermission,
  type PushOnboardingPhase,
} from "@/lib/push-onboarding-policy";
import {
  PUSH_ONBOARDING_MOMENT_EVENT,
  PUSH_ONBOARDING_CHANGED_EVENT,
  markPushAuthEntry,
  consumePushAuthEntry,
} from "@/lib/push-onboarding-events";
import { PushOnboardingSheet } from "./push-onboarding-sheet";

interface InstallPrompt extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
interface OnboardingContext {
  environment: PushEnvironment | null;
  permission: PushPermission;
  ready: boolean;
  snoozed: boolean;
  openGuide(): void;
}
const Context = createContext<OnboardingContext | null>(null);
function storage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}
const readEnvironment = getPushEnvironment;
const readPermission = (): PushPermission =>
  "Notification" in window ? Notification.permission : "unavailable";
const authPage = (path: string) => path === "/login" || path === "/signup";

export function PushOnboardingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [environment, setEnvironment] = useState<PushEnvironment | null>(null);
  const [permission, setPermission] = useState<PushPermission>("unavailable");
  const [settings, setSettings] = useState<PushSettingsView | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [installAvailable, setInstallAvailable] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [moment, setMoment] = useState(0);
  const mounted = useRef(false),
    gate = useRef(false),
    shown = useRef(false);
  const request = useRef<AbortController | null>(null);
  const prompt = useRef<InstallPrompt | null>(null);
  const path = useRef(pathname);
  path.current = pathname;

  const refresh = useCallback(async () => {
    setReady(false);
    const abort = new AbortController();
    request.current?.abort();
    request.current = abort;
    const env = readEnvironment();
    setEnvironment(env);
    setPermission(readPermission());
    setSnoozed((previous) => previous || readPushOnboardingSnooze(storage("localStorage")));
    try {
      const registration = env.canRequestPush
        ? await navigator.serviceWorker.getRegistration("/")
        : undefined;
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      const next = await getPushSettings(subscription, abort.signal);
      if (!mounted.current || abort.signal.aborted) return;
      setSettings(next);
      setAuthenticated(true);
      if (!authPage(path.current) && consumePushAuthEntry(storage("sessionStorage")))
        setMoment((value) => value + 1);
    } catch (cause) {
      if (!mounted.current || abort.signal.aborted) return;
      // Fail closed after logout or a failed session refresh; do not enroll with cached account state.
      setSettings(null);
      setAuthenticated(false);
      if (!(cause instanceof RequestError && cause.code === "UNAUTHENTICATED"))
        setMessage("알림 설정을 확인하지 못했어요. 잠시 후 다시 확인해주세요.");
    } finally {
      if (mounted.current && !abort.signal.aborted) setReady(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const receiveMoment = () => setMoment((value) => value + 1);
    const changed = () => {
      if (!gate.current) void refresh();
    };
    const focus = () => {
      if (document.visibilityState === "visible" && !gate.current) void refresh();
    };
    const beforeInstall = (event: Event) => {
      const env = readEnvironment();
      if (env.platform !== "android" || env.standalone || readPermission() === "granted") return;
      const candidate = event as InstallPrompt;
      if (typeof candidate.prompt !== "function" || !candidate.userChoice) return;
      if (readPushOnboardingSnooze(storage("localStorage"))) return;
      event.preventDefault();
      prompt.current = candidate;
      setInstallAvailable(true);
    };
    const appInstalled = () => {
      prompt.current = null;
      setInstallAvailable(false);
      setInstalled(true);
      setMessage("홈 화면에 Sliper를 추가했어요. 이제 모임 알림을 켤 수 있어요.");
    };
    const media = window.matchMedia("(display-mode: standalone)");
    window.addEventListener(PUSH_ONBOARDING_MOMENT_EVENT, receiveMoment);
    window.addEventListener(PUSH_ONBOARDING_CHANGED_EVENT, changed);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", appInstalled);
    media.addEventListener("change", focus);
    const env = readEnvironment();
    // Registration prepares Android's install UI; it never requests notification permission.
    if (env.platform === "android" && env.secure && env.pushApiSupported && !env.inAppName)
      void registerPushWorker().catch(() => {});
    return () => {
      mounted.current = false;
      request.current?.abort();
      window.removeEventListener(PUSH_ONBOARDING_MOMENT_EVENT, receiveMoment);
      window.removeEventListener(PUSH_ONBOARDING_CHANGED_EVENT, changed);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", appInstalled);
      media.removeEventListener("change", focus);
    };
  }, [refresh]);

  useEffect(() => {
    if (authPage(pathname)) markPushAuthEntry(storage("sessionStorage"));
    void refresh();
  }, [pathname, refresh]);

  let phase: PushOnboardingPhase = environment
    ? pushOnboardingPhase({
        environment,
        authenticated,
        permission,
        configured: Boolean(settings?.enabled),
        snoozed: manual ? false : snoozed,
        androidInstallAvailable: installAvailable && !installed,
        allowGuestInstall: manual,
      })
    : "hidden";
  if (manual && environment && permission !== "granted" && phase === "hidden")
    phase =
      permission === "denied"
        ? "recovery"
        : !environment.secure || !environment.canRequestPush
          ? "unsupported"
          : "permission";

  useEffect(() => {
    if (!ready || manual || shown.current || snoozed || authPage(pathname)) return;
    if (!moment && !(environment?.standalone && authenticated)) return;
    if (!["permission", "install-ios", "install-android"].includes(phase)) return;
    let timer: ReturnType<typeof setTimeout>;
    const showWhenFree = () => {
      if (readPermission() === "granted" || readPermission() === "denied") {
        setPermission(readPermission());
        return;
      }
      if (readPushOnboardingSnooze(storage("localStorage"))) {
        setSnoozed(true);
        return;
      }
      if (
        document.visibilityState !== "visible" ||
        document.querySelector('[role="dialog"][data-state="open"]')
      ) {
        timer = setTimeout(showWhenFree, 1200);
        return;
      }
      shown.current = true;
      setOpen(true);
    };
    timer = setTimeout(showWhenFree, 1200);
    return () => clearTimeout(timer);
  }, [ready, manual, snoozed, pathname, moment, environment?.standalone, authenticated, phase]);

  function close() {
    if (gate.current) return;
    snoozePushOnboarding(storage("localStorage"));
    setSnoozed(true);
    setOpen(false);
    setManual(false);
    setError("");
    setMessage("");
  }
  function acknowledge() {
    if (gate.current) return;
    // Completing the installation guide is not opting out of the next permission step.
    shown.current = true;
    setOpen(false);
    setManual(false);
    setError("");
    setMessage("");
  }
  function openGuide() {
    if (!ready || permission === "granted" || gate.current) return;
    setManual(true);
    setError("");
    setMessage(
      authenticated && !settings?.enabled
        ? "알림 연결을 준비 중이에요. 잠시 후 다시 확인해주세요."
        : "",
    );
    setOpen(true);
  }
  function enable() {
    if (
      gate.current ||
      !ready ||
      !authenticated ||
      !settings?.enabled ||
      !environment?.canRequestPush ||
      permission === "denied"
    )
      return;
    gate.current = true;
    setBusy(true);
    setError("");
    // The helper requests permission synchronously in this click call stack.
    const enrollment = startPushEnrollment(settings);
    void enrollment
      .then((result) => {
        if (!mounted.current) return;
        setSettings(result.settings);
        setOpen(false);
        setManual(false);
        shown.current = true;
      })
      .catch((cause) => {
        if (mounted.current)
          setError(cause instanceof Error ? cause.message : "알림을 연결하지 못했어요.");
      })
      .finally(() => {
        gate.current = false;
        if (mounted.current) {
          setBusy(false);
          setPermission(readPermission());
        }
      });
  }
  function install() {
    const deferred = prompt.current;
    if (!deferred || gate.current || environment?.platform !== "android") return;
    gate.current = true;
    setBusy(true);
    setError("");
    // Only a real saved browser event can show the native installation prompt.
    let action: Promise<unknown>;
    try {
      action = Promise.resolve(deferred.prompt());
    } catch {
      gate.current = false;
      setBusy(false);
      prompt.current = null;
      setInstallAvailable(false);
      setError("설치 안내를 열지 못했어요. 브라우저 메뉴에서 홈 화면에 추가해주세요.");
      return;
    }
    prompt.current = null;
    setInstallAvailable(false);
    void action
      .then(() => deferred.userChoice)
      .then((choice) => {
        if (!mounted.current) return;
        if (choice.outcome === "accepted") {
          setInstalled(true);
          setMessage("홈 화면 추가를 요청했어요. 알림은 아래 버튼에서 따로 켤 수 있어요.");
        } else {
          snoozePushOnboarding(storage("localStorage"));
          setSnoozed(true);
          setOpen(false);
          setManual(false);
        }
      })
      .catch(() => {
        if (mounted.current)
          setError("설치 안내를 열지 못했어요. 브라우저 메뉴에서 홈 화면에 추가해주세요.");
      })
      .finally(() => {
        gate.current = false;
        if (mounted.current) setBusy(false);
      });
  }
  function copyLink() {
    const safe = window.location.origin + window.location.pathname;
    if (!navigator.clipboard?.writeText) {
      setMessage("주소창의 주소를 복사해 Safari 또는 Chrome에서 열어주세요.");
      return;
    }
    void navigator.clipboard
      .writeText(safe)
      .then(() => {
        if (mounted.current)
          setMessage("주소를 복사했어요. Safari 또는 Chrome에서 붙여넣어 열어주세요.");
      })
      .catch(() => {
        if (mounted.current) setMessage("주소창의 주소를 복사해 일반 브라우저에서 열어주세요.");
      });
  }

  return (
    <Context.Provider value={{ environment, permission, ready, snoozed, openGuide }}>
      {children}
      {environment && (
        <PushOnboardingSheet
          open={open && phase !== "hidden"}
          phase={phase === "hidden" ? "permission" : phase}
          environment={environment}
          authenticated={authenticated}
          busy={busy}
          error={error}
          message={message}
          canInstall={installAvailable && !installed}
          canEnable={
            ready &&
            authenticated &&
            Boolean(settings?.enabled) &&
            environment.canRequestPush &&
            permission !== "denied"
          }
          onClose={close}
          onAcknowledge={acknowledge}
          onEnable={enable}
          onInstall={install}
          onRefresh={() => void refresh()}
          onCopyLink={copyLink}
        />
      )}
      {error && permission === "granted" && (
        <div
          role="alert"
          className="fixed bottom-5 left-4 right-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-lg"
        >
          <span className="flex-1">
            {error}{" "}
            <Link href="/mypage" className="font-semibold text-blue-600">
              알림 설정 확인
            </Link>
          </span>
          <button type="button" onClick={() => setError("")} aria-label="오류 안내 닫기">
            <X size={16} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}

export function PushOnboardingEntry() {
  const state = useContext(Context);
  if (!state?.ready || !state.environment || state.permission === "granted" || state.snoozed)
    return null;
  const ios = state.environment.platform === "ios" && !state.environment.standalone;
  return (
    <aside className="push-login-entry" aria-labelledby="push-login-entry-title">
      <span className="push-login-entry-icon" aria-hidden="true">
        {ios ? <Smartphone size={19} /> : <Bell size={19} />}
      </span>
      <div>
        <h3 id="push-login-entry-title">
          {ios ? "홈 화면에서 모임 소식을 받아보세요" : "함께할 모임의 소식, 바로 받아보세요"}
        </h3>
        <p>
          {ios
            ? "홈 화면에 Sliper를 추가하고, 로그인 후 공지 알림을 켜보세요."
            : "로그인 후 새 공지와 댓글 알림을 선택할 수 있어요."}
        </p>
        <button type="button" onClick={state.openGuide}>
          {ios ? <Share2 size={13} /> : <Bell size={13} />}{" "}
          {state.permission === "denied"
            ? "알림 설정 방법 보기"
            : ios
              ? "홈 화면에 앱으로 추가"
              : "알림 받는 방법 보기"}{" "}
          <ArrowRight size={13} />
        </button>
      </div>
    </aside>
  );
}

/** An explicit settings action can reopen the guide even while promotion is snoozed. */
export function PushOnboardingGuideButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const state = useContext(Context);
  return (
    <button
      type="button"
      className={className}
      onClick={state?.openGuide}
      disabled={!state?.ready || state.permission === "granted"}
    >
      {children}
    </button>
  );
}
