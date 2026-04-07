"use client";

import Image from "next/image";
import { useDeferredValue, useEffect, useRef, useState, useTransition } from "react";

import { getGuideGroupMatches } from "../lib/recommendation";
import type {
  Cafe,
  EditorialMoment,
  GuideGroup,
  GuideGroupId,
  RecommendationResult,
} from "../lib/types";

const scenarioPrompts = [
  "明早早八前想顺路买一杯，别太贵",
  "下午想写论文，最好安静一点，有插座更好",
  "想和朋友坐坐聊天，离学校近一点",
];

const heroSignals = [
  {
    label: "输入一句",
    body: "直接说场景，不需要先选筛选器。",
  },
  {
    label: "拿到两家",
    body: "先给你两个清晰答案，不把页面变成长榜单。",
  },
  {
    label: "再看细节",
    body: "点开店铺卡片，就能继续看营业时间、插座和推荐品类。",
  },
];

type ConversationItem =
  | {
      id: string;
      role: "assistant";
      type: "intro";
      content: string;
    }
  | {
      id: string;
      role: "user";
      type: "text";
      content: string;
    }
  | {
      id: string;
      role: "assistant";
      type: "loading";
      content: string;
    }
  | {
      id: string;
      role: "assistant";
      type: "result";
      result: RecommendationResult;
    };

const initialConversation: ConversationItem[] = [
  {
    id: "intro",
    role: "assistant",
    type: "intro",
    content:
      "说一句你现在的需求，我会在对话里直接给你 2 家更合适的店，并解释它们分别适合什么。",
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

function formatModelLabel(modelUsed: string) {
  if (modelUsed === "Local fallback") {
    return "本地稳定推荐";
  }

  if (modelUsed.endsWith("+ local picks")) {
    return `${modelUsed.replace(" + local picks", "")} 润色`;
  }

  return modelUsed;
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

  const activeGroupMeta = guideGroups.find((group) => group.id === deferredGuideGroup) ?? guideGroups[0];
  const visibleCafes = getGuideGroupMatches(deferredGuideGroup);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation, isPending]);

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
      { id: loadingId, role: "assistant", type: "loading", content: "正在比对更适合的两家店..." },
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

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message ?? "推荐服务暂时不可用。");
      }

      startTransition(() => {
        setConversation((current) =>
          current.map((item) =>
            item.id === loadingId
              ? { id: `result-${Date.now()}`, role: "assistant", type: "result", result }
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
                content: error instanceof Error ? error.message : "推荐服务暂时不可用。",
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
      <section className="hero-section">
        <div className="hero-backdrop" />
        <div className="hero-grid">
          <div className="chat-shell">
            <div className="chat-head">
              <div>
                <p className="eyebrow">AI Concierge</p>
                <h2>直接说你的场景</h2>
              </div>
              <span className="panel-status">
                {isSubmitting ? "正在推理" : isPending ? "更新中" : "在线"}
              </span>
            </div>

            <div ref={chatLogRef} className="chat-log" aria-live="polite">
              {conversation.map((item) => {
                if (item.type === "result") {
                  return (
                    <article key={item.id} className="message message-assistant message-result">
                      <p className="message-label">Assistant</p>
                      <p className="message-text">{item.result.parsedRequestSummary}</p>
                      <p className="message-text result-lead">{item.result.explanation}</p>

                      <div className="result-overview">
                        <span>这次先看这两家</span>
                        <span>{formatModelLabel(item.result.modelUsed)}</span>
                      </div>

                      <div className="recommendation-cards">
                        {item.result.topPicks.map((candidate, index) => (
                          <button
                            key={candidate.cafe.id}
                            className="result-card"
                            type="button"
                            onClick={() => setSelectedCafe(candidate.cafe)}
                          >
                            <div className="result-card-head">
                              <span className="result-index">0{index + 1}</span>
                              <div>
                                <h3>{candidate.cafe.name}</h3>
                                <p>
                                  {candidate.cafe.locationText} · {candidate.cafe.nearestGate}
                                </p>
                              </div>
                            </div>
                            <p className="result-summary">{candidate.cafe.summary}</p>
                            <div className="metric-row">
                              <span>{candidate.cafe.walkTimeMin} 分钟</span>
                              <span>{formatPrice(candidate.cafe.priceLevel)}</span>
                              <span>{formatScene(candidate.cafe.mainScene)}</span>
                              <span>{candidate.cafe.weekdayHours}</span>
                            </div>
                            <ul className="reason-list compact">
                              {candidate.fitReasons.map((reason) => (
                                <li key={`${candidate.cafe.id}-${reason}`}>{reason}</li>
                              ))}
                            </ul>
                            <p className="result-tradeoff">
                              需要注意：{candidate.tradeoffs[0]}
                            </p>
                          </button>
                        ))}
                      </div>

                      <p className="chat-note">{item.result.comparisonNote}</p>
                      <p className="chat-note subtle">{item.result.tradeoffNote}</p>
                      <p className="chat-model">{formatModelLabel(item.result.modelUsed)}</p>
                    </article>
                  );
                }

                return (
                  <article
                    key={item.id}
                    className={`message ${item.role === "user" ? "message-user" : "message-assistant"}`}
                  >
                    <p className="message-label">{item.role === "user" ? "You" : "Assistant"}</p>
                    <p className={`message-text ${item.type === "loading" ? "message-loading" : ""}`}>
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
                  placeholder="例如：下午想写论文，预算别太高，最好安静一点。"
                />
              </label>

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

              <div className="composer-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void submitPrompt()}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "正在推荐..." : "发送需求"}
                </button>
                <p className="helper-copy">我会只给你两家，并清楚说明各自更适合什么。</p>
              </div>

              {formError ? <p className="form-error">{formError}</p> : null}
            </div>
          </div>

          <div className="hero-copy">
            <div className="hero-copy-top">
              <p className="eyebrow">Sipailou Coffee Companion</p>
              <h1>今天去哪家坐一会？</h1>
              <p className="hero-intro">
                输入一句真实需求，让模型直接从 8 家店里选出更贴近你当下场景的 2 家。
              </p>
              <div className="hero-microcopy">
                <span>对话式交互</span>
                <span>模型直推两家</span>
                <span>真实店铺观察</span>
              </div>
            </div>

            <div className="hero-brief">
              {heroSignals.map((signal, index) => (
                <article key={signal.label} className="hero-brief-card">
                  <span className="hero-brief-index">0{index + 1}</span>
                  <div>
                    <h3>{signal.label}</h3>
                    <p>{signal.body}</p>
                  </div>
                </article>
              ))}
            </div>

            <div className="editorial-inline">
              {editorialMoments.map((moment) => {
                const cafe = cafes.find((item) => item.id === moment.cafeId);
                if (!cafe) return null;

                return (
                  <article key={moment.title} className="editorial-inline-card">
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

      <section className="guide-section">
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

          <div className="guide-flow">
            {visibleCafes.map((cafe) => (
              <article key={cafe.id} className="cafe-card">
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
                    <span className="meta-inline">{formatSocket(cafe.socketLevel)}</span>
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
                  关闭
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
                <div>
                  <dt>插座情况</dt>
                  <dd>{formatSocket(selectedCafe.socketLevel)}</dd>
                </div>
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
