"use client";
import { useId } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  CHARACTER_AVATARS,
  SYMBOL_AVATARS,
  getProfileAvatar,
  type ProfileAvatar,
} from "@/domain/profile-avatars";
import { MemberAvatar } from "./member-avatar";

export function ProfileAvatarPicker({
  value,
  onChange,
  hasPhoto = false,
}: {
  value: ProfileAvatar;
  onChange: (avatar: ProfileAvatar) => void;
  hasPhoto?: boolean;
}) {
  const groupId = useId();
  const hintId = `${groupId}-hint`;

  function choice(option: (typeof CHARACTER_AVATARS | typeof SYMBOL_AVATARS)[number]) {
    const inputId = `${groupId}-${option.id}`;
    return (
      <label className="profile-avatar-choice" key={option.id} htmlFor={inputId}>
        <input
          className="sl-sr-only"
          id={inputId}
          type="radio"
          name={groupId}
          value={option.id}
          checked={value === option.id}
          onChange={() => onChange(option.id)}
        />
        <span className="profile-avatar-choice__tile" aria-hidden="true">
          {"src" in option ? (
            <img src={option.src} alt="" width={48} height={48} loading="lazy" decoding="async" />
          ) : (
            option.symbol
          )}
          <Check className="profile-avatar-choice__check" size={15} />
        </span>
        <span className="sl-sr-only">{option.label}</span>
      </label>
    );
  }

  return (
    <details className="profile-avatar-picker">
      <summary>
        <span aria-hidden="true">
          <MemberAvatar nickname="선택한" avatar={value} />
        </span>
        <span className="profile-avatar-picker__summary">
          <strong>기본 프로필 고르기</strong>
          <small>{getProfileAvatar(value).label}</small>
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <fieldset aria-describedby={hintId}>
        <legend className="sl-sr-only">기본 프로필</legend>
        <p id={hintId}>
          {hasPhoto
            ? "올린 사진이 먼저 보여요. 사진을 삭제하면 선택한 기본 프로필이 보여요."
            : "사진 대신 사용할 캐릭터나 아이콘을 골라보세요."}
        </p>
        <div className="profile-avatar-picker__grid">{CHARACTER_AVATARS.map(choice)}</div>
        <div className="profile-avatar-picker__grid profile-avatar-picker__symbols">
          {SYMBOL_AVATARS.map(choice)}
        </div>
      </fieldset>
    </details>
  );
}
