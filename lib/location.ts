import type { Cafe } from "./types";

export type WalkingDistance = {
  distanceM: number;
  durationMin: number;
  source: "amap_walking";
};

export type WalkingDistanceMap = Record<string, WalkingDistance>;

export function getCafeDestination(cafe: Cafe) {
  return {
    longitude: cafe.entranceLongitude ?? cafe.longitude,
    latitude: cafe.entranceLatitude ?? cafe.latitude,
  };
}

export function formatDistanceMeters(distanceM: number) {
  if (distanceM >= 1000) {
    return `${(distanceM / 1000).toFixed(distanceM >= 10000 ? 0 : 1)}km`;
  }

  return `${Math.max(0, Math.round(distanceM))}m`;
}

export function formatStaticWalk(cafe: Cafe) {
  return `从${cafe.nearestGate}约 ${cafe.walkTimeMin} 分钟 / ${formatDistanceMeters(cafe.walkDistanceM)}`;
}

export function formatWalkingDistance(distance: WalkingDistance) {
  return `距你步行约 ${distance.durationMin} 分钟 / ${formatDistanceMeters(distance.distanceM)}`;
}
