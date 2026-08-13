import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import sharp from "sharp";
import { z } from "zod";

import { apiError, noStoreJson } from "../../../../lib/api-error";
import { authorizeAdmin } from "../../../../lib/admin-api";
import { safeHttpUrl } from "../../../../lib/data/schema";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const allowedMime = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const metadataSchema = z.object({
  cafeId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  alt: z.string().trim().min(1).max(200),
  caption: z.string().trim().min(1).max(500),
  sourceLabel: z.string().trim().min(1).max(200),
  sourceUrl: z.string().max(1000).optional(),
  rights: z.string().trim().min(1).max(300),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

export async function POST(request: Request) {
  const auth = authorizeAdmin(request, { mutation: true });
  if ("response" in auth) return auth.response;
  const token = process.env.COFFEE_MEDIA_BLOB_READ_WRITE_TOKEN?.trim() || "";
  const storeId = process.env.COFFEE_MEDIA_BLOB_STORE_ID?.trim() || "";
  if (!token && !storeId) return apiError(503, "MEDIA_BLOB_NOT_CONFIGURED", "媒体 Blob 尚未配置。");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_FILE_BYTES + 64 * 1024) return apiError(413, "IMAGE_TOO_LARGE", "图片最大 5 MiB。");
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !allowedMime.has(file.type) || file.size > MAX_FILE_BYTES) return apiError(400, "INVALID_IMAGE", "只接受 5 MiB 内的 JPEG、PNG、WebP 或 AVIF。");
    const metadata = metadataSchema.parse({
      cafeId: form.get("cafeId"),
      alt: form.get("alt"),
      caption: form.get("caption"),
      sourceLabel: form.get("sourceLabel"),
      sourceUrl: form.get("sourceUrl") || undefined,
      rights: form.get("rights"),
      verifiedAt: form.get("verifiedAt"),
    });
    const sourceUrl = metadata.sourceUrl ? safeHttpUrl(metadata.sourceUrl) : undefined;
    if (metadata.sourceUrl && !sourceUrl) return apiError(400, "INVALID_SOURCE_URL", "图片来源只允许 HTTP(S) URL。");
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { failOn: "warning", limitInputPixels: 40_000_000 });
    const inspected = await image.metadata();
    if (!inspected.format || !["jpeg", "png", "webp", "avif"].includes(inspected.format)) return apiError(400, "INVALID_IMAGE", "图片内容与文件类型不匹配。");
    const output = await image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    const pathname = `coffee-media/${metadata.cafeId}/${Date.now()}-${randomUUID()}.webp`;
    const uploaded = await put(pathname, output, {
      access: "public",
      contentType: "image/webp",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
      ...(token ? { token } : { storeId }),
    });
    return noStoreJson({
      image: {
        src: uploaded.url,
        alt: metadata.alt,
        caption: metadata.caption,
        sourceLabel: metadata.sourceLabel,
        sourceUrl,
        rights: metadata.rights,
        verifiedAt: metadata.verifiedAt,
        verifiedBy: auth.session.name,
      },
      applied: false,
      published: false,
    });
  } catch {
    return apiError(400, "IMAGE_UPLOAD_FAILED", "图片校验或上传失败，草稿未改变。");
  }
}
