import { get, list, put, type ListBlobResultBlob } from "@vercel/blob";

export interface StoredJson {
  text: string;
  etag: string;
  pathname: string;
  uploadedAt?: Date;
}

export interface JsonStorage {
  configured: boolean;
  read(pathname: string, useCache: boolean): Promise<StoredJson | null>;
  write(pathname: string, text: string, options: { immutable?: boolean; ifMatch?: string }): Promise<{ etag: string; pathname: string }>;
  list(prefix: string): Promise<Array<{ pathname: string; etag: string; uploadedAt: Date }>>;
}

export class VercelJsonStorage implements JsonStorage {
  readonly configured: boolean;
  constructor(
    private readonly token = process.env.COFFEE_DATA_BLOB_READ_WRITE_TOKEN || "",
    private readonly storeId = process.env.COFFEE_DATA_BLOB_STORE_ID || "",
  ) {
    this.configured = Boolean(token || storeId);
  }

  private credentials() {
    return this.token ? { token: this.token } : { storeId: this.storeId };
  }

  async read(pathname: string, useCache: boolean) {
    if (!this.configured) return null;
    const result = await get(pathname, { access: "private", useCache, ...this.credentials() });
    if (!result || result.statusCode !== 200) return null;
    return {
      text: await new Response(result.stream).text(),
      etag: result.blob.etag,
      pathname: result.blob.pathname,
      uploadedAt: result.blob.uploadedAt,
    };
  }

  async write(pathname: string, text: string, options: { immutable?: boolean; ifMatch?: string }) {
    if (!this.configured) throw new Error("blob_not_configured");
    const result = await put(pathname, text, {
      access: "private",
      contentType: "application/json; charset=utf-8",
      addRandomSuffix: false,
      allowOverwrite: !options.immutable,
      ifMatch: options.ifMatch,
      ...this.credentials(),
      cacheControlMaxAge: 60,
    });
    return { etag: result.etag, pathname: result.pathname };
  }

  async list(prefix: string) {
    if (!this.configured) return [];
    const found: ListBlobResultBlob[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 100, ...this.credentials() });
      found.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return found.map((blob) => ({ pathname: blob.pathname, etag: blob.etag, uploadedAt: blob.uploadedAt }));
  }
}

export class MemoryJsonStorage implements JsonStorage {
  configured = true;
  private readonly values = new Map<string, StoredJson>();
  private etagCounter = 0;

  async read(pathname: string) {
    return this.values.get(pathname) ?? null;
  }

  async write(pathname: string, text: string, options: { immutable?: boolean; ifMatch?: string }) {
    const current = this.values.get(pathname);
    if (options.immutable && current) throw new Error("blob_already_exists");
    if (options.ifMatch !== undefined && current?.etag !== options.ifMatch) throw new Error("etag_conflict");
    if (options.ifMatch === undefined && current && !options.immutable) {
      // Unconditional writes are used only when a document does not yet exist.
      throw new Error("etag_required");
    }
    const etag = `memory-${++this.etagCounter}`;
    this.values.set(pathname, { text, etag, pathname, uploadedAt: new Date() });
    return { etag, pathname };
  }

  async list(prefix: string) {
    return [...this.values.values()]
      .filter((value) => value.pathname.startsWith(prefix))
      .map((value) => ({ pathname: value.pathname, etag: value.etag, uploadedAt: value.uploadedAt ?? new Date(0) }));
  }

  seed(pathname: string, value: unknown) {
    const etag = `memory-${++this.etagCounter}`;
    this.values.set(pathname, { text: JSON.stringify(value), etag, pathname, uploadedAt: new Date() });
    return etag;
  }
}
