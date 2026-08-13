export type PriceLevel = "low" | "medium" | "high";
export type SocketLevel = "none" | "limited" | "good";
export type SeatLevel = "none" | "limited" | "adequate" | "spacious";
export type MainScene = "quick_coffee" | "study" | "chat";
export type BudgetPref = PriceLevel | "any";
export type QuietNeed = "low" | "medium" | "high";
export type DistancePref = "near" | "south_gate" | "east_gate" | "walk_ok" | "any";
export type SocketNeed = "required" | "preferred" | "no";
export type StayIntent = "short" | "long" | "any";
export type TriState = "yes" | "no" | "unknown";
export type CafeStatus = "active" | "inactive" | "temporarily_closed" | "permanently_closed";
export type DayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
export type EvidenceField = "hours" | "price" | "location" | "experience" | "menu" | "images";
export type GuideGroupId =
  | "all"
  | "early"
  | "study"
  | "chat"
  | "specialty"
  | "editorial";

export interface Evidence {
  sourceLabel: string;
  sourceUrl?: string;
  verifiedAt: string;
  verifiedBy: string;
  note?: string;
}

export type FieldEvidence = Partial<Record<EvidenceField, Evidence>>;

export interface HoursInterval {
  open: string;
  close: string;
}

export interface HoursException {
  date: string;
  closed?: boolean;
  intervals?: HoursInterval[];
  note?: string;
}

export interface StructuredHours {
  timezone: "Asia/Shanghai";
  weekly: Record<DayKey, HoursInterval[]>;
  exceptions: HoursException[];
}

export interface CafeImage {
  src: string;
  alt: string;
  caption: string;
  sourceLabel?: string;
  sourceUrl?: string;
  rights?: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface Cafe {
  id: string;
  name: string;
  aliases: string[];
  status: CafeStatus;
  locationText: string;
  address: string;
  nearestGate: string;
  walkDistanceM: number;
  walkTimeMin: number;
  amapPoiId?: string;
  longitude: number;
  latitude: number;
  entranceLongitude?: number;
  entranceLatitude?: number;
  amapAddress?: string;
  poiVerifiedAt?: string;
  structuredHours: StructuredHours;
  temporaryHoursNotice?: string;
  /** Human-readable compatibility fields, derived from structuredHours for the guide. */
  weekdayHours: string;
  weekendHours: string;
  earlyFriendly: "yes" | "maybe" | "no";
  priceRange: { min: number; max: number; currency: "CNY" };
  priceLevel: PriceLevel;
  quietScore: number;
  quietByPeriod: Partial<Record<"morning" | "afternoon" | "evening", number>>;
  seatLevel: SeatLevel;
  socketLevel: SocketLevel;
  wifi: TriState;
  restroom: TriState;
  takeout: TriState;
  stayIntent: StayIntent;
  mainScene: MainScene;
  tags: string[];
  recommendedItems: string[];
  dietaryOptions: string[];
  summary: string;
  notes: string;
  sourceLabel: string;
  sourceUrl?: string;
  sourceNote: string;
  verifiedAt: string;
  verifiedBy: string;
  fieldEvidence: FieldEvidence;
  coverImage: string;
  imageGallery: CafeImage[];
}

export interface GuideGroup {
  id: GuideGroupId;
  label: string;
  kicker: string;
  description: string;
}

export interface EditorialMoment {
  title: string;
  body: string;
  cafeId: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  selectedCafeIds?: string[];
}

export interface UserLocation {
  longitude: number;
  latitude: number;
  distances?: Record<string, { distanceM: number; durationMin: number }>;
}

export interface ParsedRequest {
  rawQuery: string;
  scene: MainScene | "any";
  budget: BudgetPref;
  quietNeed: QuietNeed;
  distancePref: DistancePref;
  socketNeed: SocketNeed;
  earlyNeed: boolean;
  stayIntent: StayIntent;
  specialtyNeed: boolean;
  takeoutNeed: boolean;
  openNowNeed: boolean;
  closingSoonConcern: boolean;
  dietaryNeed?: string;
}

export interface RankedCafe {
  cafe: Cafe;
  score: number;
  fitReasons: string[];
  tradeoffs: string[];
  hardExclusions: string[];
  distanceM: number;
  durationMin: number;
  hoursState?: "open" | "closing_soon" | "closed" | "unknown";
}

export interface RecommendationResult {
  parsedRequest: ParsedRequest;
  parsedRequestSummary: string;
  ranked: RankedCafe[];
  topPicks: RankedCafe[];
  excluded: RankedCafe[];
  explanation: string;
  comparisonNote: string;
  tradeoffNote: string;
  relaxationAdvice?: string;
  selectedCafeIds: string[];
  modelUsed: "local" | "deepseek";
}

export interface CoffeeDataSnapshot {
  version: string;
  source: "blob" | "static";
  degraded: boolean;
  warnings: string[];
  cafes: Cafe[];
  allCafes: Cafe[];
}

export interface CoffeeOverlayV1 {
  schemaVersion: 1;
  baseVersion: string;
  updatedAt: string;
  updatedBy: string;
  note: string;
  promptStyle: string;
  patches: Record<string, Partial<Cafe>>;
  additions: Cafe[];
}

export interface CoffeeReleaseV1 extends CoffeeOverlayV1 {
  releaseId: string;
  publishedAt: string;
  publishedBy: string;
  kind: "publish" | "rollback";
  rolledBackFrom?: string;
}

export interface PublishedPointerV1 {
  schemaVersion: 1;
  releasePath: string;
  releaseId: string;
  publishedAt: string;
  publishedCafeIds: string[];
}
