"use client";

import {
  Bell,
  Check,
  Copy,
  Download,
  ExternalLink,
  LoaderCircle,
  MessageCircle,
  PlusSquare,
  Settings2,
  Share,
  Smartphone,
} from "lucide-react";
import type { PushEnvironment } from "@/lib/push-onboarding-policy";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export interface PushOnboardingSheetProps {
  open: boolean;
  phase: "install-ios" | "install-android" | "permission" | "recovery" | "unsupported";
  environment: PushEnvironment;
  authenticated: boolean;
  busy: boolean;
  error: string;
  message: string;
  canInstall: boolean;
  canEnable: boolean;
  onClose: () => void;
  onAcknowledge: () => void;
  onEnable: () => void;
  onInstall: () => void;
  onRefresh: () => void;
  onCopyLink: () => void;
}

const BROWSER_LABELS = {
  safari: "Safari",
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  samsung: "삼성 인터넷",
  "in-app": "앱 안의 브라우저",
  other: "현재 브라우저",
} as const;

const IN_APP_LABELS = {
  kakao: "카카오톡",
  instagram: "Instagram",
  facebook: "Facebook",
  line: "LINE",
  other: "현재 앱",
} as const;

function NotificationBenefits() {
  return (
    <div className="push-onboarding-benefits" aria-label="받을 수 있는 알림">
      <div>
        <span className="push-onboarding-benefit-icon" aria-hidden="true">
          <Bell size={17} />
        </span>
        <span>
          <strong>모임 준비를 놓치지 않게</strong>
          <small>참가한 모임의 새 공지와 참가 확정 소식</small>
        </span>
      </div>
      <div>
        <span className="push-onboarding-benefit-icon" aria-hidden="true">
          <MessageCircle size={17} />
        </span>
        <span>
          <strong>내 이야기에 답이 오면</strong>
          <small>내 글의 댓글과 내 댓글에 달린 답글</small>
        </span>
      </div>
    </div>
  );
}

export function PushOnboardingSheet({
  open,
  phase,
  environment,
  authenticated,
  busy,
  error,
  message,
  canInstall,
  canEnable,
  onClose,
  onAcknowledge,
  onEnable,
  onInstall,
  onRefresh,
  onCopyLink,
}: PushOnboardingSheetProps) {
  const iosInstall = phase === "install-ios";
  const androidInstall = phase === "install-android";
  const installation = iosInstall || androidInstall;
  const recovery = phase === "recovery";
  const unsupported = phase === "unsupported";
  const ios = environment.platform === "ios";
  const browserLabel = environment.inAppName
    ? IN_APP_LABELS[environment.inAppName]
    : BROWSER_LABELS[environment.browser];
  const needsSafariHelp = iosInstall && environment.browser !== "safari";
  const title = recovery
    ? "알림 설정을 한 번 확인해주세요"
    : unsupported
      ? "이 기기에서 알림을 받으려면"
      : installation
        ? "Sliper를 홈 화면에 담아두세요"
        : "모임의 새 소식, 바로 받아보세요";
  const description = recovery
    ? "이 기기의 알림이 차단되어 있어요. 직접 허용한 뒤 다시 확인해주세요."
    : unsupported
      ? "사용 중인 환경에 맞춰 아래 안내를 확인해주세요."
      : iosInstall
        ? "홈 화면에서 Sliper를 열면 모임 공지와 댓글 알림을 받을 수 있어요."
        : androidInstall
          ? "홈 화면에서 가볍게 열고, 참여한 모임의 소식도 받아보세요."
          : "사이트를 닫아도 새 공지와 나에게 온 답글을 확인할 수 있어요.";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        className="push-onboarding-sheet"
        data-busy={busy ? "true" : "false"}
        aria-busy={busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <div className="push-onboarding-drag-handle" aria-hidden="true" />
        <div className="push-onboarding-brand">
          <img src="/images/sliper-icon-192.png" width={44} height={44} alt="" />
          <span>
            <strong>
              sliper<span className="push-onboarding-brand-dot">.</span>
            </strong>
            <small>
              {installation ? "언제든 가볍게, 함께 놀아요" : "내 모임에 꼭 필요한 소식"}
            </small>
          </span>
        </div>
        <header className="push-onboarding-heading">
          {installation && (
            <span className="push-onboarding-step-label">
              <Smartphone size={13} aria-hidden="true" />
              1. 홈 화면에 추가 <span aria-hidden="true">·</span> 2. 알림 허용
            </span>
          )}
          <DialogTitle className="push-onboarding-title">{title}</DialogTitle>
          <DialogDescription className="push-onboarding-description">
            {description}
          </DialogDescription>
        </header>

        {iosInstall && (
          <div className="push-onboarding-install-guide">
            {needsSafariHelp && (
              <div className="push-onboarding-browser-tip">
                <ExternalLink size={16} aria-hidden="true" />
                <p>
                  {browserLabel}에서 홈 화면 추가 메뉴가 보이지 않으면, 링크를 복사해
                  <strong> Safari에서 열어주세요.</strong>
                </p>
              </div>
            )}
            <ol className="push-onboarding-steps">
              <li>
                <span className="push-onboarding-step-number">1</span>
                <div>
                  <strong>브라우저의 공유 버튼을 눌러요</strong>
                  <p>도구 막대의 공유 아이콘을 찾아주세요. 보이지 않으면 ⋯ 메뉴를 확인하세요.</p>
                </div>
                <span className="push-onboarding-guide-symbol" aria-hidden="true">
                  <Share size={23} />
                </span>
              </li>
              <li>
                <span className="push-onboarding-step-number">2</span>
                <div>
                  <strong>홈 화면에 추가를 선택해요</strong>
                  <p>공유 메뉴를 아래로 내려 찾은 뒤, 추가를 눌러주세요.</p>
                </div>
                <span className="push-onboarding-guide-symbol" aria-hidden="true">
                  <PlusSquare size={23} />
                </span>
              </li>
            </ol>
            <p className="push-onboarding-home-hint">
              <Check size={15} aria-hidden="true" />
              <span>
                추가한 뒤 <strong>홈 화면의 Sliper 아이콘</strong>으로 다시 열어주세요. ‘웹앱으로
                열기’ 항목이 보이면 켜두세요.
              </span>
            </p>
          </div>
        )}

        {(androidInstall || phase === "permission") && <NotificationBenefits />}

        {recovery && (
          <div className="push-onboarding-recovery">
            <span className="push-onboarding-recovery-icon" aria-hidden="true">
              <Settings2 size={22} />
            </span>
            <div>
              <strong>
                {ios
                  ? "iPhone·iPad 설정에서 알림을 켜주세요"
                  : "브라우저의 알림 권한을 확인해주세요"}
              </strong>
              <p>
                {ios
                  ? "설정 → 알림 → Sliper → 알림 허용을 켜주세요. 이후 홈 화면의 Sliper로 돌아오세요."
                  : `${browserLabel}의 사이트 설정 → 알림에서 Sliper를 허용해주세요. 휴대폰 설정에서 브라우저 앱의 알림도 켜져 있어야 해요.`}
              </p>
              <small>기기와 브라우저 버전에 따라 설정 메뉴의 이름이 다를 수 있어요.</small>
            </div>
          </div>
        )}

        {unsupported && (
          <div className="push-onboarding-recovery">
            <span className="push-onboarding-recovery-icon" aria-hidden="true">
              <Smartphone size={22} />
            </span>
            <div>
              <strong>
                {!environment.secure
                  ? "보안 연결이 가능한 주소가 필요해요"
                  : ios && environment.iosVersionSupported === false
                    ? "iOS 16.4 이상으로 업데이트해주세요"
                    : environment.inAppName
                      ? "휴대폰의 기본 브라우저에서 열어주세요"
                      : "알림을 지원하는 브라우저에서 열어주세요"}
              </strong>
              <p>
                {!environment.secure
                  ? "알림은 HTTPS 주소에서 사용할 수 있어요. 보안 연결이 가능한 Sliper 주소로 다시 방문해주세요."
                  : ios && environment.iosVersionSupported === false
                    ? "업데이트 후 홈 화면에 Sliper를 추가하면 알림을 받을 수 있어요."
                    : environment.inAppName
                      ? `링크를 복사해 ${ios ? "Safari" : "Chrome 또는 삼성 인터넷"}에서 열어주세요.`
                      : ios
                        ? "Safari에서 홈 화면에 Sliper를 추가한 뒤, 홈 화면 아이콘으로 열어주세요."
                        : "최신 Chrome, 삼성 인터넷, Firefox 등에서 다시 시도해주세요."}
              </p>
            </div>
          </div>
        )}

        {!authenticated && !recovery && !unsupported && (
          <p className="push-onboarding-account-hint">
            홈 화면 추가는 먼저 할 수 있어요. 내 공지와 댓글 알림은 로그인 후 연결됩니다.
          </p>
        )}
        {error && (
          <p className="push-onboarding-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="push-onboarding-message" role="status" aria-live="polite">
            {message}
          </p>
        )}

        <div className="push-onboarding-actions">
          {iosInstall && (
            <>
              {needsSafariHelp && (
                <Button type="button" variant="outline" disabled={busy} onClick={onCopyLink}>
                  <Copy size={16} /> 링크 복사하기
                </Button>
              )}
              <Button type="button" disabled={busy} onClick={onAcknowledge}>
                <Check size={16} /> 방법을 확인했어요
              </Button>
            </>
          )}
          {androidInstall && (
            <>
              {canInstall && (
                <Button type="button" disabled={busy} onClick={onInstall}>
                  {busy ? (
                    <LoaderCircle className="push-onboarding-spinner" />
                  ) : (
                    <Download size={16} />
                  )}
                  {busy ? "확인 중…" : "홈 화면에 앱으로 추가"}
                </Button>
              )}
              {authenticated && environment.canRequestPush && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !canEnable}
                  onClick={onEnable}
                >
                  <Bell size={16} /> 설치 없이 알림 받기
                </Button>
              )}
            </>
          )}
          {phase === "permission" && authenticated && (
            <Button type="button" disabled={busy || !canEnable} onClick={onEnable}>
              {busy ? <LoaderCircle className="push-onboarding-spinner" /> : <Bell size={16} />}
              {busy ? "알림 연결 중…" : "알림 켜기"}
            </Button>
          )}
          {(recovery || unsupported) && (
            <>
              {unsupported && environment.inAppName && (
                <Button type="button" variant="outline" disabled={busy} onClick={onCopyLink}>
                  <Copy size={16} /> 링크 복사하기
                </Button>
              )}
              <Button type="button" disabled={busy} onClick={onRefresh}>
                {busy ? <LoaderCircle className="push-onboarding-spinner" /> : <Check size={16} />}
                {busy ? "확인 중…" : "설정 다시 확인하기"}
              </Button>
            </>
          )}
        </div>
        <Button
          className="push-onboarding-later"
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={onClose}
        >
          다음에 할게요 · 7일 동안 숨기기
        </Button>
        {phase === "permission" && (
          <p className="push-onboarding-footnote">
            알림 종류는 마이페이지에서 언제든 바꿀 수 있어요.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
