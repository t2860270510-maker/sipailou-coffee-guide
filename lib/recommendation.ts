import { cafes as staticCafes } from "./cafes";
import { formatHoursForDay, getCafeHoursState } from "./hours";
import type {
  Cafe,
  ConversationMessage,
  GuideGroupId,
  ParsedRequest,
  RankedCafe,
  RecommendationResult,
  UserLocation,
} from "./types";

export interface RecommendationInput {
  cafes: Cafe[];
  query: string;
  history?: ConversationMessage[];
  location?: UserLocation;
  now?: Date;
}

type PartialIntent = Partial<Omit<ParsedRequest, "rawQuery">>;

const contains = (query: string, terms: string[]) => terms.some((term) => query.includes(term));

function extractIntent(raw: string): PartialIntent {
  const query = raw.trim().toLowerCase();
  const intent: PartialIntent = {};

  const study = contains(query, ["写东西", "写论文", "论文", "自习", "学习", "办公", "改稿", "电脑", "久坐"]);
  const chat = contains(query, ["聊天", "朋友", "见面", "约会", "聚会"]);
  const quick = contains(query, ["顺路", "带走", "外带", "赶时间", "早八", "早课", "马上上课", "快点"]);
  if (study) intent.scene = "study";
  else if (chat) intent.scene = "chat";
  else if (quick) intent.scene = "quick_coffee";

  if (contains(query, ["预算再低", "预算更低", "再便宜", "低预算", "预算低", "便宜", "平价", "性价比", "省钱", "别太贵", "不太贵", "预算别太高"])) {
    intent.budget = "low";
  } else if (contains(query, ["中等预算", "正常预算", "价格中位"])) {
    intent.budget = "medium";
  } else if (contains(query, ["预算高", "贵一点", "预算充足", "价格无所谓", "贵都行"])) {
    intent.budget = "high";
  } else if (contains(query, ["预算不限", "不看价格"])) {
    intent.budget = "any";
  }

  if (contains(query, ["更安静", "安静一点", "安静", "写论文", "自习", "办公", "改稿"])) intent.quietNeed = "high";
  else if (chat) intent.quietNeed = "low";

  if (contains(query, ["南门", "蓁巷"])) intent.distancePref = "south_gate";
  else if (contains(query, ["东门", "成贤街"])) intent.distancePref = "east_gate";
  else if (contains(query, ["近一点", "离学校近", "顺路", "最近", "别走太远", "赶时间"])) intent.distancePref = "near";
  else if (contains(query, ["多走几分钟也行", "远一点也可以", "不介意远", "走远点也行"])) intent.distancePref = "walk_ok";

  if (contains(query, ["必须有插座", "一定要插座", "要充电", "电脑没电", "必须充电"])) intent.socketNeed = "required";
  else if (query.includes("插座")) intent.socketNeed = "preferred";

  if (contains(query, ["更适合久坐", "久坐", "写论文", "自习", "待一会", "坐一会", "坐一下午", "办公", "写东西"])) intent.stayIntent = "long";
  else if (quick) intent.stayIntent = "short";

  if (contains(query, ["早八", "早课", "早上", "一早", "晨间"])) intent.earlyNeed = true;
  if (contains(query, ["精品", "手冲", "特调", "豆子", "soe"])) intent.specialtyNeed = true;
  if (contains(query, ["外带", "带走", "打包"])) intent.takeoutNeed = true;
  if (contains(query, ["现在营业", "现在开门", "还开着", "现在能去", "营业吗"])) intent.openNowNeed = true;
  if (contains(query, ["快关门", "会不会关门", "还能坐多久", "要打烊"])) {
    intent.openNowNeed = true;
    intent.closingSoonConcern = true;
  }

  const dietary = ["燕麦奶", "无乳糖", "素食", "无糖"].find((term) => query.includes(term));
  if (dietary) intent.dietaryNeed = dietary;
  return intent;
}

function resolveIntent(query: string, history: ConversationMessage[] = []): ParsedRequest {
  const resolved: Omit<ParsedRequest, "rawQuery"> = {
    scene: "any",
    budget: "any",
    quietNeed: "medium",
    distancePref: "any",
    socketNeed: "no",
    earlyNeed: false,
    stayIntent: "any",
    specialtyNeed: false,
    takeoutNeed: false,
    openNowNeed: false,
    closingSoonConcern: false,
  };

  const messages = history.filter((item) => item.role === "user").slice(-6);
  for (const message of [...messages, { role: "user" as const, content: query }]) {
    Object.assign(resolved, extractIntent(message.content));
  }
  return { rawQuery: query, ...resolved };
}

export function parseRecommendationQuery(rawQuery: string, history: ConversationMessage[] = []) {
  return resolveIntent(rawQuery, history);
}

function addScore(bucket: { score: number; fit: string[]; tradeoffs: string[] }, points: number, positive: string, negative?: string) {
  bucket.score += points;
  if (points > 0 && positive && !bucket.fit.includes(positive)) bucket.fit.push(positive);
  if (points < 0 && negative && !bucket.tradeoffs.includes(negative)) bucket.tradeoffs.push(negative);
}

function rankCafe(cafe: Cafe, parsed: ParsedRequest, now: Date, location?: UserLocation): RankedCafe {
  const bucket = { score: 0, fit: [] as string[], tradeoffs: [] as string[] };
  const hardExclusions: string[] = [];
  const hours = getCafeHoursState(cafe, now);
  const liveDistance = location?.distances?.[cafe.id];
  const distanceM = liveDistance?.distanceM ?? cafe.walkDistanceM;
  const durationMin = liveDistance?.durationMin ?? cafe.walkTimeMin;

  if (cafe.status !== "active") hardExclusions.push("店铺当前未处于正常营业状态");
  if (parsed.openNowNeed && (hours.state === "closed" || hours.state === "unknown")) hardExclusions.push("当前无法确认处于营业中");
  if (parsed.socketNeed === "required" && cafe.socketLevel === "none") hardExclusions.push("没有可用插座");
  if (parsed.takeoutNeed && cafe.takeout !== "yes") hardExclusions.push("外带能力未确认");
  if (parsed.dietaryNeed && !cafe.dietaryOptions.includes(parsed.dietaryNeed)) hardExclusions.push(`未确认提供${parsed.dietaryNeed}`);

  if (parsed.scene === cafe.mainScene) addScore(bucket, 9, parsed.scene === "study" ? "空间更适合学习和写作" : parsed.scene === "chat" ? "氛围适合见面聊天" : "适合快速买走");
  else if (parsed.scene === "study") addScore(bucket, cafe.quietScore >= 4 ? 5 : -3, "安静度较高", "不是以学习久坐为主的空间");
  else if (parsed.scene === "chat" && cafe.mainScene === "quick_coffee") addScore(bucket, -2, "", "更偏快速购买，聊天空间有限");

  if (parsed.budget === "low") {
    if (cafe.priceLevel === "low") addScore(bucket, 8, "价格更友好");
    else if (cafe.priceLevel === "medium") addScore(bucket, 1, "价格处于中位", "不如低价店省钱");
    else addScore(bucket, -8, "", "价格不符合低预算优先");
  } else if (parsed.budget === "medium") {
    addScore(bucket, cafe.priceLevel === "medium" ? 4 : cafe.priceLevel === "low" ? 2 : -2, "价格处于日常区间", "价格略高");
  } else if (parsed.budget === "high" && cafe.priceLevel === "high") addScore(bucket, 3, "更适合把预算花在风味上");

  if (parsed.quietNeed === "high") addScore(bucket, (cafe.quietScore - 3) * 5, "相对更安静", "繁忙时段可能不够安静");
  else if (parsed.quietNeed === "low" && cafe.mainScene === "chat") addScore(bucket, 3, "聊天氛围更自然");

  if (parsed.stayIntent === "long") {
    const points = cafe.stayIntent === "long" ? 10 : cafe.seatLevel === "adequate" || cafe.seatLevel === "spacious" ? 4 : -7;
    addScore(bucket, points, "座位与停留条件更稳定", "座位有限，不适合长时间停留");
  } else if (parsed.stayIntent === "short" && cafe.stayIntent === "short") addScore(bucket, 5, "短停和外带效率高");

  if (parsed.socketNeed !== "no") {
    const points = cafe.socketLevel === "good" ? 9 : cafe.socketLevel === "limited" ? 3 : -8;
    addScore(bucket, points, cafe.socketLevel === "good" ? "插座条件相对稳定" : "有少量插座可用", "没有可用插座");
  }

  if (parsed.earlyNeed) {
    const points = cafe.earlyFriendly === "yes" ? 8 : cafe.earlyFriendly === "maybe" ? 1 : -7;
    addScore(bucket, points, "开门较早，适合早课前", "开门较晚，不适合早八");
  }
  if (parsed.specialtyNeed) {
    const specialty = cafe.tags.some((tag) => /精品|特调|特色豆|手冲/.test(tag));
    const deliberateSpecialty = cafe.recommendedItems.some((item) => /手冲|特调|combo/.test(item));
    addScore(bucket, specialty ? (deliberateSpecialty ? 11 : 8) : -3, "有精品豆或特调选择", "风味选择偏日常");
  }
  if (parsed.takeoutNeed && cafe.takeout === "yes") addScore(bucket, 4, "支持外带");

  if (parsed.distancePref === "south_gate") addScore(bucket, cafe.nearestGate === "南门" ? 7 : -3, "靠近南门", "不在南门方向");
  else if (parsed.distancePref === "east_gate") addScore(bucket, cafe.nearestGate === "东门" ? 7 : -3, "靠近东门", "不在东门方向");
  else {
    const distanceWeight = parsed.distancePref === "near" ? 1.2 : parsed.distancePref === "walk_ok" ? 0.35 : 0.55;
    addScore(bucket, Math.max(-4, 8 - durationMin) * distanceWeight, liveDistance ? "从当前位置步行较近" : `从${cafe.nearestGate}步行较近`, "需要多走几分钟");
  }

  if (hours.state === "open") addScore(bucket, 1, `当前营业至 ${hours.currentInterval?.close}`);
  if (hours.state === "closing_soon") {
    addScore(bucket, parsed.closingSoonConcern ? -10 : -2, "", `约 ${hours.minutesUntilClose} 分钟后关门`);
  }

  return {
    cafe,
    score: Number(bucket.score.toFixed(2)),
    fitReasons: bucket.fit.slice(0, 4),
    tradeoffs: bucket.tradeoffs.slice(0, 3),
    hardExclusions,
    distanceM,
    durationMin,
    hoursState: hours.state,
  };
}

function requestSummary(parsed: ParsedRequest) {
  const labels: string[] = [];
  if (parsed.scene === "study") labels.push("学习写作");
  if (parsed.scene === "chat") labels.push("见面聊天");
  if (parsed.scene === "quick_coffee") labels.push("快速喝一杯");
  if (parsed.budget !== "any") labels.push(parsed.budget === "low" ? "低预算" : parsed.budget === "medium" ? "中等预算" : "预算充足");
  if (parsed.quietNeed === "high") labels.push("安静优先");
  if (parsed.stayIntent === "long") labels.push("适合久坐");
  if (parsed.socketNeed !== "no") labels.push("需要插座");
  if (parsed.earlyNeed) labels.push("早八");
  if (parsed.specialtyNeed) labels.push("精品/特调");
  if (parsed.takeoutNeed) labels.push("外带");
  if (parsed.openNowNeed) labels.push("当前营业");
  return labels.join("、") || "日常咖啡";
}

function buildNarrative(picks: RankedCafe[], parsed: ParsedRequest, now: Date, relaxationAdvice?: string) {
  if (!picks.length) return `这次没有店铺同时满足“${requestSummary(parsed)}”的硬条件。${relaxationAdvice ?? "可以放宽一个条件后再试。"}`;
  if (picks.length === 1) {
    const pick = picks[0];
    return `严格按你的条件，目前只有 ${pick.cafe.name} 是精确匹配。${pick.fitReasons.slice(0, 2).join("，")}。${pick.tradeoffs[0] ? `需要留意：${pick.tradeoffs[0]}。` : ""}${relaxationAdvice ?? ""}`;
  }
  const [first, second] = picks;
  const lead = `这次优先看 ${first.cafe.name} 和 ${second.cafe.name}。`;
  const firstText = `${first.cafe.name} 更占优的是${first.fitReasons.slice(0, 2).join("、") || first.cafe.summary}；今日营业时间为 ${formatHoursForDay(first.cafe, now)}。`;
  const secondText = `${second.cafe.name} 的价值在于${second.fitReasons.slice(0, 2).join("、") || second.cafe.summary}；${second.tradeoffs[0] ? `取舍是${second.tradeoffs[0]}` : "作为第二选择更均衡"}。`;
  const close = first.score === second.score ? "两家匹配度接近，按你当下更在意的距离或空间感来选。" : `如果只选一家，${first.cafe.name} 对“${requestSummary(parsed)}”的匹配更完整。`;
  return [lead, firstText, secondText, close].join("\n\n");
}

export function buildRecommendation(input: RecommendationInput): RecommendationResult {
  const now = input.now ?? new Date();
  const parsed = resolveIntent(input.query, input.history);
  const ranked = input.cafes
    .map((cafe, index) => ({ item: rankCafe(cafe, parsed, now, input.location), index }))
    .sort((a, b) => b.item.score - a.item.score || a.item.durationMin - b.item.durationMin || a.index - b.index)
    .map(({ item }) => item);
  const eligible = ranked.filter((item) => item.hardExclusions.length === 0);
  const topPicks = eligible.slice(0, 2);
  const exactShortfall = topPicks.length < 2;
  const relaxationAdvice = exactShortfall
    ? `如果希望凑足两家，可以放宽${parsed.socketNeed === "required" ? "“必须有插座”" : parsed.openNowNeed ? "“现在营业”" : parsed.dietaryNeed ? `“必须有${parsed.dietaryNeed}”` : "一个硬条件"}。`
    : undefined;
  const explanation = buildNarrative(topPicks, parsed, now, relaxationAdvice);
  return {
    parsedRequest: parsed,
    parsedRequestSummary: requestSummary(parsed),
    ranked,
    topPicks,
    excluded: ranked.filter((item) => !topPicks.some((pick) => pick.cafe.id === item.cafe.id)),
    explanation,
    comparisonNote: topPicks.length === 2 ? `${topPicks[0].cafe.name} 更匹配核心条件，${topPicks[1].cafe.name} 提供不同取舍。` : "严格条件下不足两家。",
    tradeoffNote: topPicks.map((item) => item.tradeoffs[0]).filter(Boolean).join("；"),
    relaxationAdvice,
    selectedCafeIds: topPicks.map((item) => item.cafe.id),
    modelUsed: "local",
  };
}

export function buildLocalRecommendation(rawQuery: string, history: ConversationMessage[] = []) {
  return buildRecommendation({ cafes: staticCafes, query: rawQuery, history });
}

export function cafeMatchesGroup(cafe: Cafe, groupId: GuideGroupId) {
  if (groupId === "all") return true;
  if (groupId === "early") return cafe.earlyFriendly === "yes";
  if (groupId === "study") return cafe.mainScene === "study" || cafe.quietScore >= 4;
  if (groupId === "chat") return cafe.mainScene === "chat";
  if (groupId === "specialty") return cafe.tags.some((tag) => /精品|特调|特色豆|手冲/.test(tag));
  return cafe.tags.some((tag) => /文艺|设计|街景/.test(tag));
}
