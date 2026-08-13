import type { Cafe, DayKey, HoursInterval } from "./types";

const dayByShortName: Record<string, DayKey> = {
  Mon: "monday",
  Tue: "tuesday",
  Wed: "wednesday",
  Thu: "thursday",
  Fri: "friday",
  Sat: "saturday",
  Sun: "sunday",
};

export interface CafeHoursState {
  state: "open" | "closing_soon" | "closed" | "unknown";
  minutesUntilClose?: number;
  currentInterval?: HoursInterval;
  localDate: string;
  localTime: string;
}

function minutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function getShanghaiParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const time = `${value("hour")}:${value("minute")}`;
  return {
    date,
    time,
    day: dayByShortName[value("weekday")] ?? "monday",
    minuteOfDay: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

export function getCafeHoursState(cafe: Cafe, now: Date, closingSoonMinutes = 45): CafeHoursState {
  const local = getShanghaiParts(now);
  const exception = cafe.structuredHours.exceptions.find((item) => item.date === local.date);
  if (exception?.closed) {
    return { state: "closed", localDate: local.date, localTime: local.time };
  }

  const intervals = exception?.intervals ?? cafe.structuredHours.weekly[local.day];
  if (!intervals) {
    return { state: "unknown", localDate: local.date, localTime: local.time };
  }

  for (const interval of intervals) {
    const open = minutes(interval.open);
    const close = minutes(interval.close);
    if (open === null || close === null) continue;

    const normalizedClose = close <= open ? close + 24 * 60 : close;
    const normalizedNow = local.minuteOfDay < open && normalizedClose > 24 * 60 ? local.minuteOfDay + 24 * 60 : local.minuteOfDay;
    if (normalizedNow >= open && normalizedNow < normalizedClose) {
      const minutesUntilClose = normalizedClose - normalizedNow;
      return {
        state: minutesUntilClose <= closingSoonMinutes ? "closing_soon" : "open",
        minutesUntilClose,
        currentInterval: interval,
        localDate: local.date,
        localTime: local.time,
      };
    }
  }

  return { state: "closed", localDate: local.date, localTime: local.time };
}

export function formatHoursForDay(cafe: Cafe, now: Date) {
  const local = getShanghaiParts(now);
  const exception = cafe.structuredHours.exceptions.find((item) => item.date === local.date);
  if (exception?.closed) return "今日休息";
  const intervals = exception?.intervals ?? cafe.structuredHours.weekly[local.day];
  return intervals?.length ? intervals.map((item) => `${item.open}-${item.close}`).join("、") : "营业时间待核验";
}
