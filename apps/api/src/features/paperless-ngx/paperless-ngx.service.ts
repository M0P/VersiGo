import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { SettingsResolverService } from '@versigo/foundation';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import type {
  IPaperlessAdapter,
  PaperlessDocumentMetadata,
  PaperlessSyncResult,
  PaperlessSearchResult,
  PaperlessTagAssignmentResult,
  PaperlessTagCreateResult,
  PaperlessTagDocumentRef,
  PaperlessTagLookupResult,
  PaperlessTagRequestError,
  PaperlessTagSearchResult,
  PaperlessTagSummary,
} from './paperless-ngx.interface';
import { optionalRelaxedHttpsAgent } from '../../common/connectivity/tls-agent';

interface PaperlessApiDocument {
  id: number;
  title: string | null;
  tags: Array<{ id: number; name: string } | number>;
  correspondent: number | null;
  document_type: number | null;
  notes: Array<{ note: string }> | null;
  created: string;
  modified: string;
  /** BugFix-21: reported by Paperless; may be absent on legacy servers. */
  mime_type?: string | null;
}

interface PaperlessApiCorrespondent {
  id: number;
  name: string;
}

interface PaperlessApiDocumentType {
  id: number;
  name: string;
}

interface PaperlessApiTag {
  id: number;
  name: string;
}

const PAPERLESS_API_BASE = '/api';

/**
 * Paperless-ngx API dialects. Paperless servers expose two incompatible
 * flavours of the REST API:
 *
 * - `v2`: modern Paperless-ngx with versioned `Accept: application/json;version=2`
 *   headers and the `query` search parameter.
 * - `legacy`: older servers (e.g. Paperless 3.x behind a versioning-aware
 *   reverse proxy) that reject every versioned Accept header with HTTP 406
 *   and use the `q` search parameter instead.
 *
 * The dialect is auto-negotiated on first use per configuration and cached,
 * so the app works against any server flavour without manual configuration.
 */
export type PaperlessDialect = 'v2' | 'legacy';

const DEFAULT_DIALECT: PaperlessDialect = 'v2';

/** Runtime configuration resolved per call through the central settings. */
interface RuntimePaperlessConfig {
  enabled: boolean;
  baseUrl: string;
  apiToken: string;
}

/**
 * Paperless-ngx adapter (AP-17).
 *
 * Configuration (PAPERLESS_ENABLED, PAPERLESS_URL, PAPERLESS_API_TOKEN) is
 * resolved per call through the central settings resolution (UI > .env >
 * default). Admin-UI changes therefore take effect immediately, without a
 * restart. With a disabled or incomplete configuration the adapter degrades
 * gracefully (null/empty results, no error thrown).
 *
 * BugFix-11: the API dialect (v2 vs. legacy) is auto-negotiated with a
 * lightweight probe request instead of assuming v2 (the user's Paperless 3.x
 * server rejects every versioned Accept header with 406). Secrets (API
 * token) are never logged.
 */
@Injectable()
export class PaperlessNgxService implements IPaperlessAdapter {
  private readonly logger = new Logger(PaperlessNgxService.name);
  /** Base URLs already warned about (prevents log spam for non-HTTPS). */
  private readonly warnedNonHttps = new Set<string>();
  /**
   * Negotiated dialect per configuration key (baseUrl + apiToken). Keying by
   * both values makes the cache reset automatically when the configuration
   * changes, so a renegotiation happens on the next call.
   */
  private readonly dialectCache = new Map<string, PaperlessDialect>();

  constructor(
    private readonly httpService: HttpService,
    private readonly settings: SettingsResolverService,
  ) {}

  private async runtimeConfig(): Promise<RuntimePaperlessConfig> {
    const enabled = (await this.settings.getEffectiveBoolean('PAPERLESS_ENABLED')) ?? false;
    const baseUrl = (
      (await this.settings.getEffectiveString('PAPERLESS_URL')) ?? ''
    ).replace(/\/+$/, '');
    const apiToken = (await this.settings.getEffectiveString('PAPERLESS_API_TOKEN')) ?? '';

    if (
      enabled &&
      baseUrl.length > 0 &&
      !baseUrl.startsWith('https://') &&
      !this.warnedNonHttps.has(baseUrl)
    ) {
      this.warnedNonHttps.add(baseUrl);
      this.logger.warn(
        'PAPERLESS_URL does not use HTTPS. The API token is transmitted in ' +
          'plain text. Use https:// for production environments.',
      );
    }

    return { enabled, baseUrl, apiToken };
  }

  private async isConfigured(): Promise<boolean> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    return enabled && baseUrl.length > 0 && apiToken.length > 0;
  }

  private createHeaders(apiToken: string, dialect: PaperlessDialect): Record<string, string> {
    return {
      Authorization: `Token ${apiToken}`,
      Accept: dialect === 'legacy' ? 'application/json' : 'application/json;version=2',
    };
  }

  private dialectCacheKey(baseUrl: string, apiToken: string): string {
    return `${baseUrl}::${apiToken}`;
  }

  /**
   * Resolves the API dialect for the given configuration, probing the server
   * on first use (or after a configuration change). The probe sends the v2
   * header to a lightweight endpoint; a 406 response means the server (or its
   * reverse proxy) rejects versioned Accept headers and the legacy dialect is
   * used from then on. Any other status (200/401/403/...) keeps v2 – 401/403
   * with the stored token indicate wrong token/permission, not a dialect
   * issue, and must surface as the real error as before. Communication
   * problems during the probe never throw (failure semantics unchanged) and
   * do not pin the dialect: the probe result is only cached when the server
   * gave a definitive answer, so a transient outage re-probes on the next
   * call instead of sticking to v2 forever.
   */
  private async resolveDialect(baseUrl: string, apiToken: string): Promise<PaperlessDialect> {
    const cacheKey = this.dialectCacheKey(baseUrl, apiToken);
    const cached = this.dialectCache.get(cacheKey);
    if (cached) return cached;

    const probe = await this.probeDialect(baseUrl, apiToken);
    if (probe === null) {
      this.logger.warn(
        `Paperless dialect probe failed for ${baseUrl} – using v2 for this call ` +
          '(the next call will re-probe)',
      );
      return DEFAULT_DIALECT;
    }
    this.dialectCache.set(cacheKey, probe);
    return probe;
  }

  /**
   * Returns 'legacy' when the server rejects the versioned Accept header
   * (406), 'v2' on any definitive server response, or null when the probe
   * itself failed (network/TLS) – a null result is intentionally NOT cached.
   */
  private async probeDialect(baseUrl: string, apiToken: string): Promise<PaperlessDialect | null> {
    try {
      const url = `${baseUrl}${PAPERLESS_API_BASE}/documents/?page_size=1`;
      const { status } = await firstValueFrom(
        this.httpService.get(url, {
          headers: this.createHeaders(apiToken, 'v2'),
          timeout: 10_000,
          ...(await this.tlsRelaxation()),
        }),
      );
      return status === 406 ? 'legacy' : 'v2';
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 406) return 'legacy';
      return null;
    }
  }

  /**
   * @param dialect optionally pre-resolved dialect (caller already resolved
   *   it, e.g. to pick a search parameter); when omitted, `get` resolves the
   *   dialect itself from the cache (or probe).
   */
  private async get<T>(path: string, dialect?: PaperlessDialect): Promise<T | null> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    if (!enabled || baseUrl.length === 0 || apiToken.length === 0) {
      this.logger.warn(`Paperless not configured - request ignored: GET ${path}`);
      return null;
    }

    const resolvedDialect = dialect ?? (await this.resolveDialect(baseUrl, apiToken));

    try {
      const url = `${baseUrl}${PAPERLESS_API_BASE}${path}`;
      const { data } = await firstValueFrom(
        this.httpService.get<T>(url, {
          headers: this.createHeaders(apiToken, resolvedDialect),
          timeout: 10_000,
          ...(await this.tlsRelaxation()),
        }),
      );
      return data;
    } catch (err) {
      this.logError('GET', path, err);
      return null;
    }
  }

  /**
   * BugFix-06 (part 2): TLS relaxation for Paperless endpoints with
   * self-signed certificates when the admin setting
   * CONNECTIVITY_ALLOW_SELF_SIGNED is active. A failed resolution degrades
   * safely to strict validation (no agent).
   */
  private async tlsRelaxation(): Promise<{ httpsAgent?: import('https').Agent }> {
    return optionalRelaxedHttpsAgent(this.settings);
  }

  private async fetchName(
    resource: 'correspondents' | 'document_types' | 'tags',
    id: number,
  ): Promise<string | null> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    if (!enabled || baseUrl.length === 0 || apiToken.length === 0) return null;

    const dialect = await this.resolveDialect(baseUrl, apiToken);

    try {
      const url = `${baseUrl}${PAPERLESS_API_BASE}/${resource}/${id}/`;
      const { data } = await firstValueFrom(
        this.httpService.get<PaperlessApiCorrespondent | PaperlessApiDocumentType | PaperlessApiTag>(
          url,
          {
            headers: this.createHeaders(apiToken, dialect),
            timeout: 10_000,
            ...(await this.tlsRelaxation()),
          },
        ),
      );
      return data.name;
    } catch {
      return null;
    }
  }

  private async resolveTagNames(tagIds: number[]): Promise<string[]> {
    if (tagIds.length === 0) return [];

    const resolved = await Promise.allSettled(
      tagIds.map((id) => this.fetchName('tags', id)),
    );

    return resolved
      .filter(
        (r): r is PromiseFulfilledResult<string> =>
          r.status === 'fulfilled' && r.value !== null,
      )
      .map((r) => r.value);
  }

  private async buildDeepLink(paperlessId: number): Promise<string> {
    const { baseUrl } = await this.runtimeConfig();
    return `${baseUrl}/documents/${paperlessId}/`;
  }

  private logError(method: string, path: string, err: unknown): void {
    if (err instanceof AxiosError) {
      this.logger.warn(
        `Paperless API ${method} ${path} failed: ` +
          `status=${err.response?.status ?? 'no response'}, ` +
          `message=${err.message}`,
      );
    } else if (err instanceof Error) {
      this.logger.warn(`Paperless API ${method} ${path} error: ${err.message}`);
    } else {
      this.logger.warn(`Paperless API ${method} ${path} unknown error`);
    }
  }

  /**
   * BugFix-21: the deep link is derived locally from the configured base URL
   * instead of reading the document from Paperless first. The document list
   * called this method once per linked document on every load, which turned
   * opening a policy's documents into N Paperless requests.
   */
  async getDeepLink(paperlessId: number): Promise<string | null> {
    if (!(await this.isConfigured())) return null;

    return this.buildDeepLink(paperlessId);
  }

  async getDocumentMetadata(paperlessId: number): Promise<PaperlessDocumentMetadata | null> {
    if (!(await this.isConfigured())) return null;

    const doc = await this.get<PaperlessApiDocument>(`/documents/${paperlessId}/`);
    if (!doc) return null;

    const tagIds: number[] = (doc.tags ?? []).map((t) => (typeof t === 'number' ? t : t.id));

    const [tags, correspondent, documentType] = await Promise.all([
      this.resolveTagNames(tagIds),
      doc.correspondent !== null
        ? this.fetchName('correspondents', doc.correspondent)
        : Promise.resolve(null),
      doc.document_type !== null
        ? this.fetchName('document_types', doc.document_type)
        : Promise.resolve(null),
    ]);

    const notesText =
      doc.notes && Array.isArray(doc.notes)
        ? doc.notes.map((n) => n.note).join('\n')
        : null;

    return {
      title: doc.title,
      tags,
      correspondent,
      documentType,
      notes: notesText,
      createdAt: doc.created ?? null,
      modifiedAt: doc.modified ?? null,
      // BugFix-21: only a real string counts as a MIME type.
      mimeType: typeof doc.mime_type === 'string' ? doc.mime_type : null,
    };
  }

  async syncDocument(paperlessId: number): Promise<PaperlessSyncResult> {
    if (!(await this.isConfigured())) {
      return {
        success: false,
        paperlessId: null,
        deepLink: null,
        error: 'Paperless is not configured',
      };
    }

    const doc = await this.get<PaperlessApiDocument>(`/documents/${paperlessId}/`);
    if (!doc) {
      return {
        success: false,
        paperlessId,
        deepLink: null,
        error: 'Document not found in Paperless',
      };
    }

    return {
      success: true,
      paperlessId: doc.id,
      deepLink: await this.buildDeepLink(doc.id),
    };
  }

  /**
   * Searches Paperless documents by a search term.
   *
   * BugFix-11: the search parameter depends on the negotiated dialect –
   * `q` for legacy servers, `query` for v2 servers.
   *
   * Note: currently only the first result page is returned. For large result
   * sets the Paperless API may contain further pages that are ignored. A
   * future update can introduce pagination parameters (page, pageSize).
   */
  async searchDocuments(query: string): Promise<PaperlessSearchResult[]> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    if (!enabled || baseUrl.length === 0 || apiToken.length === 0) return [];

    const dialect = await this.resolveDialect(baseUrl, apiToken);
    const searchParam = dialect === 'legacy' ? 'q' : 'query';

    const result = await this.get<{ results: PaperlessApiDocument[] }>(
      `/documents/?${searchParam}=${encodeURIComponent(query)}`,
      dialect,
    );
    if (!result) return [];

    const resolved = await Promise.allSettled(
      result.results.map(async (doc) => {
        const tagIds: number[] = (doc.tags ?? []).map((t) =>
          typeof t === 'number' ? t : t.id,
        );
        const tags = await this.resolveTagNames(tagIds);

        let correspondent: string | null = null;
        if (doc.correspondent !== null) {
          correspondent = await this.fetchName('correspondents', doc.correspondent);
        }

        return {
          paperlessId: doc.id,
          title: doc.title ?? '(no title)',
          deepLink: await this.buildDeepLink(doc.id),
          tags,
          correspondent,
        } satisfies PaperlessSearchResult;
      }),
    );

    return resolved
      .filter((r): r is PromiseFulfilledResult<PaperlessSearchResult> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  async healthCheck(): Promise<boolean> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    if (!enabled || baseUrl.length === 0 || apiToken.length === 0) return false;

    const dialect = await this.resolveDialect(baseUrl, apiToken);

    try {
      const url = `${baseUrl}${PAPERLESS_API_BASE}/`;
      const { status } = await firstValueFrom(
        this.httpService.get(url, {
          headers: this.createHeaders(apiToken, dialect),
          timeout: 5_000,
          ...(await this.tlsRelaxation()),
        }),
      );
      return status >= 200 && status < 300;
    } catch {
      return false;
    }
  }

  // --- AP-22: tag-based document assignment -------------------------------

  /**
   * Low-level request helper for the AP-22 tag endpoints. Unlike `get` it
   * exposes the HTTP status code so callers can distinguish 404 from
   * 401/403. Returns null when Paperless is disabled/unconfigured or the
   * request failed (network, timeout, 5xx).
   */
  private async requestRaw(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown } | null> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    if (!enabled || baseUrl.length === 0 || apiToken.length === 0) return null;

    const dialect = await this.resolveDialect(baseUrl, apiToken);

    try {
      const url = `${baseUrl}${PAPERLESS_API_BASE}${path}`;
      const config = {
        headers: {
          ...this.createHeaders(apiToken, dialect),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        timeout: 10_000,
        ...(await this.tlsRelaxation()),
      };
      const observable =
        method === 'GET'
          ? this.httpService.get(url, config)
          : this.httpService.request({
              url,
              method,
              data: body,
              ...config,
            });
      const { status, data } = await firstValueFrom(observable);
      return { status, data };
    } catch (err) {
      if (err instanceof AxiosError && err.response) {
        // Non-2xx with a server response: surface the status to the caller.
        return { status: err.response.status, data: err.response.data };
      }
      this.logError(method, path, err);
      return null;
    }
  }

  private static isTagPage(data: unknown): data is {
    results: Array<{ id: number; name: string }>;
    next: string | null;
    previous: string | null;
    count: number;
  } {
    return PaperlessNgxService.hasResultsArray(data);
  }

  /**
   * Separate guard for *document* pages: `fields=id,title` deliberately
   * omits the tag name, so the tag-page result type does not apply.
   */
  private static isDocumentPage(data: unknown): data is {
    results: Array<{ id: number; title?: string | null }>;
    next: string | null;
    previous: string | null;
    count: number;
  } {
    return PaperlessNgxService.hasResultsArray(data);
  }

  private static hasResultsArray(data: unknown): data is {
    results: Array<{ id: number }>;
    next: string | null;
    previous: string | null;
    count: number;
  } {
    return (
      typeof data === 'object' &&
      data !== null &&
      Array.isArray((data as { results?: unknown }).results)
    );
  }

  /**
   * AP-22: maps the HTTP status of a tag request onto the shared failure
   * vocabulary, so the interactive UI can name the cause instead of showing
   * "no results" (empty list) or a generic error.
   */
  private static classifyTagRequest(status: number): PaperlessTagRequestError {
    if (status === 401 || status === 403) return { kind: 'AUTH_FAILED' };
    if (status >= 500) return { kind: 'UNREACHABLE' };
    return { kind: 'REJECTED' };
  }

  async searchTags(query: string, page: number, pageSize: number): Promise<PaperlessTagSearchResult> {
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 20));

    if (!(await this.isConfigured())) {
      return { ok: false, error: { kind: 'NOT_CONFIGURED' } };
    }

    const term = query.trim();
    // `name__icontains` is supported by both API dialects (v2 and legacy);
    // results are additionally filtered client-side so a server that
    // ignores the filter cannot return unrelated tags.
    const nameFilter = term ? `&name__icontains=${encodeURIComponent(term)}` : '';
    const res = await this.requestRaw(
      'GET',
      `/tags/?page=${safePage}&page_size=${safeSize}&ordering=name${nameFilter}`,
    );
    if (!res) return { ok: false, error: { kind: 'UNREACHABLE' } };
    if (res.status !== 200) {
      return { ok: false, error: PaperlessNgxService.classifyTagRequest(res.status) };
    }
    // A 200 with an unexpected body makes the answer unusable (proxy, dialect
    // mismatch, truncated payload): the catalogue is just as unavailable as
    // if Paperless had not answered at all.
    if (!PaperlessNgxService.isTagPage(res.data)) {
      return { ok: false, error: { kind: 'UNREACHABLE' } };
    }

    const lowerTerm = term.toLowerCase();
    const items = res.data.results
      .filter((t) => !term || t.name.toLowerCase().includes(lowerTerm))
      .map((t) => ({ tagId: t.id, name: t.name }));
    // Page count follows the server: `count` is the number of matching tags
    // before the client-side re-filter, and a dialect that omits `count` falls
    // back to the `next` link. An empty catalogue yields 0 pages instead of 1 -
    // "load more" must not be offered for a list that can never grow.
    const count = typeof res.data.count === 'number' ? res.data.count : null;
    const pageCount =
      count === null
        ? res.data.next
          ? safePage + 1
          : safePage
        : count > 0
          ? Math.ceil(count / safeSize)
          : 0;

    return { ok: true, page: { items, page: safePage, pageCount } };
  }

  async getTag(tagId: number): Promise<PaperlessTagLookupResult> {
    if (!(await this.isConfigured())) {
      return { ok: false, error: { kind: 'NOT_CONFIGURED' } };
    }

    const res = await this.requestRaw('GET', `/tags/${tagId}/`);
    if (!res) return { ok: false, error: { kind: 'UNREACHABLE' } };
    if (res.status === 404) return { ok: false, error: { kind: 'NOT_FOUND' } };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: { kind: 'AUTH_FAILED' } };
    }
    const data = res.data as { id?: number; name?: string } | null;
    if (res.status !== 200 || !data || typeof data.id !== 'number' || typeof data.name !== 'string') {
      return { ok: false, error: { kind: 'UNREACHABLE' } };
    }
    return { ok: true, tag: { tagId: data.id, name: data.name } };
  }

  async createTag(name: string): Promise<PaperlessTagCreateResult> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return { ok: false, error: { kind: 'REJECTED' } };

    if (!(await this.isConfigured())) {
      return { ok: false, error: { kind: 'NOT_CONFIGURED' } };
    }

    // Pre-check for an identical name (exact match, case-sensitive like
    // Paperless itself) to avoid needless duplicates.
    const existing = await this.findTagByExactName(trimmed);
    if (existing) return { ok: true, tag: existing };

    const res = await this.requestRaw('POST', '/tags/', { name: trimmed });
    if (!res) return { ok: false, error: { kind: 'UNREACHABLE' } };
    if (res.status === 201) {
      const data = res.data as { id?: number; name?: string } | null;
      if (data && typeof data.id === 'number' && typeof data.name === 'string') {
        return { ok: true, tag: { tagId: data.id, name: data.name } };
      }
    }

    // Parallel creation race or server-side uniqueness: another request
    // may have created the tag in the meantime – resolve idempotently.
    if (res.status === 400 || res.status === 409) {
      const raced = await this.findTagByExactName(trimmed);
      if (raced) return { ok: true, tag: raced };
    }

    // A 201 without a usable body means the tag exists but its identity cannot
    // be confirmed – like an unavailable service, not a rejected request.
    if (res.status === 201) return { ok: false, error: { kind: 'UNREACHABLE' } };

    return { ok: false, error: PaperlessNgxService.classifyTagRequest(res.status) };
  }

  private async findTagByExactName(name: string): Promise<PaperlessTagSummary | null> {
    const res = await this.requestRaw(
      'GET',
      `/tags/?page=1&page_size=100&ordering=name&name__icontains=${encodeURIComponent(name)}`,
    );
    if (!res || res.status !== 200 || !PaperlessNgxService.isTagPage(res.data)) return null;
    const exact = res.data.results.find((t) => t.name === name);
    return exact ? { tagId: exact.id, name: exact.name } : null;
  }

  /** Upper bound of pages walked per sync (defense against runaway APIs). */
  private static readonly MAX_TAG_SYNC_PAGES = 50;
  private static readonly TAG_SYNC_PAGE_SIZE = 100;

  /**
   * AP-22: lists document references carrying a tag. Currently unused by
   * production code; the tag sync runs through the worker client.
   *
   * NOTE (BugFix-21 review #1): the tag sync in production runs exclusively
   * through the worker's `PaperlessTagClient.listDocumentsByTag`, which
   * requests `id,title,created,mime_type`. This API-side counterpart is kept
   * for interface/DI compatibility and still uses the minimal `id,title` field
   * list – switching the sync over to it would silently drop the document
   * date and MIME type (`createdAt`/`mimeType` are therefore also absent from
   * `PaperlessTagDocumentRef`). Do not use it as a sync source without
   * extending the field list.
   */
  async listDocumentsByTag(tagId: number): Promise<PaperlessTagDocumentRef[] | null> {
    if (!(await this.isConfigured())) return null;

    const all: PaperlessTagDocumentRef[] = [];
    // Stable ordering by ID so pagination is deterministic across pages.
    for (let pageNo = 1; pageNo <= PaperlessNgxService.MAX_TAG_SYNC_PAGES; pageNo++) {
      const res = await this.requestRaw(
        'GET',
        `/documents/?page=${pageNo}&page_size=${PaperlessNgxService.TAG_SYNC_PAGE_SIZE}` +
          `&ordering=id&fields=id,title&tags__id=${tagId}`,
      );
      if (!res || res.status !== 200 || !PaperlessNgxService.isDocumentPage(res.data)) {
        // Any failed page invalidates the whole result – the caller keeps
        // the previous assignments (no partial sync).
        return null;
      }
      for (const doc of res.data.results) {
        all.push({
          paperlessId: doc.id,
          title: typeof doc.title === 'string' ? doc.title : null,
        });
      }
      if (!res.data.next) {
        // Deduplicate by external document ID (stable sort + belt and braces).
        const seen = new Set<number>();
        return all.filter((d) => (seen.has(d.paperlessId) ? false : (seen.add(d.paperlessId), true)));
      }
    }
    // Page cap reached with more results pending: treat as failure so the
    // caller does not remove assignments that were simply not fetched.
    this.logger.warn(
      `Paperless tag ${tagId}: result set exceeds ${PaperlessNgxService.MAX_TAG_SYNC_PAGES} pages - sync aborted`,
    );
    return null;
  }

  async assignTagToDocument(
    paperlessDocumentId: number,
    tagId: number,
  ): Promise<PaperlessTagAssignmentResult> {
    if (!(await this.isConfigured())) {
      return { success: false, verified: false, errorCode: 'NOT_CONFIGURED' };
    }

    // Idempotent short-circuit: tag already present -> nothing to do.
    const before = await this.requestRaw('GET', `/documents/${paperlessDocumentId}/`);
    if (before && before.status === 404) {
      // Precise code shared with the worker client: the *document* is gone
      // (as opposed to `NOT_FOUND`, which a tag lookup uses for a deleted tag).
      return { success: false, verified: false, errorCode: 'DOCUMENT_NOT_FOUND' };
    }
    if (before && (before.status === 401 || before.status === 403)) {
      return { success: false, verified: false, errorCode: 'AUTH_FAILED' };
    }
    const beforeTags: unknown = (before?.data as { tags?: unknown } | null)?.tags;
    if (Array.isArray(beforeTags) && beforeTags.some((t) => t === tagId)) {
      return { success: true, verified: true };
    }

    // Preferred: additive bulk-edit operation ("modify_tags" with
    // added_tags) – it never overwrites concurrently changed tag lists.
    const bulk = await this.requestRaw('POST', '/bulk_edit/', {
      documents: [paperlessDocumentId],
      method: 'modify_tags',
      parameters: { added_tags: [tagId] },
    });

    let assigned = bulk !== null && bulk.status === 200;

    if (!assigned && bulk !== null && (bulk.status === 404 || bulk.status === 405)) {
      // Fallback for servers without the bulk-edit endpoint: read-merge-write.
      // Existing tags are preserved; the read happens immediately before the
      // write to keep the race window minimal. Verification below remains
      // the source of truth.
      if (before && Array.isArray(beforeTags)) {
        const merged = Array.from(new Set([...beforeTags.map((t) => Number(t)), tagId]));
        const patch = await this.requestRaw('PATCH', `/documents/${paperlessDocumentId}/`, {
          tags: merged,
        });
        assigned = patch !== null && patch.status === 200;
      }
    }

    if (!assigned) {
      const errorCode =
        bulk === null
          ? 'UNREACHABLE'
          : bulk.status === 401 || bulk.status === 403
            ? 'AUTH_FAILED'
            : bulk.status === 404
              ? 'DOCUMENT_NOT_FOUND'
              : 'API_ERROR';
      return { success: false, verified: false, errorCode };
    }

    // A merely accepted assignment (or async bulk-edit task) is NOT a
    // confirmed tag: verify by re-reading the document (short retry loop
    // for asynchronously processed bulk edits).
    for (let attempt = 0; attempt < 3; attempt++) {
      const after = await this.requestRaw('GET', `/documents/${paperlessDocumentId}/`);
      if (after && after.status === 200) {
        const afterTags: unknown = (after.data as { tags?: unknown }).tags;
        if (Array.isArray(afterTags) && afterTags.some((t) => t === tagId)) {
          return { success: true, verified: true };
        }
      } else if (after === null) {
        break; // unreachable – no point retrying immediately
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    return { success: false, verified: false, errorCode: 'VERIFY_FAILED' };
  }
}
