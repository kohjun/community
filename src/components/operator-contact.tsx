"use client";
import { useSiteOperations } from "./site-operations-provider";
import Link from "next/link";
import { supportMailto } from "@/domain/site-operations";

export function OperatorContact({ compact = false }: { compact?: boolean }) {
  const config = useSiteOperations();
  if (compact)
    return (
      <div className="operator-disclosure">
        <span>운영 {config.operatorName}</span>
        <a href={supportMailto(config.supportEmail)!}>{config.supportEmail}</a>
        {config.businessComplete && (
          <span>
            {config.business.name} · 대표 {config.business.representative} · 사업자등록번호{" "}
            {config.business.registrationNumber} · {config.business.address} · 통신판매업{" "}
            {config.business.ecommerceRegistration}
          </span>
        )}
      </div>
    );
  return (
    <section className="safety-card support-contact" aria-labelledby="public-contact-title">
      <p className="safety-eyebrow">로그인 없이도 문의할 수 있어요</p>
      <h2 id="public-contact-title">{config.operatorName}에 문의하기</h2>
      <p>
        로그인이 안 되거나 탈퇴한 뒤에도 이메일로 문의할 수 있어요. 개인정보 확인·정정·삭제 요청도
        같은 주소로 보내주세요.
      </p>
      <a className="support-email" href={supportMailto(config.supportEmail)!}>
        {config.supportEmail}
      </a>
      <p className="form-note">
        메일 앱이 열리지 않으면 위 주소를 복사해 사용 중인 이메일에서 보내주세요.
      </p>
      <ul>
        <li>문제가 생긴 화면 주소, 발생 시각, 원하는 처리 내용을 알려주세요.</li>
        <li>개인정보 요청에는 본인 확인에 필요한 최소 정보만 별도로 안내해요.</li>
        <li>비밀번호·인증코드·신분증 사진·카드번호는 보내지 마세요.</li>
      </ul>
      <p>
        문의는 접수 후 순서대로 확인해요. 긴급한 현장 안전 문제는 행사 담당자와 긴급 신고기관에 먼저
        연락해주세요.
      </p>
      <div className="safety-links">
        <Link href="/policies/privacy">개인정보 안내</Link>
        <Link href="/policies/terms">서비스 이용약관</Link>
      </div>
    </section>
  );
}
