import { cafes } from "./cafes";
import type {
  BudgetPref,
  Cafe,
  DistancePref,
  GuideGroupId,
  MainScene,
  ParsedRequest,
  PriceLevel,
  QuietNeed,
  RankedCafe,
  RecommendationResult,
  SocketLevel,
  SocketNeed,
  StayIntent,
} from "./types";

function hasAny(query: string, terms: string[]) {
  return terms.some((term) => query.includes(term));
}

function openingHour(cafe: Cafe) {
  return Number.parseInt(cafe.weekdayHours.split(":")[0] ?? "9", 10);
}

function inferScene(query: string): MainScene {
  const studyScore = ["写论文", "论文", "自习", "学习", "办公", "改稿", "安静", "插座", "久坐"].filter((term) =>
    query.includes(term),
  ).length;
  const chatScore = ["聊天", "朋友", "见面", "坐坐", "约会", "氛围"].filter((term) => query.includes(term)).length;
  const quickScore = ["顺路", "带走", "赶时间", "早八", "早课", "买一杯", "快点", "路上"].filter((term) =>
    query.includes(term),
  ).length;

  if (studyScore >= chatScore && studyScore >= quickScore && studyScore > 0) {
    return "study";
  }

  if (chatScore >= quickScore && chatScore > 0) {
    return "chat";
  }

  return "quick_coffee";
}

function inferBudget(query: string): BudgetPref {
  if (hasAny(query, ["别太贵", "不太贵", "便宜", "平价", "性价比", "省钱", "预算别太高"])) {
    return "low";
  }

  if (hasAny(query, ["预算高", "贵一点", "价格无所谓", "预算充足", "贵都行"])) {
    return "high";
  }

  if (hasAny(query, ["中等预算", "正常预算", "价格中位"])) {
    return "medium";
  }

  return "any";
}

function inferQuietNeed(query: string): QuietNeed {
  if (hasAny(query, ["安静", "写论文", "自习", "学习", "办公", "改稿"])) {
    return "high";
  }

  if (hasAny(query, ["聊天", "见面", "朋友"])) {
    return "low";
  }

  return "medium";
}

function inferDistancePref(query: string): DistancePref {
  if (hasAny(query, ["近一点", "离学校近", "顺路", "最近", "别走太远", "赶时间"])) {
    return "near";
  }

  if (hasAny(query, ["多走几分钟也行", "远一点也可以", "不介意远", "走远点也行"])) {
    return "walk_ok";
  }

  return "any";
}

function inferSocketNeed(query: string): SocketNeed {
  if (hasAny(query, ["必须有插座", "一定要插座", "要充电", "电脑没电", "必须充电"])) {
    return "required";
  }

  if (query.includes("插座")) {
    return "preferred";
  }

  return "no";
}

function inferStayIntent(query: string): StayIntent {
  if (hasAny(query, ["久坐", "写论文", "自习", "待一会", "待很久", "办公", "坐一下午"])) {
    return "long";
  }

  if (hasAny(query, ["顺路", "带走", "赶时间", "买一杯", "马上上课", "快点"])) {
    return "short";
  }

  return "any";
}

export function parseRecommendationQuery(rawQuery: string): ParsedRequest {
  const query = rawQuery.toLowerCase();

  return {
    rawQuery,
    scene: inferScene(query),
    budget: inferBudget(query),
    quietNeed: inferQuietNeed(query),
    distancePref: inferDistancePref(query),
    socketNeed: inferSocketNeed(query),
    earlyNeed: hasAny(query, ["早八", "早课", "早上", "一早", "晨间"]),
    stayIntent: inferStayIntent(query),
  };
}

function scoreDistance(cafe: Cafe, distancePref: DistancePref) {
  if (distancePref === "near") {
    return Math.max(0, 8 - cafe.walkTimeMin) * 1.4;
  }

  if (distancePref === "walk_ok") {
    return Math.max(0, 10 - cafe.walkTimeMin) * 0.7;
  }

  return Math.max(0, 7 - cafe.walkTimeMin) * 0.5;
}

function scoreBudget(priceLevel: PriceLevel, budget: BudgetPref) {
  if (budget === "low") {
    if (priceLevel === "low") return 5;
    if (priceLevel === "medium") return 2;
    return -4;
  }

  if (budget === "medium") {
    if (priceLevel === "medium") return 3;
    if (priceLevel === "low") return 2;
    return -1;
  }

  if (budget === "high") {
    return priceLevel === "high" ? 2 : 1;
  }

  return 0;
}

function scoreSocket(socketLevel: SocketLevel, socketNeed: SocketNeed) {
  if (socketNeed === "required") {
    if (socketLevel === "good") return 6;
    if (socketLevel === "limited") return 2;
    return -7;
  }

  if (socketNeed === "preferred") {
    if (socketLevel === "good") return 4;
    if (socketLevel === "limited") return 2;
    return -2;
  }

  return 0;
}

function scoreScene(cafe: Cafe, parsed: ParsedRequest) {
  if (parsed.scene === cafe.mainScene) {
    return 6;
  }

  if (parsed.scene === "study" && cafe.quietScore >= 4) {
    return 5;
  }

  if (parsed.scene === "chat" && cafe.tags.some((tag) => ["文艺氛围", "设计感", "街景感", "社区感"].includes(tag))) {
    return 3;
  }

  if (parsed.scene === "quick_coffee" && cafe.earlyFriendly !== "no") {
    return 2;
  }

  return 0;
}

function scoreStayIntent(cafe: Cafe, stayIntent: StayIntent) {
  if (stayIntent === "long") {
    let score = 0;
    if (cafe.mainScene === "study") score += 4;
    if (cafe.quietScore >= 4) score += 3;
    if (cafe.socketLevel === "good") score += 2;
    if (cafe.weekdayHours.includes("22:00")) score += 2;
    return score;
  }

  if (stayIntent === "short") {
    let score = 0;
    if (cafe.mainScene === "quick_coffee") score += 4;
    if (cafe.walkTimeMin <= 4) score += 3;
    return score;
  }

  return 0;
}

function scoreQuiet(cafe: Cafe, quietNeed: QuietNeed) {
  if (quietNeed === "high") {
    return cafe.quietScore * 1.8;
  }

  if (quietNeed === "medium") {
    return cafe.quietScore * 1;
  }

  return 0;
}

function scoreEarly(cafe: Cafe, earlyNeed: boolean) {
  if (!earlyNeed) return 0;
  if (cafe.earlyFriendly === "yes") return 5;
  if (cafe.earlyFriendly === "maybe") return 1;
  return -5;
}

function scoreSpecialty(cafe: Cafe, query: string) {
  if (!hasAny(query, ["手冲", "精品", "特调", "豆子", "风味"])) {
    return 0;
  }

  return cafe.tags.some((tag) => ["特调精品", "精品友好", "手冲友好", "特调"].includes(tag)) ? 6 : 0;
}

function scoreChatMood(cafe: Cafe, query: string) {
  if (!hasAny(query, ["聊天", "朋友", "见面", "坐坐", "约会"])) {
    return 0;
  }

  return cafe.tags.some((tag) => ["文艺氛围", "设计感", "街景感", "社区感"].includes(tag)) ? 4 : 0;
}

function buildFitReasons(cafe: Cafe, parsed: ParsedRequest, query: string) {
  const reasons: string[] = [];

  if (parsed.distancePref === "near" || cafe.walkTimeMin <= 4) {
    reasons.push(`从${cafe.nearestGate}过去只要 ${cafe.walkTimeMin} 分钟，顺路感更强。`);
  }

  if (parsed.earlyNeed && cafe.earlyFriendly === "yes") {
    reasons.push("开门更早，适合早八前顺手买一杯。");
  }

  if (parsed.budget === "low" && cafe.priceLevel === "low") {
    reasons.push("价格更稳，预算压力不会太大。");
  }

  if (parsed.quietNeed === "high" && cafe.quietScore >= 4) {
    reasons.push("安静和久坐表现更稳，更适合学习或改稿。");
  }

  if (parsed.socketNeed !== "no" && cafe.socketLevel === "good") {
    reasons.push("插座更稳，带电脑会更安心。");
  } else if (parsed.socketNeed === "preferred" && cafe.socketLevel === "limited") {
    reasons.push("有一定插座条件，比纯带走店更适合待一会。");
  }

  if (parsed.stayIntent === "long" && cafe.weekdayHours.includes("22:00")) {
    reasons.push("营业时间长，临时把它当工作空间也更从容。");
  }

  if (parsed.scene === "chat" && cafe.tags.some((tag) => ["文艺氛围", "设计感", "街景感", "社区感"].includes(tag))) {
    reasons.push("氛围更适合聊天，不会只有买完就走的感觉。");
  }

  if (hasAny(query, ["手冲", "精品", "特调", "豆子", "风味"]) && cafe.tags.some((tag) => ["特调精品", "精品友好", "手冲友好", "特调"].includes(tag))) {
    reasons.push("特调和豆子选择更丰富，喝法不会太单一。");
  }

  if (reasons.length < 2) {
    reasons.push(cafe.summary);
  }

  if (reasons.length < 3) {
    reasons.push(`工作日营业 ${cafe.weekdayHours}，整体节奏比较${openingHour(cafe) <= 8 ? "早" : "稳"}。`);
  }

  return reasons.slice(0, 3);
}

function buildTradeoffs(cafe: Cafe, parsed: ParsedRequest) {
  const tradeoffs: string[] = [];

  if (cafe.priceLevel === "high") {
    tradeoffs.push("预算会明显更高一些。");
  }

  if (cafe.walkTimeMin >= 7 && parsed.distancePref !== "walk_ok") {
    tradeoffs.push("需要多走几分钟，不算最省时间。");
  }

  if (parsed.socketNeed !== "no" && cafe.socketLevel === "none") {
    tradeoffs.push("基本不能把它当插座友好的工作位。");
  }

  if (parsed.quietNeed === "high" && cafe.quietScore <= 3) {
    tradeoffs.push("安静程度不算顶格，更适合短暂停留。");
  }

  if (parsed.earlyNeed && cafe.earlyFriendly === "maybe") {
    tradeoffs.push("早上可用性还行，但不如最稳的早八店。");
  }

  if (tradeoffs.length === 0) {
    tradeoffs.push("整体比较均衡，但总有一项不会是绝对最强。");
  }

  return tradeoffs.slice(0, 2);
}

function buildParsedRequestSummary(parsed: ParsedRequest) {
  const sceneLabel =
    parsed.scene === "study" ? "找个能安静待一会的地方" : parsed.scene === "chat" ? "找家适合见面聊天的店" : "赶时间顺路买一杯";
  const budgetLabel =
    parsed.budget === "low" ? "预算别太高" : parsed.budget === "high" ? "预算不是主要问题" : "预算保持在正常范围";
  const socketLabel =
    parsed.socketNeed === "required" ? "插座是刚需" : parsed.socketNeed === "preferred" ? "有插座会更舒服" : "插座不是重点";

  return `你现在更像是在 ${sceneLabel}，同时希望 ${budgetLabel}，而且 ${socketLabel}。`;
}

function buildLocalExplanation(parsed: ParsedRequest, topPicks: RankedCafe[]) {
  const [first, second] = topPicks;
  return `这次我先把 ${first.cafe.name} 放前面，因为它更贴近你当下最核心的需求。${second.cafe.name} 不是同款备份，而是在距离、氛围或久坐条件上给你另一个更合理的方向。`;
}

function buildComparisonNote(parsed: ParsedRequest, topPicks: RankedCafe[]) {
  const [first, second] = topPicks;

  if (parsed.scene === "study") {
    return `如果你更想稳稳坐下来，先去 ${first.cafe.name}；如果你想兼顾距离和日常喝感，${second.cafe.name} 会更轻一点。`;
  }

  if (parsed.scene === "chat") {
    return `${first.cafe.name} 更偏向这次就能坐下聊，${second.cafe.name} 则更像是风格和体验更鲜明的另一种选法。`;
  }

  return `${first.cafe.name} 更偏效率和顺路，${second.cafe.name} 则是在不完全放弃体验的前提下给你的第二选择。`;
}

function buildTradeoffNote(parsed: ParsedRequest, topPicks: RankedCafe[]) {
  const tradeoffs = topPicks.flatMap((pick) => pick.tradeoffs);

  if (parsed.socketNeed !== "no" && !topPicks.some((pick) => pick.cafe.socketLevel === "good")) {
    return "这次两家里都不是纯插座型工作位，如果你要长时间开电脑，仍然要优先看座位情况。";
  }

  if (tradeoffs.some((item) => item.includes("预算"))) {
    return "这次的取舍主要在预算和体验之间，越有风味感的店通常也更贵一点。";
  }

  if (tradeoffs.some((item) => item.includes("多走几分钟"))) {
    return "这次没有哪家同时做到最近又最全能，所以还是要在步行距离和体验之间做一点平衡。";
  }

  return "这次两家都能解决你的主要需求，但没有哪一家会把距离、预算和体验同时做到满分。";
}

export function buildLocalRecommendation(rawQuery: string): RecommendationResult {
  const parsedRequest = parseRecommendationQuery(rawQuery);
  const query = rawQuery.toLowerCase();

  const ranked = cafes
    .map((cafe) => {
      const score =
        scoreScene(cafe, parsedRequest) +
        scoreBudget(cafe.priceLevel, parsedRequest.budget) +
        scoreDistance(cafe, parsedRequest.distancePref) +
        scoreSocket(cafe.socketLevel, parsedRequest.socketNeed) +
        scoreQuiet(cafe, parsedRequest.quietNeed) +
        scoreEarly(cafe, parsedRequest.earlyNeed) +
        scoreStayIntent(cafe, parsedRequest.stayIntent) +
        scoreSpecialty(cafe, query) +
        scoreChatMood(cafe, query);

      return {
        cafe,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  const topPicks = ranked.slice(0, 2).map(({ cafe }) => ({
    cafe,
    fitReasons: buildFitReasons(cafe, parsedRequest, query),
    tradeoffs: buildTradeoffs(cafe, parsedRequest),
  }));

  return {
    parsedRequest,
    parsedRequestSummary: buildParsedRequestSummary(parsedRequest),
    topPicks,
    explanation: buildLocalExplanation(parsedRequest, topPicks),
    comparisonNote: buildComparisonNote(parsedRequest, topPicks),
    tradeoffNote: buildTradeoffNote(parsedRequest, topPicks),
    modelUsed: "Local fallback",
  };
}

export function getGuideGroupMatches(groupId: GuideGroupId) {
  switch (groupId) {
    case "all":
      return cafes;
    case "early":
      return cafes.filter((cafe) => cafe.earlyFriendly !== "no");
    case "study":
      return cafes.filter((cafe) => cafe.mainScene === "study" || cafe.quietScore >= 4);
    case "chat":
      return cafes.filter((cafe) => cafe.mainScene === "chat");
    case "specialty":
      return cafes.filter((cafe) =>
        cafe.tags.some((tag) => ["特调精品", "精品友好", "手冲友好", "特调"].includes(tag)),
      );
    case "editorial":
      return cafes.filter((cafe) =>
        cafe.tags.some((tag) => ["文艺氛围", "设计感", "街景感", "社区感"].includes(tag)),
      );
    default:
      return cafes;
  }
}
