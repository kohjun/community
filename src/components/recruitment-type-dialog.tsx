"use client";
import Link from "next/link";
import { CalendarDays, ChevronRight, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { LIGHTNING_COMPOSE_HREF, MEETUP_TYPE_LABELS } from "@/domain/meetup-types";

/** First step of 모집글 쓰기: hosts pick the format before filling in its own form. */
export function RecruitmentTypeDialog({
  open,
  onOpenChange,
  onEvent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEvent: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="utility-dialog sl-recruit-type">
        <DialogTitle className="utility-title">어떤 모집글을 올릴까요?</DialogTitle>
        <DialogDescription className="utility-description">
          모임 규모와 준비 정도에 맞는 방식을 골라주세요.
        </DialogDescription>
        <div className="sl-recruit-type__options">
          <button type="button" onClick={onEvent}>
            <span className="sl-recruit-type__icon" aria-hidden="true">
              <CalendarDays size={22} />
            </span>
            <span className="sl-recruit-type__copy">
              <strong>{MEETUP_TYPE_LABELS.event}</strong>
              <small>일정·장소·참가비를 정하고 외부 신청 링크로 참가자를 모아요.</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <Link href={LIGHTNING_COMPOSE_HREF} onClick={() => onOpenChange(false)}>
            <span className="sl-recruit-type__icon" aria-hidden="true">
              <Zap size={22} />
            </span>
            <span className="sl-recruit-type__copy">
              <strong>{MEETUP_TYPE_LABELS.lightning}</strong>
              <small>2–12명이 7일 안에 가볍게 모여요. 비용은 현장에서 함께 정산해요.</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
