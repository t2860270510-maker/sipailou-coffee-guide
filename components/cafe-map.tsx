"use client";

import { useEffect, useRef, useState } from "react";

import {
  formatStaticWalk,
  formatWalkingDistance,
  getCafeDestination,
  type WalkingDistanceMap,
} from "../lib/location";
import type { Cafe } from "../lib/types";

type CafeMapProps = {
  cafes: Cafe[];
  walkingDistances: WalkingDistanceMap;
  highlightedCafeId: string | null;
  onHighlightCafe: (cafeId: string) => void;
  onSelectCafe: (cafe: Cafe) => void;
};

type MapState = "missing-key" | "loading" | "ready" | "error";

type AMapApi = {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMap;
  Marker: new (options: Record<string, unknown>) => AMapMarker;
  InfoWindow: new (options: Record<string, unknown>) => AMapInfoWindow;
  Pixel: new (x: number, y: number) => unknown;
  Scale?: new (options?: Record<string, unknown>) => unknown;
  ToolBar?: new (options?: Record<string, unknown>) => unknown;
};

type AMapMap = {
  add: (overlay: AMapMarker | AMapMarker[]) => void;
  addControl?: (control: unknown) => void;
  destroy: () => void;
  setFitView?: (overlays?: AMapMarker[], immediately?: boolean, padding?: number[]) => void;
};

type AMapMarker = {
  on: (eventName: string, handler: () => void) => void;
  setzIndex?: (zIndex: number) => void;
};

type AMapInfoWindow = {
  close: () => void;
  open: (map: AMapMap, position: [number, number]) => void;
  setContent: (content: HTMLElement) => void;
};

declare global {
  interface Window {
    _AMapSecurityConfig?: {
      securityJsCode: string;
    };
  }
}

function formatPrice(priceLevel: Cafe["priceLevel"]) {
  if (priceLevel === "low") return "预算友好";
  if (priceLevel === "medium") return "价格中位";
  return "预算偏高";
}

function getCafePosition(cafe: Cafe): [number, number] {
  const destination = getCafeDestination(cafe);
  return [destination.longitude, destination.latitude];
}

function getMapCenter(cafes: Cafe[]): [number, number] {
  const positions = cafes.map(getCafePosition);
  const longitude = positions.reduce((sum, [lng]) => sum + lng, 0) / positions.length;
  const latitude = positions.reduce((sum, [, lat]) => sum + lat, 0) / positions.length;

  return [longitude, latitude];
}

function getWalkLabel(cafe: Cafe, walkingDistances: WalkingDistanceMap) {
  const liveDistance = walkingDistances[cafe.id];
  return liveDistance ? formatWalkingDistance(liveDistance) : formatStaticWalk(cafe);
}

function createMarkerContent(cafe: Cafe, index: number, highlighted: boolean) {
  const marker = document.createElement("div");
  marker.className = `map-marker${highlighted ? " map-marker-active" : ""}`;
  marker.setAttribute("aria-label", cafe.name);

  const number = document.createElement("span");
  number.className = "map-marker-index";
  number.textContent = String(index + 1);

  const label = document.createElement("span");
  label.className = "map-marker-label";
  label.textContent = cafe.name;

  marker.append(number, label);
  return marker;
}

function createInfoWindowContent({
  cafe,
  walkingDistances,
  onSelectCafe,
}: {
  cafe: Cafe;
  walkingDistances: WalkingDistanceMap;
  onSelectCafe: (cafe: Cafe) => void;
}) {
  const shell = document.createElement("div");
  shell.className = "map-info-window";

  const location = document.createElement("p");
  location.className = "map-info-eyebrow";
  location.textContent = cafe.locationText;

  const title = document.createElement("h3");
  title.textContent = cafe.name;

  const summary = document.createElement("p");
  summary.className = "map-info-summary";
  summary.textContent = cafe.summary;

  const facts = document.createElement("div");
  facts.className = "map-info-facts";

  for (const fact of [getWalkLabel(cafe, walkingDistances), cafe.weekdayHours, formatPrice(cafe.priceLevel)]) {
    const item = document.createElement("span");
    item.textContent = fact;
    facts.append(item);
  }

  const button = document.createElement("button");
  button.className = "map-info-button";
  button.type = "button";
  button.textContent = "看这家更细一点";
  button.addEventListener("click", () => onSelectCafe(cafe));

  shell.append(location, title, summary, facts, button);
  return shell;
}

export function CafeMap({ cafes, walkingDistances, highlightedCafeId, onHighlightCafe, onSelectCafe }: CafeMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const markerElementsRef = useRef(new Map<string, HTMLElement>());
  const walkingDistancesRef = useRef(walkingDistances);
  const onHighlightCafeRef = useRef(onHighlightCafe);
  const onSelectCafeRef = useRef(onSelectCafe);
  const [mapState, setMapState] = useState<MapState>(() =>
    process.env.NEXT_PUBLIC_AMAP_JS_KEY ? "loading" : "missing-key",
  );

  useEffect(() => {
    walkingDistancesRef.current = walkingDistances;
    onHighlightCafeRef.current = onHighlightCafe;
    onSelectCafeRef.current = onSelectCafe;
  }, [onHighlightCafe, onSelectCafe, walkingDistances]);

  useEffect(() => {
    const container = mapContainerRef.current;
    const apiKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY;
    const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_JS_CODE;

    if (!container || !apiKey || cafes.length === 0) {
      setMapState(apiKey ? "error" : "missing-key");
      return;
    }

    const resolvedApiKey = apiKey;

    if (securityCode) {
      window._AMapSecurityConfig = {
        securityJsCode: securityCode,
      };
    }

    let map: AMapMap | null = null;
    let cancelled = false;
    const markerElements = markerElementsRef.current;

    async function loadMap() {
      setMapState("loading");

      try {
        const { load } = await import("@amap/amap-jsapi-loader");
        const AMap = (await load({
          key: resolvedApiKey,
          version: "2.0",
          plugins: ["AMap.Scale", "AMap.ToolBar"],
        })) as AMapApi;

        if (cancelled || !container) return;

        map = new AMap.Map(container, {
          center: getMapCenter(cafes),
          zoom: 15,
          viewMode: "2D",
          resizeEnable: true,
        });

        if (AMap.Scale && map.addControl) {
          map.addControl(new AMap.Scale());
        }

        if (AMap.ToolBar && map.addControl) {
          map.addControl(
            new AMap.ToolBar({
              position: {
                top: "12px",
                right: "12px",
              },
            }),
          );
        }

        const infoWindow = new AMap.InfoWindow({
          anchor: "bottom-center",
          closeWhenClickMap: true,
          offset: new AMap.Pixel(0, -22),
        });

        const markers = cafes.map((cafe, index) => {
          const position = getCafePosition(cafe);
          const content = createMarkerContent(cafe, index, false);
          markerElements.set(cafe.id, content);

          const marker = new AMap.Marker({
            position,
            content,
            anchor: "bottom-center",
            zIndex: 100 + index,
          });

          marker.on("click", () => {
            markerElements.forEach((element) => element.classList.remove("map-marker-active"));
            content.classList.add("map-marker-active");
            marker.setzIndex?.(500);
            onHighlightCafeRef.current(cafe.id);
            infoWindow.setContent(createInfoWindowContent({ cafe, walkingDistances: walkingDistancesRef.current, onSelectCafe: onSelectCafeRef.current }));
            infoWindow.open(map as AMapMap, position);
          });
          marker.on("mouseover", () => onHighlightCafeRef.current(cafe.id));

          return marker;
        });

        map.add(markers);
        map.setFitView?.(markers, false, [34, 34, 34, 34]);
        setMapState("ready");
      } catch {
        if (!cancelled) {
          setMapState("error");
        }
      }
    }

    void loadMap();

    return () => {
      cancelled = true;
      markerElements.clear();
      map?.destroy();
      map = null;
    };
  }, [cafes]);

  useEffect(() => {
    markerElementsRef.current.forEach((element, cafeId) => {
      element.classList.toggle("map-marker-active", cafeId === highlightedCafeId);
    });
  }, [highlightedCafeId]);

  const showFallback = mapState === "missing-key" || mapState === "error";

  return (
    <div className="shop-map-panel" aria-label="咖啡店高德地图">
      <div ref={mapContainerRef} className="shop-map-canvas" aria-hidden={showFallback} />

      {mapState === "loading" ? (
        <div className="shop-map-state" role="status">
          正在加载高德地图
        </div>
      ) : null}

      {showFallback ? (
        <div className="shop-map-fallback" role="status">
          <p>{mapState === "missing-key" ? "配置高德 JS API 后显示地图点位。" : "高德地图暂时没有加载成功。"}</p>
          <span>店铺卡片和筛选仍可正常浏览。</span>
        </div>
      ) : null}
    </div>
  );
}
