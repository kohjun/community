import assert from "node:assert/strict";
import test from "node:test";
import {
  geocodeAddress,
  markerIcon,
  NaverMapSession,
  naverMapsScriptUrl,
  parseGeocodedAddresses,
  readMapBounds,
  subscribeNaverAuthFailure,
  type MapBounds,
  type MapPin,
  type MapPoint,
  type NaverBounds,
  type NaverGeocodeService,
  type NaverHtmlIcon,
  type NaverLatLng,
  type NaverListener,
  type NaverMapInstance,
  type NaverMapsSDK,
  type NaverMarkerInstance,
  type NaverRuntime,
} from "../src/lib/naver-maps";

const response = {
  v2: {
    status: "OK",
    addresses: [
      {
        x: "126.978",
        y: "37.5665",
        roadAddress: "서울특별시 중구 세종대로 110",
        jibunAddress: "서울 중구 태평로1가 31",
      },
    ],
  },
};

function service(callback: NaverGeocodeService["geocode"]): NaverGeocodeService {
  return { Status: { OK: 200 }, geocode: callback };
}

function bounds(south = 37.5, west = 126.9, north = 37.6, east = 127): NaverBounds {
  return {
    getSW: () => ({ lat: () => south, lng: () => west }),
    getNE: () => ({ lat: () => north, lng: () => east }),
  };
}

test("the map SDK uses the official HTTPS endpoint, ncpKeyId and geocoder without key query injection", () => {
  const url = new URL(naverMapsScriptUrl("  example&callback=evil  "));
  assert.equal(url.origin, "https://oapi.map.naver.com");
  assert.equal(url.pathname, "/openapi/v3/maps.js");
  assert.equal(url.searchParams.get("ncpKeyId"), "example&callback=evil");
  assert.equal(url.searchParams.get("submodules"), "geocoder");
  assert.equal(url.searchParams.has("callback"), false);
});

test("geocoding converts NAVER x/y into longitude/latitude and rejects malformed, blank and impossible coordinates", () => {
  assert.deepEqual(parseGeocodedAddresses(response), [
    {
      latitude: 37.5665,
      longitude: 126.978,
      address: "서울특별시 중구 세종대로 110",
      roadAddress: "서울특별시 중구 세종대로 110",
      jibunAddress: "서울 중구 태평로1가 31",
    },
  ]);
  const valid = response.v2.addresses[0]!;
  const invalid = ["", "NaN", "Infinity", true, null, "200", "1e2"];
  assert.equal(
    parseGeocodedAddresses({
      v2: {
        status: "OK",
        addresses: [
          ...invalid.map((x) => ({ ...valid, x })),
          valid,
          valid,
          { ...valid, y: "95" },
          { ...valid, roadAddress: "", jibunAddress: "" },
        ],
      },
    }).length,
    1,
  );
  assert.deepEqual(parseGeocodedAddresses({ v2: { status: "ERROR", addresses: [valid] } }), []);
  assert.deepEqual(parseGeocodedAddresses({ result: { items: [valid] } }), []);
});

test("address search trims the query and distinguishes empty results from provider errors", async () => {
  let query = "";
  const found = await geocodeAddress("  세종대로 110  ", {
    service: service((options, done) => {
      query = options.query;
      done(200, response);
    }),
  });
  assert.equal(query, "세종대로 110");
  assert.equal(found[0]?.latitude, 37.5665);
  assert.deepEqual(
    await geocodeAddress("없는 주소", {
      service: service((_options, done) => done(200, { v2: { status: "OK", addresses: [] } })),
    }),
    [],
  );
  await assert.rejects(
    geocodeAddress("서울 주소", { service: service((_options, done) => done(500, response)) }),
    /검색하지 못/,
  );
  await assert.rejects(
    geocodeAddress("서울 주소", {
      service: service((_options, done) =>
        done(200, { v2: { status: "INVALID_REQUEST", addresses: [] } }),
      ),
    }),
    /응답을 확인/,
  );
  await assert.rejects(
    geocodeAddress("a", { service: service(() => assert.fail("must not call API")) }),
    /2~200/,
  );
});

test("aborted and timed out geocoding ignores late provider callbacks", async () => {
  const controller = new AbortController();
  let complete: ((status: number | string, response: unknown) => void) | undefined;
  const pending = geocodeAddress("서울 주소", {
    signal: controller.signal,
    service: service((_options, done) => {
      complete = done;
    }),
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  complete?.(200, response);
  const timedOut = geocodeAddress("서울 주소", {
    timeoutMs: 5,
    service: service((_options, done) => {
      complete = done;
    }),
  });
  await assert.rejects(timedOut, /지연/);
  complete?.(200, response);
});

test("authentication failure subscribers retain and restore the prior callback even with overlapping map mounts", () => {
  const called: string[] = [];
  const original = () => {
    called.push("original");
  };
  const runtime: NaverRuntime = { navermap_authFailure: original };
  const first = subscribeNaverAuthFailure(() => called.push("first"), runtime);
  const second = subscribeNaverAuthFailure(() => called.push("second"), runtime);
  first();
  runtime.navermap_authFailure?.();
  assert.deepEqual(called, ["original", "second"]);
  second();
  assert.equal(runtime.navermap_authFailure, original);
  const unsubscribe = subscribeNaverAuthFailure(() => called.push("third"), runtime);
  const external = () => called.push("external");
  runtime.navermap_authFailure = external;
  unsubscribe();
  assert.equal(runtime.navermap_authFailure, external);
});

test("place marker labels cannot add HTML attributes or scripts", () => {
  const icon = markerIcon(
    {
      id: "place",
      kind: 'event\" onclick=\"evil' as MapPin["kind"],
      latitude: 37,
      longitude: 127,
      label: '<img src=x onerror="evil"> & "',
    },
    true,
  );
  assert.equal(icon.content.includes("<img"), false);
  assert.equal(icon.content.includes('onclick="evil'), false);
  assert.match(icon.content, /&lt;img/);
  assert.match(icon.content, /&quot;/);
  assert.match(icon.content, /naver-event-pin--place is-selected/);
});

test("map bounds discard invalid or wrapped coordinates before making a viewport request", () => {
  assert.deepEqual(readMapBounds(bounds()), { south: 37.5, west: 126.9, north: 37.6, east: 127 });
  assert.equal(readMapBounds(bounds(38, 126, 37, 127)), null);
  assert.equal(readMapBounds(bounds(37, 181, 38, 182)), null);
  assert.equal(readMapBounds(bounds(37, 170, 38, -170)), null);
  assert.equal(readMapBounds(bounds(NaN)), null);
});

function fakeSDK() {
  class LatLng implements NaverLatLng {
    constructor(
      readonly latitude: number,
      readonly longitude: number,
    ) {}
    lat() {
      return this.latitude;
    }
    lng() {
      return this.longitude;
    }
  }
  class MapInstance implements NaverMapInstance {
    bounds = bounds();
    center: NaverLatLng;
    zoom = 12;
    destroyed = 0;
    resized = 0;
    cursor = "";
    constructor(_element: HTMLElement, options: { center: NaverLatLng }) {
      this.center = options.center;
    }
    getBounds() {
      return this.bounds;
    }
    panTo(point: NaverLatLng) {
      this.center = point;
    }
    setZoom(zoom: number) {
      this.zoom = zoom;
    }
    setOptions(options: { cursor?: string }) {
      this.cursor = options.cursor ?? "";
    }
    autoResize() {
      this.resized++;
    }
    destroy() {
      this.destroyed++;
    }
  }
  class MarkerInstance implements NaverMarkerInstance {
    map: NaverMapInstance | null;
    options: { position: NaverLatLng; icon: NaverHtmlIcon; title: string; zIndex: number };
    constructor(options: {
      map: NaverMapInstance;
      position: NaverLatLng;
      icon: NaverHtmlIcon;
      title: string;
      zIndex: number;
    }) {
      this.map = options.map;
      this.options = options;
      createdMarkers.push(this);
    }
    setMap(map: NaverMapInstance | null) {
      this.map = map;
    }
    setOptions(options: {
      position: NaverLatLng;
      icon: NaverHtmlIcon;
      title: string;
      zIndex: number;
    }) {
      this.options = options;
    }
  }
  const createdMarkers: MarkerInstance[] = [];
  const listeners = new Set<{
    target: object;
    name: string;
    callback: (event?: unknown) => void;
  }>();
  const emit = (target: object, name: string, event?: unknown) => {
    for (const listener of [...listeners])
      if (listener.target === target && listener.name === name) listener.callback(event);
  };
  const sdk: NaverMapsSDK = {
    Map: MapInstance,
    LatLng,
    Marker: MarkerInstance,
    Position: { RIGHT_CENTER: 2 },
    Event: {
      addListener(target, name, callback) {
        const listener = { target, name, callback };
        listeners.add(listener);
        return listener;
      },
      removeListener(listener: NaverListener) {
        listeners.delete(
          listener as { target: object; name: string; callback: (event?: unknown) => void },
        );
      },
    },
  };
  return { sdk, createdMarkers, listeners, emit, LatLng, MapInstance };
}
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("map sessions update selections, remove deleted markers and ignore pick events outside registration", async () => {
  const fake = fakeSDK();
  const selections: string[] = [];
  const picks: MapPoint[] = [];
  const viewports: MapBounds[] = [];
  const session = new NaverMapSession(fake.sdk, {} as HTMLElement, {
    onSelect: (id) => selections.push(id),
    onBoundsChange: (bounds) => viewports.push(bounds),
    onPick: (point) => picks.push(point),
  });
  const map = session.map as InstanceType<typeof fake.MapInstance>;
  const pins: MapPin[] = [
    { id: "a", kind: "place", label: "장소 A", latitude: 37.53, longitude: 126.91 },
    { id: "b", kind: "event", label: "이벤트 B", latitude: 37.56, longitude: 126.93 },
  ];
  session.update(pins, "b", false);
  const selected = fake.createdMarkers[1]!;
  assert.equal(map.center.lat(), pins[1]?.latitude);
  assert.equal(selected.options.zIndex, 1000);
  fake.emit(selected, "click");
  assert.deepEqual(selections, ["b"]);
  fake.emit(map, "click", { coord: new fake.LatLng(37.58, 126.94) });
  assert.deepEqual(picks, []);
  session.update([pins[0]!, { ...pins[1]!, id: "invalid", latitude: NaN }], "a", true);
  assert.equal(selected.map, null);
  assert.equal(fake.createdMarkers.length, 2);
  fake.emit(selected, "click");
  assert.deepEqual(selections, ["b"]);
  fake.emit(map, "click", { coord: new fake.LatLng(37.58, 126.94) });
  assert.deepEqual(picks, [{ latitude: 37.58, longitude: 126.94 }]);
  fake.emit(map, "idle");
  fake.emit(map, "idle");
  await pause(280);
  assert.equal(viewports.length, 1);
  fake.emit(map, "idle");
  await pause(280);
  assert.equal(viewports.length, 1);
  map.bounds = bounds(37.51, 126.9, 37.6, 127);
  fake.emit(map, "idle");
  session.dispose();
  session.dispose();
  await pause(280);
  assert.equal(viewports.length, 1);
  assert.equal(fake.listeners.size, 0);
  assert.equal(
    fake.createdMarkers.every((marker) => marker.map === null),
    true,
  );
  assert.equal(map.destroyed, 1);
  fake.emit(map, "click", { coord: new fake.LatLng(37.58, 126.94) });
  assert.equal(picks.length, 1);
});
