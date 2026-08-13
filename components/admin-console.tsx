"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { Cafe, CoffeeOverlayV1 } from "../lib/types";

type AdminConfig = {
  editor: string;
  draft: { overlay: CoffeeOverlayV1; etag: string | null; configured: boolean };
  resolvedCafes: Cafe[];
  published: { pointer: { releaseId: string; releasePath: string; publishedAt: string; publishedCafeIds: string[] } | null; etag: string | null };
  versions: Array<{ pathname: string; releaseId: string; publishedAt: string; publishedBy: string; kind: string; note: string }>;
  fixedRules: string[];
};

type Tab = "cafes" | "prompt" | "trial" | "publish" | "history";
const statuses: Cafe["status"][] = ["active", "inactive", "temporarily_closed", "permanently_closed"];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } });
  const payload = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? "操作失败，请稍后重试。");
  return payload as T;
}

function intervalsText(cafe: Cafe, day: keyof Cafe["structuredHours"]["weekly"]) {
  return cafe.structuredHours.weekly[day].map((item) => `${item.open}-${item.close}`).join(",");
}

function parseIntervals(value: string) {
  return value.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [open, close] = part.split("-");
    return { open, close };
  });
}

export function AdminConsole() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [tab, setTab] = useState<Tab>("cafes");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Cafe["status"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("正在读取管理配置…");
  const [busy, setBusy] = useState(false);
  const [trialQuery, setTrialQuery] = useState("下午想坐一会写东西，最好安静一点");
  const [trialResult, setTrialResult] = useState("");
  const [candidateResult, setCandidateResult] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageAlt, setImageAlt] = useState("");
  const [imageCaption, setImageCaption] = useState("");
  const [imageRights, setImageRights] = useState("已获授权用于本指南");
  const [imageSourceUrl, setImageSourceUrl] = useState("");

  async function load() {
    try {
      const next = await api<AdminConfig>("/api/admin/config");
      setConfig(next);
      setLoginRequired(false);
      setSelectedId((current) => current ?? next.resolvedCafes[0]?.id ?? null);
      setMessage(next.draft.configured ? "草稿已读取。" : "数据 Blob 未配置；当前仅可查看默认草稿，保存和发布不可用。");
    } catch (error) {
      setLoginRequired(true);
      setMessage(error instanceof Error ? error.message : "请登录管理台。");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const cafes = config?.resolvedCafes ?? [];
  const selected = cafes.find((cafe) => cafe.id === selectedId) ?? null;
  const filtered = cafes.filter((cafe) => {
    const matchesSearch = `${cafe.name} ${cafe.id} ${cafe.aliases.join(" ")}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (statusFilter === "all" || cafe.status === statusFilter);
  });

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ token, name }) });
      setToken("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败。");
    } finally { setBusy(false); }
  }

  function updateCafe(patch: Partial<Cafe>) {
    if (!config || !selected) return;
    const nextCafe = { ...selected, ...patch };
    const additions = config.draft.overlay.additions.some((cafe) => cafe.id === selected.id)
      ? config.draft.overlay.additions.map((cafe) => cafe.id === selected.id ? nextCafe : cafe)
      : config.draft.overlay.additions;
    const patches = additions === config.draft.overlay.additions
      ? { ...config.draft.overlay.patches, [selected.id]: nextCafe }
      : config.draft.overlay.patches;
    setConfig({
      ...config,
      draft: { ...config.draft, overlay: { ...config.draft.overlay, additions, patches } },
      resolvedCafes: config.resolvedCafes.map((cafe) => cafe.id === selected.id ? nextCafe : cafe),
    });
  }

  function restoreBaseline() {
    if (!config || !selected) return;
    const patches = { ...config.draft.overlay.patches };
    delete patches[selected.id];
    setConfig({ ...config, draft: { ...config.draft, overlay: { ...config.draft.overlay, patches } } });
    setMessage("已从草稿移除该店修订；保存后恢复静态基线。");
  }

  function addCafe() {
    if (!config || !config.resolvedCafes[0]) return;
    const id = `new-cafe-${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);
    const cafe: Cafe = {
      ...structuredClone(config.resolvedCafes[0]), id, name: "未命名新店", aliases: [], status: "inactive",
      summary: "请填写不少于十个字的新店摘要。", notes: "请填写补充观察。", sourceLabel: "待核验", sourceNote: "待核验",
      verifiedAt: today, verifiedBy: config.editor, imageGallery: [], coverImage: "/cafes/standing-room.svg",
      fieldEvidence: {},
    };
    setConfig({ ...config, draft: { ...config.draft, overlay: { ...config.draft.overlay, additions: [...config.draft.overlay.additions, cafe] } }, resolvedCafes: [...config.resolvedCafes, cafe] });
    setSelectedId(id);
    setMessage("已添加未发布新店；必须补齐来源并通过严格校验后才能发布。");
  }

  function removeUnpublishedAddition() {
    if (!config || !selected) return;
    if (!config.draft.overlay.additions.some((cafe) => cafe.id === selected.id)) return;
    if (config.published.pointer?.publishedCafeIds.includes(selected.id)) {
      setMessage("已发布新增店不能删除，请将状态改为停用或永久关闭。");
      return;
    }
    setConfig({ ...config, draft: { ...config.draft, overlay: { ...config.draft.overlay, additions: config.draft.overlay.additions.filter((cafe) => cafe.id !== selected.id) } }, resolvedCafes: config.resolvedCafes.filter((cafe) => cafe.id !== selected.id) });
    setSelectedId(config.resolvedCafes.find((cafe) => cafe.id !== selected.id)?.id ?? null);
  }

  async function saveDraft() {
    if (!config) return;
    setBusy(true);
    try {
      const saved = await api<{ overlay: CoffeeOverlayV1; etag: string }>("/api/admin/draft", { method: "PUT", body: JSON.stringify({ overlay: config.draft.overlay, etag: config.draft.etag }) });
      setConfig({ ...config, draft: { ...config.draft, ...saved } });
      setMessage("草稿已保存；公开页面不受影响。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败。"); } finally { setBusy(false); }
  }

  async function validate() {
    if (!config) return;
    setBusy(true);
    try {
      const result = await api<{ valid: boolean; cafeCount: number; activeCafeCount: number }>("/api/admin/validate", { method: "POST", body: JSON.stringify({ overlay: config.draft.overlay }) });
      setMessage(`严格校验通过：共 ${result.cafeCount} 家，公开有效 ${result.activeCafeCount} 家。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "校验失败。"); } finally { setBusy(false); }
  }

  async function trial() {
    if (!config) return;
    setBusy(true);
    try {
      const result = await api<{ explanation: string; selectedCafeIds: string[]; modelUsed: string }>("/api/admin/trial", { method: "POST", body: JSON.stringify({ overlay: config.draft.overlay, query: trialQuery, history: [] }) });
      setTrialResult(`${result.explanation}\n\n店铺 ID：${result.selectedCafeIds.join(" + ")}｜${result.modelUsed}`);
    } catch (error) { setTrialResult(error instanceof Error ? error.message : "试聊失败。"); } finally { setBusy(false); }
  }

  async function publish() {
    if (!config) return;
    setBusy(true);
    try {
      await api("/api/admin/publish", { method: "POST", body: JSON.stringify({ overlay: config.draft.overlay, pointerEtag: config.published.etag }) });
      setMessage("发布成功；新请求会在最多 60 秒内使用新版本。");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "发布失败。"); } finally { setBusy(false); }
  }

  async function rollback(pathname: string) {
    if (!config?.published.etag) return;
    setBusy(true);
    try {
      await api("/api/admin/rollback", { method: "POST", body: JSON.stringify({ releasePath: pathname, pointerEtag: config.published.etag }) });
      setMessage("回退成功：已生成一条新的回退版本，并同步为当前草稿。");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "回退失败。"); } finally { setBusy(false); }
  }

  async function generateCandidates() {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await api<{ candidates: { summary: string; tags: string[]; recommendation: string } }>("/api/admin/candidates", { method: "POST", body: JSON.stringify({ cafe: selected }) });
      setCandidateResult(JSON.stringify(result.candidates, null, 2));
      setMessage("候选已生成，但没有写入草稿，也不会自动发布。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "候选生成失败。"); } finally { setBusy(false); }
  }

  async function uploadImage(event: FormEvent) {
    event.preventDefault();
    if (!selected || !imageFile) return;
    const form = new FormData();
    form.set("file", imageFile);
    form.set("cafeId", selected.id);
    form.set("alt", imageAlt);
    form.set("caption", imageCaption);
    form.set("sourceLabel", selected.sourceLabel);
    form.set("sourceUrl", imageSourceUrl);
    form.set("rights", imageRights);
    form.set("verifiedAt", selected.verifiedAt);
    setBusy(true);
    try {
      const result = await api<{ image: Cafe["imageGallery"][number] }>("/api/admin/upload", { method: "POST", body: form });
      updateCafe({ imageGallery: [...selected.imageGallery, result.image], coverImage: selected.imageGallery.length ? selected.coverImage : result.image.src });
      setImageFile(null); setImageAlt(""); setImageCaption("");
      setMessage("图片已上传并加入浏览器草稿；仍需保存和发布才会公开。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "图片上传失败。"); } finally { setBusy(false); }
  }

  const draftDiff = useMemo(() => config ? JSON.stringify({ patches: config.draft.overlay.patches, additions: config.draft.overlay.additions }, null, 2) : "", [config]);

  if (loginRequired || !config) {
    return <main className="admin-login-shell"><form className="admin-login" onSubmit={login}><p className="eyebrow">四牌楼咖啡指北</p><h1>管理台</h1><p>单一管理口令只用于登录；核验人姓名会写入草稿和发布记录。</p><label>核验人姓名<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label><label>管理口令<input type="password" value={token} onChange={(event) => setToken(event.target.value)} required /></label><button type="submit" disabled={busy}>登录</button><p role="status">{message}</p></form></main>;
  }

  return (
    <main className="admin-shell">
      <header className="admin-header"><div><p className="eyebrow">CoffeeOverlay v1</p><h1>四牌楼咖啡管理台</h1><p>核验人：{config.editor}｜公开版本：{config.published.pointer?.releaseId ?? "静态基线"}</p></div><div className="admin-header-actions"><a href="/" target="_blank">查看公开站点</a><button type="button" onClick={() => void saveDraft()} disabled={busy || !config.draft.configured}>保存草稿</button></div></header>
      <p className="admin-notice" role="status">{message}</p>
      <nav className="admin-tabs" aria-label="管理功能">{([['cafes','店铺数据'],['prompt','提示词'],['trial','草稿试聊'],['publish','发布差异'],['history','历史版本']] as Array<[Tab,string]>).map(([id,label]) => <button key={id} type="button" aria-pressed={tab===id} onClick={() => setTab(id)}>{label}</button>)}</nav>

      {tab === "cafes" ? <section className="admin-workspace">
        <aside className="admin-list"><div className="admin-list-actions"><input aria-label="搜索店铺" placeholder="搜索店名或 ID" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">全部状态</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select><button type="button" onClick={addCafe}>新增店铺</button></div>{filtered.map((cafe) => <button type="button" key={cafe.id} className={selectedId===cafe.id?'admin-cafe-active':''} onClick={() => setSelectedId(cafe.id)}><strong>{cafe.name}</strong><span>{cafe.status} · {cafe.id}</span></button>)}</aside>
        {selected ? <div className="admin-editor">
          <div className="admin-editor-head"><div><p className="eyebrow">{selected.id}</p><h2>{selected.name}</h2></div><div><button type="button" onClick={restoreBaseline}>恢复静态基线</button><button type="button" onClick={removeUnpublishedAddition}>删除未发布新增店</button></div></div>
          <div className="admin-form-grid">
            <label>名称<input value={selected.name} onChange={(event) => updateCafe({name:event.target.value})}/></label><label>状态<select value={selected.status} onChange={(event) => updateCafe({status:event.target.value as Cafe['status']})}>{statuses.map((status)=><option key={status}>{status}</option>)}</select></label>
            <label>别名（逗号分隔）<input value={selected.aliases.join(',')} onChange={(event)=>updateCafe({aliases:event.target.value.split(',').map(v=>v.trim()).filter(Boolean)})}/></label><label>主场景<select value={selected.mainScene} onChange={(event)=>updateCafe({mainScene:event.target.value as Cafe['mainScene']})}><option value="quick_coffee">快速购买</option><option value="study">学习久坐</option><option value="chat">聊天</option></select></label>
            <label>位置描述<input value={selected.locationText} onChange={(event)=>updateCafe({locationText:event.target.value})}/></label><label>导航地址<input value={selected.address} onChange={(event)=>updateCafe({address:event.target.value,amapAddress:event.target.value})}/></label>
            <label>最近校门<input value={selected.nearestGate} onChange={(event)=>updateCafe({nearestGate:event.target.value})}/></label><label>高德 POI ID<input value={selected.amapPoiId??''} onChange={(event)=>updateCafe({amapPoiId:event.target.value||undefined})}/></label>
            <label>经度<input type="number" step="any" value={selected.longitude} onChange={(event)=>updateCafe({longitude:Number(event.target.value)})}/></label><label>纬度<input type="number" step="any" value={selected.latitude} onChange={(event)=>updateCafe({latitude:Number(event.target.value)})}/></label>
            <label>入口经度<input type="number" step="any" value={selected.entranceLongitude??''} onChange={(event)=>updateCafe({entranceLongitude:event.target.value?Number(event.target.value):undefined})}/></label><label>入口纬度<input type="number" step="any" value={selected.entranceLatitude??''} onChange={(event)=>updateCafe({entranceLatitude:event.target.value?Number(event.target.value):undefined})}/></label>
            <label>价格最低<input type="number" value={selected.priceRange.min} onChange={(event)=>updateCafe({priceRange:{...selected.priceRange,min:Number(event.target.value)}})}/></label><label>价格最高<input type="number" value={selected.priceRange.max} onChange={(event)=>updateCafe({priceRange:{...selected.priceRange,max:Number(event.target.value)}})}/></label>
            <label>价格等级<select value={selected.priceLevel} onChange={(event)=>updateCafe({priceLevel:event.target.value as Cafe['priceLevel']})}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><label>安静度 1–5<input type="number" min="1" max="5" value={selected.quietScore} onChange={(event)=>updateCafe({quietScore:Number(event.target.value)})}/></label>
            <label>座位<select value={selected.seatLevel} onChange={(event)=>updateCafe({seatLevel:event.target.value as Cafe['seatLevel']})}><option value="none">无</option><option value="limited">有限</option><option value="adequate">充足</option><option value="spacious">宽裕</option></select></label><label>插座<select value={selected.socketLevel} onChange={(event)=>updateCafe({socketLevel:event.target.value as Cafe['socketLevel']})}><option value="none">无</option><option value="limited">有限</option><option value="good">较稳</option></select></label>
            <label>Wi-Fi<select value={selected.wifi} onChange={(event)=>updateCafe({wifi:event.target.value as Cafe['wifi']})}><option value="yes">有</option><option value="no">无</option><option value="unknown">未知</option></select></label><label>洗手间<select value={selected.restroom} onChange={(event)=>updateCafe({restroom:event.target.value as Cafe['restroom']})}><option value="yes">有</option><option value="no">无</option><option value="unknown">未知</option></select></label>
            <label>外带<select value={selected.takeout} onChange={(event)=>updateCafe({takeout:event.target.value as Cafe['takeout']})}><option value="yes">支持</option><option value="no">不支持</option><option value="unknown">未知</option></select></label><label>临时营业提示<input value={selected.temporaryHoursNotice??''} onChange={(event)=>updateCafe({temporaryHoursNotice:event.target.value||undefined})}/></label>
            <label>工作日营业（如 08:00-18:00）<input value={intervalsText(selected,'monday')} onChange={(event)=>{const intervals=parseIntervals(event.target.value); updateCafe({weekdayHours:event.target.value,structuredHours:{...selected.structuredHours,weekly:{...selected.structuredHours.weekly,monday:intervals,tuesday:intervals,wednesday:intervals,thursday:intervals,friday:intervals}}})}}/></label><label>周末营业<input value={intervalsText(selected,'saturday')} onChange={(event)=>{const intervals=parseIntervals(event.target.value); updateCafe({weekendHours:event.target.value,structuredHours:{...selected.structuredHours,weekly:{...selected.structuredHours.weekly,saturday:intervals,sunday:intervals}}})}}/></label>
          </div>
          <label className="admin-wide-label">摘要<textarea value={selected.summary} onChange={(event)=>updateCafe({summary:event.target.value})}/></label><label className="admin-wide-label">补充观察<textarea value={selected.notes} onChange={(event)=>updateCafe({notes:event.target.value})}/></label><label className="admin-wide-label">标签（逗号分隔）<input value={selected.tags.join(',')} onChange={(event)=>updateCafe({tags:event.target.value.split(',').map(v=>v.trim()).filter(Boolean)})}/></label><label className="admin-wide-label">推荐菜单（逗号分隔）<input value={selected.recommendedItems.join(',')} onChange={(event)=>updateCafe({recommendedItems:event.target.value.split(',').map(v=>v.trim()).filter(Boolean)})}/></label>
          <fieldset><legend>本次核验信息</legend><div className="admin-form-grid"><label>来源说明<input value={selected.sourceLabel} onChange={(event)=>updateCafe({sourceLabel:event.target.value,sourceNote:event.target.value})}/></label><label>来源 URL<input value={selected.sourceUrl??''} onChange={(event)=>updateCafe({sourceUrl:event.target.value||undefined})}/></label><label>核验日期<input type="date" value={selected.verifiedAt} onChange={(event)=>updateCafe({verifiedAt:event.target.value})}/></label><label>核验人<input value={selected.verifiedBy} onChange={(event)=>updateCafe({verifiedBy:event.target.value})}/></label></div></fieldset>
          <div className="admin-map-preview"><span>坐标预览：{selected.longitude}, {selected.latitude}</span><a href={`https://uri.amap.com/marker?position=${selected.longitude},${selected.latitude}&name=${encodeURIComponent(selected.name)}`} target="_blank" rel="noreferrer">在高德查看</a></div>
          <form className="admin-image-form" onSubmit={uploadImage}><h3>图片与权利信息</h3><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event)=>setImageFile(event.target.files?.[0]??null)} required/><input placeholder="图片替代文字" value={imageAlt} onChange={(event)=>setImageAlt(event.target.value)} required/><input placeholder="图片说明" value={imageCaption} onChange={(event)=>setImageCaption(event.target.value)} required/><input placeholder="来源 URL（可选）" value={imageSourceUrl} onChange={(event)=>setImageSourceUrl(event.target.value)}/><input placeholder="权利说明" value={imageRights} onChange={(event)=>setImageRights(event.target.value)} required/><button type="submit" disabled={busy||!imageFile}>上传并加入草稿</button><ul>{selected.imageGallery.map((image,index)=><li key={`${image.src}-${index}`}>{index===0?'封面 · ':''}{image.caption}</li>)}</ul></form>
          <div className="admin-ai"><button type="button" onClick={() => void generateCandidates()} disabled={busy}>AI 生成摘要/标签/推荐语候选</button><pre>{candidateResult || '候选只会显示在这里，不会自动应用或发布。'}</pre></div>
        </div> : null}
      </section> : null}

      {tab === "prompt" ? <section className="admin-single"><h2>解释语气与表达要求</h2><textarea value={config.draft.overlay.promptStyle} onChange={(event)=>setConfig({...config,draft:{...config.draft,overlay:{...config.draft.overlay,promptStyle:event.target.value}}})}/><h3>不可编辑的安全规则</h3><ul>{config.fixedRules.map((rule)=><li key={rule}>{rule}</li>)}</ul></section> : null}
      {tab === "trial" ? <section className="admin-single"><h2>当前草稿试聊</h2><p>浏览器中的未保存草稿只用于这次试聊，不写 Blob，也不影响公开问答。</p><textarea value={trialQuery} onChange={(event)=>setTrialQuery(event.target.value)} maxLength={400}/><button type="button" onClick={() => void trial()} disabled={busy}>试聊</button><pre>{trialResult}</pre></section> : null}
      {tab === "publish" ? <section className="admin-single"><h2>发布差异与严格校验</h2><label>修改备注<input value={config.draft.overlay.note} onChange={(event)=>setConfig({...config,draft:{...config.draft,overlay:{...config.draft.overlay,note:event.target.value}}})}/></label><div className="admin-publish-actions"><button type="button" onClick={() => void validate()} disabled={busy}>严格校验</button><button type="button" onClick={() => void publish()} disabled={busy || !config.draft.configured}>发布新版本</button></div><pre>{draftDiff}</pre></section> : null}
      {tab === "history" ? <section className="admin-single"><h2>历史版本</h2>{config.versions.length ? <div className="version-list">{config.versions.map((version)=><article key={version.pathname}><div><strong>{version.kind === 'rollback'?'回退版本':'发布版本'} · {version.releaseId}</strong><p>{new Date(version.publishedAt).toLocaleString('zh-CN')} · {version.publishedBy}</p><p>{version.note}</p></div><button type="button" onClick={() => void rollback(version.pathname)} disabled={busy || version.pathname===config.published.pointer?.releasePath}>回退到这里</button></article>)}</div> : <p>还没有 Blob 发布历史。</p>}</section> : null}
    </main>
  );
}
