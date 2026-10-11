export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

// Browser geolocation cannot be aborted. Invalidated attempts settle immediately
// while callbacks from the browser remain harmless.
export function createLocationRequests() {
  let version = 0;
  let pending: { version: number; resolve: (value: GeoCoordinates | null) => void } | null = null;
  function cancel() {
    version += 1;
    const previous = pending;
    pending = null;
    previous?.resolve(null);
  }
  function begin() {
    cancel();
    const currentVersion = version;
    const result = new Promise<GeoCoordinates | null>((resolve) => {
      pending = { version: currentVersion, resolve };
    });
    const isCurrent = () => pending?.version === currentVersion && version === currentVersion;
    function complete(value: GeoCoordinates | null) {
      if (!isCurrent()) return false;
      const current = pending!;
      pending = null;
      current.resolve(value);
      return true;
    }
    return { result, isCurrent, complete };
  }
  return { begin, cancel };
}
