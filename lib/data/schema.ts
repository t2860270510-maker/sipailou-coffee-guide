import { z } from "zod";

import type { Cafe, CoffeeOverlayV1, CoffeeReleaseV1, PublishedPointerV1 } from "../types";

const httpUrl = z.string().url().refine((value) => /^https?:\/\//i.test(value), "只允许 HTTP(S) URL");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{1,2}:\d{2}$/);
const nonEmpty = z.string().trim().min(1).max(500);

const evidenceSchema = z.object({
  sourceLabel: z.string().trim().min(2).max(200),
  sourceUrl: httpUrl.optional(),
  verifiedAt: date,
  verifiedBy: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).optional(),
}).strict();

const intervalSchema = z.object({ open: time, close: time }).strict();
const dayIntervals = z.array(intervalSchema).max(6);
const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const structuredHoursSchema = z.object({
  timezone: z.literal("Asia/Shanghai"),
  weekly: z.object(Object.fromEntries(dayKeys.map((day) => [day, dayIntervals])) as Record<(typeof dayKeys)[number], typeof dayIntervals>).strict(),
  exceptions: z.array(z.object({
    date,
    closed: z.boolean().optional(),
    intervals: dayIntervals.optional(),
    note: z.string().trim().max(300).optional(),
  }).strict()).max(100),
}).strict();

const imageSchema = z.object({
  src: z.string().trim().min(1).max(1000).refine((value) => value.startsWith("/") || /^https:\/\//i.test(value), "图片必须是站内路径或 HTTPS URL"),
  alt: z.string().trim().min(1).max(200),
  caption: z.string().trim().min(1).max(500),
  sourceLabel: z.string().trim().min(1).max(200).optional(),
  sourceUrl: httpUrl.optional(),
  rights: z.string().trim().min(1).max(300).optional(),
  verifiedAt: date.optional(),
  verifiedBy: z.string().trim().min(1).max(80).optional(),
}).strict();

const cafeObject = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20),
  status: z.enum(["active", "inactive", "temporarily_closed", "permanently_closed"]),
  locationText: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(300),
  nearestGate: z.string().trim().min(1).max(100),
  walkDistanceM: z.number().int().nonnegative().max(100_000),
  walkTimeMin: z.number().int().positive().max(1_000),
  amapPoiId: z.string().trim().max(100).optional(),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  entranceLongitude: z.number().min(-180).max(180).optional(),
  entranceLatitude: z.number().min(-90).max(90).optional(),
  amapAddress: z.string().trim().max(300).optional(),
  poiVerifiedAt: date.optional(),
  structuredHours: structuredHoursSchema,
  temporaryHoursNotice: z.string().trim().max(300).optional(),
  weekdayHours: z.string().trim().min(1).max(200),
  weekendHours: z.string().trim().min(1).max(200),
  earlyFriendly: z.enum(["yes", "maybe", "no"]),
  priceRange: z.object({ min: z.number().nonnegative().max(10_000), max: z.number().nonnegative().max(10_000), currency: z.literal("CNY") }).strict(),
  priceLevel: z.enum(["low", "medium", "high"]),
  quietScore: z.number().int().min(1).max(5),
  quietByPeriod: z.object({ morning: z.number().int().min(1).max(5).optional(), afternoon: z.number().int().min(1).max(5).optional(), evening: z.number().int().min(1).max(5).optional() }).strict(),
  seatLevel: z.enum(["none", "limited", "adequate", "spacious"]),
  socketLevel: z.enum(["none", "limited", "good"]),
  wifi: z.enum(["yes", "no", "unknown"]),
  restroom: z.enum(["yes", "no", "unknown"]),
  takeout: z.enum(["yes", "no", "unknown"]),
  stayIntent: z.enum(["short", "long", "any"]),
  mainScene: z.enum(["quick_coffee", "study", "chat"]),
  tags: z.array(z.string().trim().min(1).max(80)).max(30),
  recommendedItems: z.array(z.string().trim().min(1).max(120)).max(30),
  dietaryOptions: z.array(z.string().trim().min(1).max(120)).max(30),
  summary: z.string().trim().min(10).max(800),
  notes: z.string().trim().min(1).max(2_000),
  sourceLabel: z.string().trim().min(2).max(200),
  sourceUrl: httpUrl.optional(),
  sourceNote: z.string().trim().min(2).max(500),
  verifiedAt: date,
  verifiedBy: z.string().trim().min(1).max(80),
  fieldEvidence: z.object({
    hours: evidenceSchema.optional(),
    price: evidenceSchema.optional(),
    location: evidenceSchema.optional(),
    experience: evidenceSchema.optional(),
    menu: evidenceSchema.optional(),
    images: evidenceSchema.optional(),
  }).strict(),
  coverImage: z.string().trim().min(1).max(1000).refine((value) => value.startsWith("/") || /^https:\/\//i.test(value), "封面必须是站内路径或 HTTPS URL"),
  imageGallery: z.array(imageSchema).max(30),
}).strict();

export const cafeSchema: z.ZodType<Cafe> = cafeObject.superRefine((cafe, context) => {
  if (cafe.priceRange.min > cafe.priceRange.max) context.addIssue({ code: "custom", message: "最低价格不能高于最高价格", path: ["priceRange"] });
  if ((cafe.entranceLongitude === undefined) !== (cafe.entranceLatitude === undefined)) context.addIssue({ code: "custom", message: "入口经纬度必须成对填写", path: ["entranceLongitude"] });
  for (const [day, intervals] of Object.entries(cafe.structuredHours.weekly)) validateIntervals(intervals, context, ["structuredHours", "weekly", day]);
  cafe.structuredHours.exceptions.forEach((exception, index) => validateIntervals(exception.intervals ?? [], context, ["structuredHours", "exceptions", index, "intervals"]));
});

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function validateIntervals(intervals: Array<{ open: string; close: string }>, context: z.RefinementCtx, path: Array<string | number>) {
  const sorted = intervals.map((item) => ({ start: minutes(item.open), end: minutes(item.close) })).sort((a, b) => a.start - b.start);
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index].start === sorted[index].end) context.addIssue({ code: "custom", message: "营业时间段不能为零", path });
    if (index > 0 && sorted[index].start < sorted[index - 1].end) context.addIssue({ code: "custom", message: "同日营业时间不能重叠", path });
  }
}

const overlayBase = z.object({
  schemaVersion: z.literal(1),
  baseVersion: z.string().trim().min(1).max(100),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().trim().min(1).max(80),
  note: z.string().trim().min(1).max(500),
  promptStyle: z.string().trim().min(1).max(2_000),
  patches: z.record(z.string(), cafeObject.partial()),
  additions: z.array(cafeSchema).max(92),
}).strict();

export const overlaySchema: z.ZodType<CoffeeOverlayV1> = overlayBase.superRefine((overlay, context) => {
  const ids = overlay.additions.map((cafe) => cafe.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "新增店铺 ID 不能重复", path: ["additions"] });
  if (!overlay.updatedBy.trim() || !overlay.note.trim()) context.addIssue({ code: "custom", message: "每次变更必须填写核验人和修改备注" });
});

export const releaseSchema: z.ZodType<CoffeeReleaseV1> = overlayBase.extend({
  releaseId: nonEmpty,
  publishedAt: z.string().datetime(),
  publishedBy: z.string().trim().min(1).max(80),
  kind: z.enum(["publish", "rollback"]),
  rolledBackFrom: z.string().trim().max(500).optional(),
}).strict();

export const pointerSchema: z.ZodType<PublishedPointerV1> = z.object({
  schemaVersion: z.literal(1),
  releasePath: z.string().startsWith("coffee-data/releases/").max(500),
  releaseId: nonEmpty,
  publishedAt: z.string().datetime(),
  publishedCafeIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)).max(100),
}).strict();

export function safeHttpUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
