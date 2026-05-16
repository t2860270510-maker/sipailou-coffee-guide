"use client";

import Image from "next/image";
import { useDeferredValue, useEffect, useRef, useState, useTransition, type CSSProperties } from "react";

import {
  formatStaticWalk,
  formatWalkingDistance,
  type WalkingDistanceMap,
} from "../lib/location";
import { getGuideGroupMatches } from "../lib/recommendation";
import type {
  Cafe,
  EditorialMoment,
  GuideGroup,
  GuideGroupId,
} from "../lib/types";

const scenarioPrompts = [
  "明早第一节前想顺路带一杯，别太贵",
  "下午想坐一会写东西，最好安静一点",
  "想和朋友碰面聊聊天，离学校近一点",
];

const followupPrompts = [
  "预算再压低一点",
  "换成更适合久坐的",
  "离东门再近一点",
];

const pendingStages = [
  {
    shortLabel: "抓重点",
    title: "正在抓你的重点",
    detail: "先判断你更在意距离、预算，还是能不能坐久一点。",
  },
  {
    shortLabel: "比店铺",
    title: "正在比对附近店铺",
    detail: "会一起比较距离、营业时间、安静程度和价格。",
  },
  {
    shortLabel: "整理答案",
    title: "正在整理更直接的建议",
    detail: "只留下更适合你的两家，把差别说明白。",
  },
] as const;

type ConversationItem = {
  id: string;
  role: "assistant" | "user";
  type: "intro" | "text" | "streaming";
  content: string;
};

type DistanceStatus = "idle" | "locating" | "loading" | "ready" | "error";

type DistanceResponse = {
  distances?: WalkingDistanceMap;
  message?: string;
};

const initialConversation: ConversationItem[] = [
  {
    id: "intro",
    role: "assistant",
    type: "intro",
    content:
      "说一句你现在想要什么，我会直接帮你缩到更合适的两家，并把差别说清楚。",
  },
];

const desktopTextareaBounds = {
  min: 68,
  max: 152,
};

const mobileTextareaBounds = {
  min: 48,
  max: 112,
};

function formatPrice(priceLevel: Cafe["priceLevel"]) {
  if (priceLevel === "low") return "预算友好";
  if (priceLevel === "medium") return "价格中位";
  return "预算偏高";
}

function formatSocket(socketLevel: Cafe["socketLevel"]) {
  if (socketLevel === "good") return "插座较稳";
  if (socketLevel === "limited") return "插座少量";
  return "不突出插座";
}

function formatScene(scene: Cafe["mainScene"]) {
  if (scene === "quick_coffee") return "快买快走";
  if (scene === "study") return "学习久坐";
  return "聊天坐坐";
}

function toConversationErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "推荐服务暂时不可用，请稍后再试。";
  }

  if (/aborted due to timeout|timeout/i.test(error.message)) {
    return "AI 推荐这次响应有点慢，请再试一次。";
  }

  return error.message || "推荐服务暂时不可用，请稍后再试。";
}

async function readErrorMessage(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    return payload?.message ?? "推荐服务暂时不可用，请稍后再试。";
  }

  const text = await response.text().catch(() => "");
  return text.trim() || "推荐服务暂时不可用，请稍后再试。";
}

async function readDistancePayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return {
      message: (await response.text().catch(() => "")).trim(),
    } satisfies DistanceResponse;
  }

  return ((await response.json().catch(() => ({}))) ?? {}) as DistanceResponse;
}

function toGeolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "没有获得定位权限，先显示校门步行距离。";
  }

  if (error.code === error.TIMEOUT) {
    return "定位响应有点慢，先显示校门步行距离。";
  }

  return "暂时没拿到当前位置，先显示校门步行距离。";
}

type CampusCoffeeAppProps = {
  cafes: Cafe[];
  guideGroups: GuideGroup[];
  editorialMoments: EditorialMoment[];
};

export function CampusCoffeeApp({
  cafes,
  guideGroups,
  editorialMoments,
}: CampusCoffeeAppProps) {
  const [query, setQuery] = useState("");
  const [conversation, setConversation] = useState<ConversationItem[]>(initialConversation);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingStageIndex, setPendingStageIndex] = useState(0);
  const [pendingSeconds, setPendingSeconds] = useState(0);
  const [selectedCafe, setSelectedCafe] = useState<Cafe | null>(null);
  const [distanceStatus, setDistanceStatus] = useState<DistanceStatus>("idle");
  const [distanceMessage, setDistanceMessage] = useState("可开启定位，查看从你当前位置出发的步行时间。");
  const [walkingDistances, setWalkingDistances] = useState<WalkingDistanceMap>({});
  const [activeGuideGroup, setActiveGuideGroup] = useState<GuideGroupId>("early");
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isPromptTrayOpen, setIsPromptTrayOpen] = useState(false);
  const [cardMeta, setCardMeta] = useState<Record<string, { id: string; fitReason: string }[]>>({});
  const deferredGuideGroup = useDeferredValue(activeGuideGroup);
  const [isPending, startTransition] = useTransition();
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const queryInputRef = useRef<HTMLTextAreaElement | null>(null);
  const hasTypedQuery = query.trim().length > 0;
  const showQuickPrompts = !hasTypedQuery && conversation.length <= initialConversation.length;
  const hasConversationStarted = conversation.length > initialConversation.length;
  const showFollowupPrompts = !hasTypedQuery && hasConversationStarted && !isSubmitting;
  const isDistanceLoading = distanceStatus === "locating" || distanceStatus === "loading";
  const activeStreamingMessage = [...conversation]
    .reverse()
    .find((item) => item.role === "assistant" && item.type === "streaming");
  const hasStreamingResponse = Boolean(activeStreamingMessage?.content.trim());
  const activePendingStage = pendingStages[pendingStageIndex] ?? pendingStages[pendingStages.length - 1];
  const activePromptList = showQuickPrompts ? scenarioPrompts : showFollowupPrompts ? followupPrompts : [];
  const hasPromptSuggestions = activePromptList.length > 0;
  const headerStatus = isSubmitting
    ? hasStreamingResponse
      ? "答案还在继续补充"
      : activePendingStage.title
    : isPending
      ? "正在更新页面"
      : "随时可问";
  const waitingCopy = hasStreamingResponse
    ? `已经开始返回内容，还在继续补全更完整的建议${pendingSeconds >= 6 ? `，已等待 ${pendingSeconds} 秒` : ""}。`
    : `${activePendingStage.detail}${pendingSeconds >= 6 ? ` 已等待 ${pendingSeconds} 秒。` : ""}`;
  const helperCopy = isSubmitting
    ? "状态会持续更新，不会突然停住。"
    : "只留更合适的两家，不塞一长串店名。";
  const composerTitle = hasConversationStarted ? "继续补一句" : "说一句场景";
  const composerTip = isSubmitting
    ? "结果还在继续返回。"
    : isComposerFocused
      ? "回车发送，换行用 Shift + Enter。"
      : "像平时发消息一样输入就行。";

  const activeGroupMeta = guideGroups.find((group) => group.id === deferredGuideGroup) ?? guideGroups[0];
  const visibleCafes = getGuideGroupMatches(deferredGuideGroup);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: isSubmitting ? "auto" : "smooth", block: "end" });
  }, [conversation, isPending, isSubmitting]);

  useEffect(() => {
    const textarea = queryInputRef.current;
    if (!textarea) return;

    const isCompactViewport = window.matchMedia("(max-width: 760px)").matches;
    const bounds = isCompactViewport ? mobileTextareaBounds : desktopTextareaBounds;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, bounds.min), bounds.max)}px`;
  }, [query]);

  useEffect(() => {
    if (hasTypedQuery || !hasPromptSuggestions) {
      setIsPromptTrayOpen(false);
    }
  }, [hasPromptSuggestions, hasTypedQuery]);

  useEffect(() => {
    if (!isSubmitting) {
      setPendingStageIndex(0);
      setPendingSeconds(0);
      return;
    }

    const stageTimer = window.setInterval(() => {
      setPendingStageIndex((current) => Math.min(current + 1, pendingStages.length - 1));
    }, 1800);

    const elapsedTimer = window.setInterval(() => {
      setPendingSeconds((current) => current + 1);
    }, 1000);

    return () => {
      window.clearInterval(stageTimer);
      window.clearInterval(elapsedTimer);
    };
  }, [isSubmitting]);

  useEffect(() => {
    document.body.classList.add("motion-ready");

    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!elements.length || typeof IntersectionObserver === "undefined") {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.16,
        rootMargin: "0px 0px -8% 0px",
      },
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, [deferredGuideGroup]);

  useEffect(() => {
    if (!selectedCafe) return;

    document.body.classList.add("drawer-open");

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedCafe(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.classList.remove("drawer-open");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedCafe]);

  async function submitPrompt(nextQuery?: string) {
    const payload = (nextQuery ?? query).trim();
    if (!payload) {
      setFormError("先写一句需求，比如“下午想找个地方写论文”。");
      return;
    }

    setIsPromptTrayOpen(false);
    setFormError(null);
    setIsSubmitting(true);

    const loadingId = `loading-${Date.now()}`;
    setConversation((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", type: "text", content: payload },
      { id: loadingId, role: "assistant", type: "streaming", content: "" },
    ]);
    setQuery("");

    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: payload }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      if (!response.body) {
        throw new Error("模型没有返回可显示内容。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamedText = "";
      let headerParsed = false;
      let lineBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          streamedText += lineBuffer + decoder.decode();
          break;
        }

        const rawChunk = lineBuffer + decoder.decode(value, { stream: true });
        lineBuffer = "";

        if (!headerParsed) {
          const newlineIdx = rawChunk.indexOf("\n");
          if (newlineIdx !== -1) {
            const headerLine = rawChunk.slice(0, newlineIdx);
            streamedText = rawChunk.slice(newlineIdx + 1);
            headerParsed = true;

            try {
              const meta = JSON.parse(headerLine) as { cards?: { id: string; fitReason: string }[] };
              if (meta.cards?.length) {
                const cards = meta.cards;
                setCardMeta((prev) => ({ ...prev, [loadingId]: cards }));
              }
            } catch {
              // 首行不是合法 JSON，整体当纯文本处理
              streamedText = rawChunk;
            }
          } else {
            // 还没收到换行符，继续缓冲
            lineBuffer = rawChunk;
            if (lineBuffer.length > 600) {
              // 首行长到不可能是 JSON 头行，整体当文本处理
              streamedText = lineBuffer;
              lineBuffer = "";
              headerParsed = true;
            }
            continue;
          }
        } else {
          streamedText += rawChunk;
        }

        setConversation((current) =>
          current.map((item) =>
            item.id === loadingId
              ? { ...item, type: "streaming", content: streamedText }
              : item,
          ),
        );
      }

      const finalContent = streamedText.trim() || "这次没有生成可显示内容。";
      startTransition(() => {
        setConversation((current) =>
          current.map((item) =>
            item.id === loadingId
              ? { ...item, type: "text", content: finalContent }
              : item,
          ),
        );
      });
    } catch (error) {
      setConversation((current) =>
        current.map((item) =>
          item.id === loadingId
            ? {
                id: `error-${Date.now()}`,
                role: "assistant",
                type: "intro",
                content: toConversationErrorMessage(error),
              }
            : item,
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function fetchWalkingDistances(position: GeolocationPosition) {
    setDistanceStatus("loading");
    setDistanceMessage("正在计算从你当前位置出发的步行时间。");

    try {
      const response = await fetch("/api/distances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          longitude: position.coords.longitude,
          latitude: position.coords.latitude,
          coordinateSystem: "gps",
        }),
      });

      const payload = await readDistancePayload(response);

      if (!response.ok) {
        throw new Error(payload.message || "步行距离暂时不可用，先显示校门距离。");
      }

      setWalkingDistances(payload.distances ?? {});
      setDistanceStatus("ready");
      setDistanceMessage(payload.message ?? "已根据你的位置更新步行距离。");
    } catch (error) {
      setDistanceStatus("error");
      setDistanceMessage(error instanceof Error ? error.message : "步行距离暂时不可用，先显示校门距离。");
    }
  }

  function requestWalkingDistances() {
    if (!("geolocation" in navigator)) {
      setDistanceStatus("error");
      setDistanceMessage("当前浏览器不支持定位，先显示校门步行距离。");
      return;
    }

    setDistanceStatus("locating");
    setDistanceMessage("正在请求定位权限。");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        void fetchWalkingDistances(position);
      },
      (error) => {
        setDistanceStatus("error");
        setDistanceMessage(toGeolocationErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5 * 60 * 1000,
        timeout: 10000,
      },
    );
  }

  return (
    <main className="page-shell">
      <section className="page-masthead" data-reveal style={{ "--reveal-delay": "40ms" } as CSSProperties}>
        <p className="eyebrow">四牌楼咖啡地图</p>
        <h1 className="masthead-title">今天去哪里喝</h1>
      </section>

      <section className="hero-section">
        <div className="hero-backdrop" />
        <div className="hero-grid">
          <div className="chat-shell" data-reveal style={{ "--reveal-delay": "120ms" } as CSSProperties}>
            <div className="chat-head">
              <div>
                <p className="eyebrow">即时推荐</p>
                <h2>直接说你现在想要什么</h2>
              </div>
              <div className="chat-status">
                <span className={`panel-status ${isSubmitting ? "panel-status-busy" : ""}`}>{headerStatus}</span>
                <p className="status-copy">{isSubmitting ? waitingCopy : "输入一句需求，我会先帮你缩到两家。"}</p>
              </div>
            </div>

            <div className="chat-context-strip" aria-label="聊天提示">
              <span>像发消息一样问</span>
              <span>边生成边显示</span>
              <span>默认只留两家</span>
            </div>

            <div className="chat-log" aria-live="polite" aria-busy={isSubmitting}>
              {conversation.map((item) => {
                const roleLabel = item.role === "user" ? "你" : "向导";
                const messageContent =
                  item.type === "streaming" && !item.content
                    ? `${activePendingStage.title}\n${activePendingStage.detail}`
                    : item.content;

                return (
                  <article
                    key={item.id}
                    className={`message ${item.role === "user" ? "message-user" : "message-assistant"}`}
                  >
                    <p className="message-label">
                      <span>{roleLabel}</span>
                      {item.type === "streaming" ? (
                        <span className="message-state">{hasStreamingResponse ? "还在补充" : "正在输入"}</span>
                      ) : null}
                    </p>
                    <p
                      className={`message-text ${item.type === "streaming" ? "message-streaming" : ""} ${
                        item.type === "streaming" && !item.content ? "message-pending" : ""
                      }`}
                    >
                      {messageContent}
                    </p>
                    {item.role === "assistant" && cardMeta[item.id]?.length ? (
                      <div className="inline-cards">
                        {cardMeta[item.id].map((card) => {
                          const cafe = cafes.find((c) => c.id === card.id);
                          if (!cafe) return null;
                          return (
                            <button
                              key={card.id}
                              className="inline-card"
                              type="button"
                              onClick={() => setSelectedCafe(cafe)}
                            >
                              <div className="inline-card-image">
                                <Image
                                  src={cafe.coverImage}
                                  alt={cafe.name}
                                  fill
                                  sizes="72px"
                                />
                              </div>
                              <div className="inline-card-body">
                                <p className="inline-card-name">{cafe.name}</p>
                                <p className="inline-card-reason">{card.fitReason}</p>
                                <div className="inline-card-meta">
                                  <span>{formatStaticWalk(cafe)}</span>
                                  <span>{formatPrice(cafe.priceLevel)}</span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
              <div ref={scrollAnchorRef} />
            </div>

            {isSubmitting ? (
              <div className="waiting-banner" role="status" aria-live="polite">
                <div className="waiting-banner-head">
                  <span className="waiting-pulse" aria-hidden="true" />
                  <div>
                    <p className="waiting-title">{hasStreamingResponse ? "答案正在继续展开" : activePendingStage.title}</p>
                    <p className="waiting-copy">{waitingCopy}</p>
                  </div>
                </div>
                <div className="waiting-stage-row" aria-hidden="true">
                  {pendingStages.map((stage, index) => {
                    const stageState =
                      index < pendingStageIndex ? "waiting-stage-done" : index === pendingStageIndex ? "waiting-stage-active" : "";

                    return (
                      <span key={stage.shortLabel} className={`waiting-stage ${stageState}`.trim()}>
                        {stage.shortLabel}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="composer">
              <div className="composer-heading">
                <div>
                  <p className="composer-title">{composerTitle}</p>
                  <p className="composer-tip">{composerTip}</p>
                </div>
                <span className="composer-badge">{isSubmitting ? "返回中" : "输入区"}</span>
              </div>

              {hasPromptSuggestions ? (
                <div className="prompt-toggle-row">
                  <button
                    className={`prompt-toggle ${isPromptTrayOpen ? "prompt-toggle-open" : ""}`}
                    type="button"
                    onClick={() => setIsPromptTrayOpen((current) => !current)}
                    aria-expanded={isPromptTrayOpen}
                    aria-controls="mobile-prompt-tray"
                  >
                    <span>{showQuickPrompts ? "快捷提问" : "继续追问"}</span>
                    <span className="prompt-toggle-count">{activePromptList.length}</span>
                  </button>
                </div>
              ) : null}

              {hasPromptSuggestions ? (
                <div
                  id="mobile-prompt-tray"
                  className={`prompt-group ${isPromptTrayOpen ? "prompt-group-open" : ""}`}
                >
                  <p className="prompt-group-label">{showQuickPrompts ? "可以直接点一句" : "也可以继续追问"}</p>
                  <div className="quick-prompts" aria-label={showQuickPrompts ? "快捷场景" : "继续追问"}>
                    {activePromptList.map((prompt) => (
                      <button
                        key={prompt}
                        className="prompt-chip"
                        type="button"
                        onClick={() => void submitPrompt(prompt)}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="composer-row">
                <label className="composer-shell" htmlFor="coffee-query">
                  <span className="sr-only">输入需求</span>
                  <textarea
                    ref={queryInputRef}
                    id="coffee-query"
                    className="query-input"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={() => setIsComposerFocused(true)}
                    onBlur={() => setIsComposerFocused(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (!isSubmitting) {
                          void submitPrompt();
                        }
                      }
                    }}
                    rows={1}
                    placeholder={hasTypedQuery ? "" : "例如：下午想写论文，预算别太高，最好安静一点。"}
                  />
                </label>
                <button
                  className="composer-send"
                  type="button"
                  onClick={() => void submitPrompt()}
                  disabled={isSubmitting || !query.trim()}
                  aria-label={isSubmitting ? "正在生成回答" : "发送消息"}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path
                      d="M4.75 11.25h9.69L10.6 7.41a.75.75 0 1 1 1.06-1.06l5.12 5.12a.75.75 0 0 1 0 1.06l-5.12 5.12a.75.75 0 0 1-1.06-1.06l3.84-3.84H4.75a.75.75 0 0 1 0-1.5Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              </div>

              <p className="helper-copy">{helperCopy}</p>

              {formError ? <p className="form-error">{formError}</p> : null}
            </div>
          </div>

          <div className="hero-copy" data-reveal style={{ "--reveal-delay": "200ms" } as CSSProperties}>
            <div className="hero-copy-top">
              <p className="eyebrow">先说需求</p>
              <h2>把当下想要的说清楚，答案就会短很多。</h2>
              <p className="hero-intro">
                不管你是赶时间、想安静坐一会、要见人，还是只想喝一杯顺手不出错的，
                先把场景说清楚，就不用在一排店名里来回比较。
              </p>
              <div className="hero-microcopy">
                <span>先说需求</span>
                <span>只留两家</span>
                <span>差别说清</span>
              </div>
            </div>

            <article className="hero-note">
              <p>不是给你更多店，而是先帮你排掉不适合的。</p>
            </article>

            <div className="editorial-inline">
              {editorialMoments.map((moment, index) => {
                const cafe = cafes.find((item) => item.id === moment.cafeId);
                if (!cafe) return null;

                return (
                  <article
                    key={moment.title}
                    className="editorial-inline-card"
                    data-reveal
                    style={{ "--reveal-delay": `${260 + index * 70}ms` } as CSSProperties}
                  >
                    <p className="eyebrow">{moment.title}</p>
                    <h3>{cafe.name}</h3>
                    <p>{moment.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="guide-section" data-reveal style={{ "--reveal-delay": "60ms" } as CSSProperties}>
        <div className="section-heading guide-heading">
          <div>
            <p className="eyebrow">咖啡地图</p>
            <h2>往下滑，是一份可以慢慢逛的四牌楼咖啡地图</h2>
          </div>
          <div className="guide-actions">
            <p className="section-note">你也可以不走输入框，直接按场景把整份内容翻一遍。</p>
            <button
              className={`location-button ${isDistanceLoading ? "location-button-loading" : ""}`}
              type="button"
              onClick={requestWalkingDistances}
              disabled={isDistanceLoading}
            >
              {isDistanceLoading ? "正在更新距离" : distanceStatus === "ready" ? "重新定位" : "使用当前位置"}
            </button>
            <p className={`location-status location-status-${distanceStatus}`} role="status" aria-live="polite">
              {distanceMessage}
            </p>
          </div>
        </div>

        <div className="guide-layout">
          <aside className="guide-sidebar">
            <div className="guide-nav">
              {guideGroups.map((group) => (
                <button
                  key={group.id}
                  className={`guide-tab ${group.id === activeGuideGroup ? "guide-tab-active" : ""}`}
                  type="button"
                  onClick={() => setActiveGuideGroup(group.id)}
                >
                  <span>{group.label}</span>
                  <small>{group.kicker}</small>
                </button>
              ))}
            </div>

            <div className="guide-copy">
              <p className="eyebrow">{activeGroupMeta.kicker}</p>
              <h3>{activeGroupMeta.label}</h3>
              <p>{activeGroupMeta.description}</p>
            </div>
          </aside>

          <div key={deferredGuideGroup} className="guide-flow">
            {visibleCafes.map((cafe, index) => (
              <article
                key={cafe.id}
                className="cafe-card"
                data-reveal
                style={{ "--reveal-delay": `${index * 90}ms` } as CSSProperties}
              >
                <div className="cafe-image-wrap">
                  <Image
                    src={cafe.coverImage}
                    alt={`${cafe.name} cover`}
                    fill
                    sizes="(max-width: 800px) 100vw, 45vw"
                    className="cafe-image"
                  />
                </div>

                <div className="cafe-copy">
                  <div className="cafe-head">
                    <div>
                      <p className="eyebrow">{cafe.locationText}</p>
                      <h3>{cafe.name}</h3>
                    </div>
                    <span className="scene-pill">{formatScene(cafe.mainScene)}</span>
                  </div>

                  <p className="cafe-summary">{cafe.summary}</p>

                  <div className="meta-grid">
                    <span>{cafe.nearestGate}</span>
                    <span>{formatStaticWalk(cafe)}</span>
                    {walkingDistances[cafe.id] ? (
                      <span className="distance-pill">{formatWalkingDistance(walkingDistances[cafe.id])}</span>
                    ) : null}
                    <span>{cafe.weekdayHours}</span>
                    <span>{formatPrice(cafe.priceLevel)}</span>
                  </div>

                  <div className="tag-row">
                    {cafe.tags.map((tag) => (
                      <span key={`${cafe.id}-${tag}`} className="tag-pill">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <p className="cafe-notes">{cafe.notes}</p>

                  <div className="card-actions">
                    <button className="text-button" type="button" onClick={() => setSelectedCafe(cafe)}>
                      看这家更细一点
                    </button>
                    {cafe.id === "katherine-starbucks" ? (
                      <span className="meta-inline">{formatSocket(cafe.socketLevel)}</span>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {selectedCafe ? (
        <div className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title">
          <button className="drawer-backdrop" type="button" onClick={() => setSelectedCafe(null)} aria-label="关闭详情" />
          <div className="drawer-panel">
            <button className="drawer-mobile-close" type="button" onClick={() => setSelectedCafe(null)}>
              收起
            </button>
            <div className="drawer-media">
              <Image
                src={selectedCafe.coverImage}
                alt={selectedCafe.name}
                fill
                sizes="(max-width: 800px) 100vw, 40vw"
                className="cafe-image"
              />
            </div>
            <div className="drawer-content">
              <div className="drawer-head">
                <div>
                  <p className="eyebrow">{selectedCafe.locationText}</p>
                  <h2 id="detail-title">{selectedCafe.name}</h2>
                </div>
                <button className="close-button" type="button" onClick={() => setSelectedCafe(null)}>
                  收起
                </button>
              </div>

              <p className="drawer-summary">{selectedCafe.summary}</p>

              <dl className="drawer-facts">
                <div>
                  <dt>最近校门</dt>
                  <dd>{selectedCafe.nearestGate}</dd>
                </div>
                <div>
                  <dt>校门步行</dt>
                  <dd>{formatStaticWalk(selectedCafe)}</dd>
                </div>
                {walkingDistances[selectedCafe.id] ? (
                  <div>
                    <dt>当前位置</dt>
                    <dd>{formatWalkingDistance(walkingDistances[selectedCafe.id])}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>工作日营业</dt>
                  <dd>{selectedCafe.weekdayHours}</dd>
                </div>
                <div>
                  <dt>周末营业</dt>
                  <dd>{selectedCafe.weekendHours}</dd>
                </div>
                <div>
                  <dt>预算等级</dt>
                  <dd>{formatPrice(selectedCafe.priceLevel)}</dd>
                </div>
                {selectedCafe.id === "katherine-starbucks" ? (
                  <div>
                    <dt>插座情况</dt>
                    <dd>{formatSocket(selectedCafe.socketLevel)}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="drawer-section">
                <p className="eyebrow">推荐品类</p>
                <div className="tag-row">
                  {selectedCafe.recommendedItems.map((item) => (
                    <span key={`${selectedCafe.id}-${item}`} className="tag-pill">
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="drawer-section">
                <p className="eyebrow">补充观察</p>
                <p>{selectedCafe.notes}</p>
              </div>

              <div className="drawer-section">
                <p className="eyebrow">店铺图片</p>
                <div className="photo-grid" aria-label={`${selectedCafe.name} 图片介绍`}>
                  {selectedCafe.imageGallery.map((image) => (
                    <figure key={`${selectedCafe.id}-${image.src}-${image.caption}`} className="photo-card">
                      <div className="photo-frame">
                        <Image
                          src={image.src}
                          alt={image.alt}
                          fill
                          sizes="(max-width: 800px) 78vw, 18vw"
                          className="cafe-image"
                        />
                      </div>
                      <figcaption>{image.caption}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>

              <p className="source-note">
                整理来源：{selectedCafe.sourceNote}，最近整理时间 {selectedCafe.verifiedAt}
                {selectedCafe.poiVerifiedAt ? `；高德 POI 校准 ${selectedCafe.poiVerifiedAt}` : ""}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
