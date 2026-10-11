export type MapPoint = { latitude: number; longitude: number };
export type MapBounds = { south: number; west: number; north: number; east: number };
export type MapPin = MapPoint & {
  id: string;
  kind: "place" | "event" | "lightning";
  label: string;
  categoryLabel?: string;
};
export type GeocodedAddress = MapPoint & {
  address: string;
  roadAddress: string;
  jibunAddress: string;
};

export interface NaverLatLng {
  lat(): number;
  lng(): number;
}
export interface NaverBounds {
  getSW(): NaverLatLng;
  getNE(): NaverLatLng;
}
export interface NaverMapInstance {
  getBounds(): NaverBounds;
  panTo(point: NaverLatLng): void;
  setZoom(zoom: number): void;
  setOptions(options: { draggable?: boolean; cursor?: string }): void;
  autoResize(): void;
  destroy(): void;
}
export type NaverHtmlIcon = {
  content: string;
  anchor: { x: number; y: number };
};
export interface NaverMarkerInstance {
  setMap(map: NaverMapInstance | null): void;
  setOptions(options: {
    position: NaverLatLng;
    icon: NaverHtmlIcon;
    title: string;
    zIndex: number;
  }): void;
}
export type NaverListener = object;
export interface NaverGeocodeService {
  Status: { OK: string | number };
  geocode(
    options: { query: string },
    callback: (status: string | number, response: unknown) => void,
  ): void;
}
export interface NaverMapsSDK {
  Map: new (
    element: HTMLElement,
    options: {
      center: NaverLatLng;
      zoom: number;
      minZoom: number;
      maxZoom: number;
      zoomControl: boolean;
      zoomControlOptions: { position: number };
    },
  ) => NaverMapInstance;
  LatLng: new (latitude: number, longitude: number) => NaverLatLng;
  Marker: new (options: {
    map: NaverMapInstance;
    position: NaverLatLng;
    icon: NaverHtmlIcon;
    title: string;
    zIndex: number;
  }) => NaverMarkerInstance;
  Position: { RIGHT_CENTER: number };
  Event: {
    addListener(target: object, name: string, listener: (event?: unknown) => void): NaverListener;
    removeListener(listener: NaverListener): void;
  };
  Service?: NaverGeocodeService;
}
export type NaverRuntime = {
  naver?: { maps?: NaverMapsSDK };
  navermap_authFailure?: () => void;
};

export function naverMapsScriptUrl(clientId: string): string {
  const query = new URLSearchParams({ ncpKeyId: clientId.trim(), submodules: "geocoder" });
  return `https://oapi.map.naver.com/openapi/v3/maps.js?${query}`;
}

export function getNaverMapsSDK(): NaverMapsSDK | null {
  if (typeof window === "undefined") return null;
  const sdk = (window as NaverRuntime).naver?.maps;
  if (
    !sdk ||
    typeof sdk.Map !== "function" ||
    typeof sdk.Marker !== "function" ||
    typeof sdk.LatLng !== "function" ||
    typeof sdk.Event?.addListener !== "function" ||
    typeof sdk.Event?.removeListener !== "function" ||
    typeof sdk.Position?.RIGHT_CENTER !== "number" ||
    typeof sdk.Service?.geocode !== "function"
  )
    return null;
  return sdk;
}

export function isMapPoint(point: MapPoint): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

export function readMapBounds(bounds: NaverBounds): MapBounds | null {
  const southwest = bounds.getSW();
  const northeast = bounds.getNE();
  const sw = { latitude: southwest.lat(), longitude: southwest.lng() };
  const ne = { latitude: northeast.lat(), longitude: northeast.lng() };
  if (
    !isMapPoint(sw) ||
    !isMapPoint(ne) ||
    sw.latitude >= ne.latitude ||
    sw.longitude >= ne.longitude
  )
    return null;
  return { south: sw.latitude, west: sw.longitude, north: ne.latitude, east: ne.longitude };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function coordinate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())
  )
    return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function addressText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 300) : "";
}

export function parseGeocodedAddresses(response: unknown): GeocodedAddress[] {
  const v2 = record(record(response)?.v2);
  if (!v2 || v2.status !== "OK" || !Array.isArray(v2.addresses)) return [];
  const results: GeocodedAddress[] = [];
  const seen = new Set<string>();
  for (const raw of v2.addresses.slice(0, 20)) {
    const item = record(raw);
    if (!item) continue;
    const latitude = coordinate(item.y);
    const longitude = coordinate(item.x);
    if (latitude === null || longitude === null || !isMapPoint({ latitude, longitude })) continue;
    const roadAddress = addressText(item.roadAddress);
    const jibunAddress = addressText(item.jibunAddress);
    const address = roadAddress || jibunAddress;
    if (!address) continue;
    const key = `${latitude}:${longitude}:${address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ latitude, longitude, address, roadAddress, jibunAddress });
    if (results.length === 10) break;
  }
  return results;
}

export function geocodeAddress(
  address: string,
  options: { signal?: AbortSignal; service?: NaverGeocodeService; timeoutMs?: number } = {},
): Promise<GeocodedAddress[]> {
  const query = address.trim();
  if (query.length < 2 || query.length > 200)
    return Promise.reject(new Error("검색할 주소를 2~200자로 입력해 주세요."));
  const service = options.service ?? getNaverMapsSDK()?.Service;
  if (!service)
    return Promise.reject(
      new Error("주소 검색을 준비하고 있어요. 지도가 열린 뒤 다시 시도해 주세요."),
    );
  if (options.signal?.aborted)
    return Promise.reject(new DOMException("주소 검색을 취소했습니다.", "AbortError"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: GeocodedAddress[] | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const abort = () => finish(new DOMException("주소 검색을 취소했습니다.", "AbortError"));
    const timer = setTimeout(
      () => finish(new Error("주소 검색이 지연되고 있어요. 잠시 후 다시 시도해 주세요.")),
      options.timeoutMs ?? 10000,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      service.geocode({ query }, (status, response) => {
        if (status !== service.Status.OK) {
          finish(new Error("주소를 검색하지 못했어요. 주소와 지도 연결 상태를 확인해 주세요."));
          return;
        }
        const v2 = record(record(response)?.v2);
        if (!v2 || v2.status !== "OK" || !Array.isArray(v2.addresses)) {
          finish(new Error("주소 검색 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요."));
          return;
        }
        finish(parseGeocodedAddresses(response));
      });
    } catch {
      finish(new Error("주소 검색에 연결하지 못했어요. 잠시 후 다시 시도해 주세요."));
    }
  });
}

type AuthBroker = {
  original: (() => void) | undefined;
  callbacks: Set<() => void>;
  bridge: () => void;
};
const authBrokers = new WeakMap<NaverRuntime, AuthBroker>();
export function subscribeNaverAuthFailure(callback: () => void, runtime: NaverRuntime): () => void {
  let broker = authBrokers.get(runtime);
  if (!broker) {
    const callbacks = new Set<() => void>();
    const original = runtime.navermap_authFailure;
    const bridge = () => {
      try {
        original?.();
      } catch {
        /* An unrelated integration must not hide our error state. */
      }
      for (const listener of [...callbacks]) listener();
    };
    broker = { original, callbacks, bridge };
    authBrokers.set(runtime, broker);
    runtime.navermap_authFailure = bridge;
  }
  broker.callbacks.add(callback);
  const activeBroker = broker;
  return () => {
    activeBroker.callbacks.delete(callback);
    if (activeBroker.callbacks.size > 0) return;
    if (runtime.navermap_authFailure === activeBroker.bridge) {
      if (activeBroker.original) runtime.navermap_authFailure = activeBroker.original;
      else delete runtime.navermap_authFailure;
    }
    authBrokers.delete(runtime);
  };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}
export function markerIcon(pin: MapPin, selected: boolean): NaverHtmlIcon {
  const label = escapeHtml(pin.label.slice(0, 160));
  const kind = pin.kind === "event" || pin.kind === "lightning" ? pin.kind : "place";
  const symbol = kind === "place" ? "장소" : kind === "lightning" ? "번개" : "이벤트";
  return {
    content: `<button type="button" class="naver-event-pin naver-event-pin--${kind}${selected ? " is-selected" : ""}" aria-label="${symbol}: ${label}" aria-pressed="${selected}"><span class="naver-event-pin-kind">${symbol}</span><span class="naver-event-pin-label">${label}</span></button>`,
    anchor: { x: 22, y: 38 },
  };
}

export type NaverMapCallbacks = {
  onSelect: (id: string) => void;
  onBoundsChange: (bounds: MapBounds) => void;
  onPick: (point: MapPoint) => void;
};
type OwnedMarker = { marker: NaverMarkerInstance; listener: NaverListener };

export class NaverMapSession {
  readonly map: NaverMapInstance;
  private readonly markers = new Map<string, OwnedMarker>();
  private readonly listeners: NaverListener[] = [];
  private boundsTimer: ReturnType<typeof setTimeout> | undefined;
  private lastBounds = "";
  private selectedId: string | null = null;
  private picking = false;
  private disposed = false;

  constructor(
    private readonly sdk: NaverMapsSDK,
    element: HTMLElement,
    private readonly callbacks: NaverMapCallbacks,
    point: MapPoint = { latitude: 37.5665, longitude: 126.978 },
  ) {
    const center = isMapPoint(point) ? point : { latitude: 37.5665, longitude: 126.978 };
    this.map = new sdk.Map(element, {
      center: new sdk.LatLng(center.latitude, center.longitude),
      zoom: 12,
      minZoom: 6,
      maxZoom: 20,
      zoomControl: true,
      zoomControlOptions: { position: sdk.Position.RIGHT_CENTER },
    });
    this.listeners.push(sdk.Event.addListener(this.map, "idle", () => this.scheduleBounds()));
    this.listeners.push(
      sdk.Event.addListener(this.map, "click", (event) => {
        if (!this.picking || this.disposed) return;
        const coord = record(event)?.coord;
        if (
          !coord ||
          typeof record(coord)?.lat !== "function" ||
          typeof record(coord)?.lng !== "function"
        )
          return;
        const latlng = coord as NaverLatLng;
        const point = { latitude: latlng.lat(), longitude: latlng.lng() };
        if (isMapPoint(point)) this.callbacks.onPick(point);
      }),
    );
    this.scheduleBounds();
  }

  private scheduleBounds() {
    if (this.disposed) return;
    clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => {
      if (this.disposed) return;
      const bounds = readMapBounds(this.map.getBounds());
      if (!bounds) return;
      const key = [bounds.south, bounds.west, bounds.north, bounds.east]
        .map((value) => value.toFixed(6))
        .join(":");
      if (key === this.lastBounds) return;
      this.lastBounds = key;
      this.callbacks.onBoundsChange(bounds);
    }, 250);
  }

  update(pins: MapPin[], selectedId: string | null, picking: boolean) {
    if (this.disposed) return;
    this.picking = picking;
    this.map.setOptions({ cursor: picking ? "crosshair" : "grab" });
    const validPins = new Map(pins.filter(isMapPoint).map((pin) => [pin.id, pin]));
    for (const [id, owned] of this.markers) {
      if (validPins.has(id)) continue;
      this.sdk.Event.removeListener(owned.listener);
      owned.marker.setMap(null);
      this.markers.delete(id);
    }
    for (const pin of validPins.values()) {
      const selected = pin.id === selectedId;
      const options = {
        position: new this.sdk.LatLng(pin.latitude, pin.longitude),
        icon: markerIcon(pin, selected),
        title: pin.label.slice(0, 160),
        zIndex: selected ? 1000 : 1,
      };
      const existing = this.markers.get(pin.id);
      if (existing) existing.marker.setOptions(options);
      else {
        const marker = new this.sdk.Marker({ map: this.map, ...options });
        const listener = this.sdk.Event.addListener(marker, "click", (event) => {
          const domEvent = record(record(event)?.domEvent);
          if (typeof domEvent?.stopPropagation === "function")
            (domEvent.stopPropagation as () => void).call(domEvent);
          if (!this.disposed) this.callbacks.onSelect(pin.id);
        });
        this.markers.set(pin.id, { marker, listener });
      }
    }
    if (selectedId && selectedId !== this.selectedId) {
      const selected = validPins.get(selectedId);
      if (selected) this.map.panTo(new this.sdk.LatLng(selected.latitude, selected.longitude));
    }
    this.selectedId = selectedId;
  }

  focus(point: MapPoint & { zoom?: number }) {
    if (this.disposed || !isMapPoint(point)) return;
    if (typeof point.zoom === "number" && Number.isFinite(point.zoom))
      this.map.setZoom(Math.min(20, Math.max(6, Math.round(point.zoom))));
    this.map.panTo(new this.sdk.LatLng(point.latitude, point.longitude));
  }

  resize() {
    if (this.disposed) return;
    this.map.autoResize();
    this.scheduleBounds();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.boundsTimer);
    for (const listener of this.listeners) this.sdk.Event.removeListener(listener);
    for (const owned of this.markers.values()) {
      this.sdk.Event.removeListener(owned.listener);
      owned.marker.setMap(null);
    }
    this.markers.clear();
    this.map.destroy();
  }
}
