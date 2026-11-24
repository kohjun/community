"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { naverMapsScriptUrl } from "@/lib/naver-maps";

type PanoramaPov = { pan: number; tilt: number; fov: number };
type PanoramaInstance = {
  getPov(): PanoramaPov;
  setPov(pov: PanoramaPov): void;
  setSize?(size: unknown): void;
  destroy?(): void;
};
type PanoramaSDK = {
  Panorama: new (element: HTMLElement, options: Record<string, unknown>) => PanoramaInstance;
  Size: new (width: number, height: number) => unknown;
  Event: {
    addListener(target: object, name: string, listener: (event?: unknown) => void): unknown;
  };
};

function panoramaSDK(): PanoramaSDK | null {
  const maps = (window as unknown as { naver?: { maps?: Partial<PanoramaSDK> } }).naver?.maps;
  return maps?.Panorama && maps.Event && maps.Size ? (maps as PanoramaSDK) : null;
}

/**
 * Real NAVER street view for 단서각, opened by pano id only (no coordinates in the page).
 * `fov` narrows the view for the zoom-out mode; players can drag to look around.
 */
export function NaverStreetView({
  panoId,
  pan,
  fov = 100,
  label = "추리할 장소의 거리뷰",
}: {
  panoId: string;
  pan: number;
  fov?: number;
  label?: string;
}) {
  const clientId = process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID ?? "";
  const host = useRef<HTMLDivElement>(null);
  const pano = useRef<PanoramaInstance | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!clientId) {
      setState("error");
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resize: ResizeObserver | undefined;
    const started = Date.now();
    setState("loading");
    const open = () => {
      if (!alive || !host.current) return;
      const sdk = panoramaSDK();
      if (!sdk) {
        // The panorama submodule arrives after the main script; give it a few seconds.
        if (Date.now() - started > 15_000) setState("error");
        else timer = setTimeout(open, 150);
        return;
      }
      const element = host.current;
      element.innerHTML = "";
      const box = () => {
        const frame = element.parentElement!.getBoundingClientRect();
        return new sdk.Size(Math.round(frame.width), Math.round(frame.height));
      };
      const view = new sdk.Panorama(element, {
        panoId,
        size: box(),
        pov: { pan, tilt: 0, fov },
        flightSpot: false,
        aroundControl: false,
        logoControl: true,
      });
      pano.current = view;
      // The viewer keeps the size it was created with; follow the frame on rotate/resize.
      resize = new ResizeObserver(() => view.setSize?.(box()));
      resize.observe(element.parentElement!);
      sdk.Event.addListener(view, "pano_status", (status) => {
        if (alive) setState(String(status) === "OK" ? "ready" : "error");
      });
      sdk.Event.addListener(view, "pano_changed", () => {
        if (alive) setState("ready");
      });
    };
    open();
    return () => {
      alive = false;
      clearTimeout(timer);
      resize?.disconnect();
      pano.current?.destroy?.();
      pano.current = null;
    };
    // fov changes are applied below without rebuilding the panorama.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, panoId, pan]);

  useEffect(() => {
    const view = pano.current;
    if (!view || state !== "ready") return;
    const pov = view.getPov();
    if (pov.fov !== fov) view.setPov({ ...pov, fov });
  }, [fov, state]);

  return (
    <div className="naver-street-view" role="img" aria-label={label}>
      {clientId && (
        <Script
          id="sliper-naver-map"
          src={naverMapsScriptUrl(clientId)}
          strategy="afterInteractive"
        />
      )}
      <div ref={host} className="naver-street-view__canvas" />
      {state !== "ready" && (
        <div className="naver-street-view__status" role="status">
          {state === "loading" ? (
            <>
              <LoaderCircle size={18} className="naver-street-view__spin" /> 거리뷰를 불러오고
              있어요…
            </>
          ) : (
            "거리뷰를 불러오지 못했어요. 새로고침하거나 잠시 후 다시 시도해주세요."
          )}
        </div>
      )}
    </div>
  );
}
