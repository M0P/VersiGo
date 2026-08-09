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

  async getDeepLink(paperlessId: number): Promise<string | null> {
    if (!(await this.isConfigured())) return null;

    const doc = await this.get<PaperlessApiDocument>(`/documents/${paperlessId}/`);
    if (!doc) return null;

    return this.buildDeepLink(doc.id);
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
}
