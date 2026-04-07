export type PriceLevel = "low" | "medium" | "high";
export type SocketLevel = "none" | "limited" | "good";
export type MainScene = "quick_coffee" | "study" | "chat";
export type BudgetPref = PriceLevel | "any";
export type QuietNeed = "low" | "medium" | "high";
export type DistancePref = "near" | "walk_ok" | "any";
export type SocketNeed = "required" | "preferred" | "no";
export type StayIntent = "short" | "long" | "any";
export type GuideGroupId =
  | "early"
  | "study"
  | "chat"
  | "specialty"
  | "editorial";

export interface Cafe {
  id: string;
  name: string;
  locationText: string;
  nearestGate: string;
  walkDistanceM: number;
  walkTimeMin: number;
  weekdayHours: string;
  weekendHours: string;
  earlyFriendly: "yes" | "maybe" | "no";
  priceLevel: PriceLevel;
  quietScore: number;
  socketLevel: SocketLevel;
  mainScene: MainScene;
  tags: string[];
  summary: string;
  recommendedItems: string[];
  notes: string;
  sourceNote: string;
  verifiedAt: string;
  coverImage: string;
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

export interface ParsedRequest {
  rawQuery: string;
  scene: MainScene;
  budget: BudgetPref;
  quietNeed: QuietNeed;
  distancePref: DistancePref;
  socketNeed: SocketNeed;
  earlyNeed: boolean;
  stayIntent: StayIntent;
}

export interface RankedCafe {
  cafe: Cafe;
  fitReasons: string[];
  tradeoffs: string[];
}

export interface RecommendationResult {
  parsedRequest: ParsedRequest;
  parsedRequestSummary: string;
  topPicks: RankedCafe[];
  explanation: string;
  comparisonNote: string;
  tradeoffNote: string;
  modelUsed: string;
}
