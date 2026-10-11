import { PlaceHistoryUnavailable } from "@/components/place-history";
export default function NotFound() {
  return (
    <PlaceHistoryUnavailable message="공개된 장소를 찾을 수 없어요. 장소가 삭제되었거나 열람할 수 없는 상태예요." />
  );
}
