import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EventApplication } from "../../src/components/event-application";
import { WriteDialog } from "../../src/components/write-dialog";
import { LoginLink } from "../../src/components/login-link";
import type { EventOverview } from "../../src/domain/participation";
const event: EventOverview = {
  postId: "11111111-1111-4111-8111-111111111111",
  title: "브라우저 검증 번개",
  location: "테스트 장소",
  eventDate: null,
  externalUrl: null,
  isOwner: false,
  canManage: false,
  publicProfileId: null,
  canApply: true,
  applicantProfile: { nickname: "검증회원", phoneNumber: "01000000000", ready: true },
  application: null,
  config: {
    open: true,
    capacity: 1,
    occupied: 1,
    amountKRW: 0,
    approvalMode: "manual",
    startsAt: null,
    endsAt: null,
    refundPolicy: "sliper-v1",
    questions: [],
    questionnaireVersion: "",
    meetupType: "lightning",
  },
};
function Fixture() {
  const [open, setOpen] = useState(false);
  const scenario = new URLSearchParams(location.search).get("scenario");
  if (scenario === "login") return <LoginLink>로그인 후 계속</LoginLink>;
  if (scenario === "draft")
    return (
      <>
        <button onClick={() => setOpen(true)}>글쓰기 열기</button>
        {open && (
          <WriteDialog
            open={open}
            onOpenChange={setOpen}
            initialCategory="party"
            post={null}
            upload={async () => {
              throw Error("Uploads disabled in fixture");
            }}
            onPublish={async () => false}
          />
        )}
      </>
    );
  return <EventApplication initial={event} paymentMode="unavailable" />;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
