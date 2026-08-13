import { noStoreJson } from "../../../../lib/api-error";
import { authorizeAdmin } from "../../../../lib/admin-api";
import { applyOverlay, getPublishedPointer, listReleases, readDraft } from "../../../../lib/data/service";

export async function GET(request: Request) {
  const auth = authorizeAdmin(request);
  if ("response" in auth) return auth.response;
  try {
    const [draft, published, versions] = await Promise.all([
      readDraft(undefined, auth.session.name),
      getPublishedPointer(),
      listReleases(),
    ]);
    return noStoreJson({
      editor: auth.session.name,
      draft,
      resolvedCafes: applyOverlay(draft.overlay),
      published,
      versions: versions.map((item) => ({ pathname: item.pathname, etag: item.etag, ...item.release })),
      fixedRules: ["规则引擎固定选择最多两家", "模型不能更换店铺", "所有事实只能来自已发布数据", "任何模型故障都必须使用本地完整推荐"],
    });
  } catch {
    return noStoreJson({ error: { code: "ADMIN_DATA_UNAVAILABLE", message: "管理数据暂时不可读取。" } }, { status: 503 });
  }
}
