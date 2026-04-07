"use client";

import Image from "next/image";
import { useDeferredValue, useEffect, useRef, useState, useTransition, type CSSProperties } from "react";

import { getGuideGroupMatches } from "../lib/recommendation";
import type {
  Cafe,
  EditorialMoment,
  GuideGroup,
  GuideGroupId,
} from "../lib/types";

const scenarioPrompts = [
  "明早早八前想顺路买一杯，别太贵",
  "下午想写论文，最好安静一点，有插座更好",
  "想和朋友坐坐聊天，离学校近一点",
];

type ConversationItem = {
  id: string;
  role: "assistant" | "user";
  type: "intro" | "text" | "streaming";
  content: string;
};

const initialConversation: ConversationItem[] = [
  {
    id: "intro",
    role: "assistant",
    type: "intro",
    content:
      "说一句你现在的需求，我会直接给你两家更合适的店，并把各自适合的理由说明白。",
  },
];

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
  const [selectedCafe, setSelectedCafe] = useState<Cafe | null>(null);
  const [activeGuideGroup, setActiveGuideGroup] = useState<GuideGroupId>("early");
  const deferredGuideGroup = useDeferredValue(activeGuideGroup);
  const [isPending, startTransition] = useTransition();
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const hasTypedQuery = query.trim().length > 0;
  const showQuickPrompts = !hasTypedQuery && conversation.length <= initialConversation.length;

  const activeGroupMeta = guideGroups.find((group) => group.id === deferredGuideGroup) ?? guideGroups[0];
  const visibleCafes = getGuideGroupMatches(deferredGuideGroup);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: isSubmitting ? "auto" : "smooth", block: "end" });
  }, [conversation, isPending, isSubmitting]);

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

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          streamedText += decoder.decode();
          break;
        }

        streamedText += decoder.decode(value, { stream: true });
        const nextContent = streamedText;
        setConversation((current) =>
          current.map((item) =>
            item.id === loadingId
              ? { ...item, type: "streaming", content: nextContent }
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

  return (
    <main className="page-shell">
      <section className="page-masthead" data-reveal style={{ "--reveal-delay": "40ms" } as CSSProperties}>
        <p className="eyebrow">Sipailou Coffee Companion</p>
        <h1>今天喝点什么</h1>
        <p className="masthead-intro">一句当下心境，换两家更值得停留的地方。</p>
      </section>

      <section className="hero-section">
        <div className="hero-backdrop" />
        <div className="hero-grid">
          <div className="chat-shell" data-reveal style={{ "--reveal-delay": "120ms" } as CSSProperties}>
            <div className="chat-head">
              <div>
                <p className="eyebrow">AI Concierge</p>
                <h2>直接说你的场景</h2>
              </div>
              <span className="panel-status">
                {isSubmitting ? "正在回复" : isPending ? "更新中" : "在线"}
              </span>
            </div>

            <div ref={chatLogRef} className="chat-log" aria-live="polite">
              {conversation.map((item) => {
                return (
                  <article
                    key={item.id}
                    className={`message ${item.role === "user" ? "message-user" : "message-assistant"}`}
                  >
                    <p className="message-label">{item.role === "user" ? "你" : "Assistant"}</p>
                    <p className={`message-text ${item.type === "streaming" ? "message-streaming" : ""}`}>
                      {item.content}
                    </p>
                  </article>
                );
              })}
              <div ref={scrollAnchorRef} />
            </div>

            <div className="composer">
              <label className="composer-shell" htmlFor="coffee-query">
                <span className="sr-only">输入需求</span>
                <textarea
                  id="coffee-query"
                  className="query-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (!isSubmitting) {
                        void submitPrompt();
                      }
                    }
                  }}
                  rows={3}
                  placeholder={hasTypedQuery ? "" : "例如：下午想写论文，预算别太高，最好安静一点。"}
                />
              </label>

              {showQuickPrompts ? (
                <div className="quick-prompts" aria-label="快捷场景">
                  {scenarioPrompts.map((prompt) => (
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
              ) : null}

              <div className="composer-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void submitPrompt()}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "正在回复..." : "发送消息"}
                </button>
                <p className="helper-copy">不铺陈，不兜圈，只留下更贴近当下的两家。</p>
              </div>

              {formError ? <p className="form-error">{formError}</p> : null}
            </div>
          </div>

          <div className="hero-copy" data-reveal style={{ "--reveal-delay": "200ms" } as CSSProperties}>
            <div className="hero-copy-top">
              <p className="eyebrow">Scene Selection</p>
              <h2>先说此刻，再决定去哪一间。</h2>
              <p className="hero-intro">
                把赶时间、想独处、要见人，或只是想认真喝一杯的念头说清楚，
                答案就不必在一攒店名里反复比较。
              </p>
              <div className="hero-microcopy">
                <span>先说场景</span>
                <span>只给两家</span>
                <span>再看观察</span>
              </div>
            </div>

            <article className="hero-note">
              <p>不是把选择做多，而是把犹豫缩短。</p>
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
            <p className="eyebrow">Coffee Guide</p>
            <h2>往下滑，是一份可以慢慢逛的四牌楼咖啡地图</h2>
          </div>
          <p className="section-note">你也可以不问 AI，直接按场景看整份内容。</p>
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
                    <span>{cafe.walkDistanceM}m</span>
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
                      打开店铺观察
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
              返回
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
                  关闭观察
                </button>
              </div>

              <p className="drawer-summary">{selectedCafe.summary}</p>

              <dl className="drawer-facts">
                <div>
                  <dt>最近校门</dt>
                  <dd>{selectedCafe.nearestGate}</dd>
                </div>
                <div>
                  <dt>步行时间</dt>
                  <dd>{selectedCafe.walkTimeMin} 分钟</dd>
                </div>
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
                <p className="eyebrow">编辑观察</p>
                <p>{selectedCafe.notes}</p>
              </div>

              <p className="source-note">
                信息来源：{selectedCafe.sourceNote}，最近整理时间 {selectedCafe.verifiedAt}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
