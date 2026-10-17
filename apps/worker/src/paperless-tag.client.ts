import { Injectable, Logger } from '@nestjs/common';
import * as https from 'node:https';
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
// Imported as a VALUE (not `import type`) so `emitDecoratorMetadata` can emit
// the constructor metadata Nest needs to inject the resolver.
import { SettingsResolverService } from '@versigo/foundation';
import {
  PAPERLESS_TAG_MAX_PAGES,
  PAPERLESS_TAG_PAGE_SIZE,
} from './paperless-tag.constants';

/**
 * AP-22: worker-side transport for the Paperless-ngx REST API.
 *
 * This is the *same* Paperless connection as the API adapter
 * (`apps/api/src/features/paperless-ngx/paperless-ngx.service.ts`): it reads
 * the identical `PAPERLESS_ENABLED` / `PAPERLESS_URL` / `PAPERLESS_API_TOKEN`
 * settings and uses the same `Authorization: Token …` header. It is NOT a
 * second connector configuration – only a minimal, dependency-free transport
 * for the background sync (the worker app cannot import the API feature and
 * must not pull the Nest HTTP module graph into its bundle).
 *
 * Only the three operations the sync actually needs are implemented:
 * tag lookup, paginated document lookup by tag and additive tag assignment.
 * Failure kinds map 1:1 onto the API adapter's result types so the sync
 * semantics stay identical.
 */

export type TagLookupErrorKind = 'NOT_FOUND' | 'AUTH_FAILED' | 'UNREACHABLE' | 'NOT_CONFIGURED';

export type TagLookupResult =
  | { ok: true; tagId: number; name: string }
  | { ok: false; error: TagLookupErrorKind };

export interface TagDocumentRef {
  paperlessId: number;
  title: string | null;
  /**
   * BugFix-21: Paperless `created` (the document date) as reported by the
   * API, or null when the server did not return it.
   */
  createdAt: string | null;
  /**
   * BugFix-21: Paperless `mime_type`, used for the document-type icon in the
   * UI. Null when the server did not return it.
   */
  mimeType: string | null;
}

export interface TagAssignmentResult {
  success: boolean;
  verified: boolean;
  errorCode?: string;
}

interface RuntimeConfig {
  enabled: boolean;
  baseUrl: string;
  apiToken: string;
}

/**
 * BugFix-21: field selection for the tag-filtered document listing. `created`
 * is the document date, `mime_type` drives the document-type icon. Both are
 * stored by the sync so displaying the document list never has to query
 * Paperless again.
 */
export const TAG_DOCUMENT_METADATA_FIELDS = 'id,title,created,mime_type';

/**
 * BugFix-21: minimal field selection used as a fallback when a server rejects
 * one of the extended field names (`400`). The sync then still works, it just
 * cannot store the optional metadata.
 */
export const TAG_DOCUMENT_MINIMAL_FIELDS = 'id,title';

/** Path of one page of the tag-filtered document listing. */
export function tagDocumentsPath(
  tagId: number,
  page: number,
  fields: string = TAG_DOCUMENT_METADATA_FIELDS,
): string {
  return (
    `/documents/?page=${page}&page_size=${PAPERLESS_TAG_PAGE_SIZE}` +
    `&ordering=id&fields=${fields}&tags__id=${tagId}`
  );
}

/** One raw entry of the Paperless document list response. */
export interface PaperlessTagDocumentEntry {
  id: number;
  title?: unknown;
  created?: unknown;
  mime_type?: unknown;
}

/**
 * Pure mapper for a Paperless document list entry. Only values that are
 * actually strings are accepted – a missing or malformed field becomes null
 * instead of a guessed value (the UI then falls back to the file extension).
 */
export function mapTagDocument(entry: PaperlessTagDocumentEntry): TagDocumentRef {
  return {
    paperlessId: entry.id,
    title: typeof entry.title === 'string' ? entry.title : null,
    createdAt: typeof entry.created === 'string' ? entry.created : null,
    mimeType: typeof entry.mime_type === 'string' ? entry.mime_type : null,
  };
}

interface PaperlessPage {
  results: Array<{
    id: number;
    name?: string;
    title?: unknown;
    created?: unknown;
    mime_type?: unknown;
  }>;
  next: string | null;
  count: number;
}

function isPage(data: unknown): data is PaperlessPage {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { results?: unknown }).results)
  );
}

/**
 * Nest injects this provider (see `WorkerModule`); `@Injectable()` is required
 * so that `emitDecoratorMetadata` emits the constructor parameter types and the
 * injector can resolve `SettingsResolverService`.
 */
@Injectable()
export class PaperlessTagClient {
  private readonly logger = new Logger(PaperlessTagClient.name);

  constructor(private readonly settings: SettingsResolverService) {}

  private async runtimeConfig(): Promise<RuntimeConfig> {
    const enabled = (await this.settings.getEffectiveBoolean('PAPERLESS_ENABLED')) ?? false;
    const baseUrl = ((await this.settings.getEffectiveString('PAPERLESS_URL')) ?? '').replace(
      /\/+$/,
      '',
    );
    const apiToken = (await this.settings.getEffectiveString('PAPERLESS_API_TOKEN')) ?? '';
    return { enabled, baseUrl, apiToken };
  }

  /** Effective base URL, used as the connection reference for staleness. */
  async baseUrl(): Promise<string> {
    return (await this.runtimeConfig()).baseUrl;
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown } | null> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    if (!enabled || baseUrl.length === 0 || apiToken.length === 0) return null;

    const config: AxiosRequestConfig = {
      method,
      url: `${baseUrl}/api${path}`,
      headers: {
        Authorization: `Token ${apiToken}`,
        // No versioned Accept header: plain JSON is accepted by both modern
        // Paperless-ngx v2 and legacy 3.x servers (the API adapter negotiates
        // the dialect for the interactive search; the background sync does
        // not depend on the `q`/`query` search parameter).
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      timeout: 15_000,
      data: body,
      ...(await this.tlsRelaxation()),
    };

    try {
      const { status, data } = await axios.request(config);
      return { status, data };
    } catch (err) {
      if (err instanceof AxiosError && err.response) {
        return { status: err.response.status, data: err.response.data };
      }
      this.logger.warn(
        `Paperless API ${method} ${path} failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return null;
    }
  }

  private async tlsRelaxation(): Promise<{ httpsAgent?: https.Agent }> {
    try {
      const allow =
        (await this.settings.getEffectiveBoolean('CONNECTIVITY_ALLOW_SELF_SIGNED')) ?? false;
      return allow ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) } : {};
    } catch {
      return {};
    }
  }

  async getTag(tagId: number): Promise<TagLookupResult> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    if (!enabled || baseUrl.length === 0 || apiToken.length === 0) {
      return { ok: false, error: 'NOT_CONFIGURED' };
    }

    const res = await this.request('GET', `/tags/${tagId}/`);
    if (!res) return { ok: false, error: 'UNREACHABLE' };
    if (res.status === 404) return { ok: false, error: 'NOT_FOUND' };
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'AUTH_FAILED' };

    const data = res.data as { id?: number; name?: string } | null;
    if (
      res.status !== 200 ||
      !data ||
      typeof data.id !== 'number' ||
      typeof data.name !== 'string'
    ) {
      return { ok: false, error: 'UNREACHABLE' };
    }
    return { ok: true, tagId: data.id, name: data.name };
  }

  /**
   * Walks ALL pages of the tag-filtered document query in stable ID order.
   * Any failed page invalidates the whole result (returns null) so the
   * caller keeps the last known assignments instead of a partial state.
   *
   * BugFix-21: the request also asks for the document date and the MIME type
   * so the sync can store the metadata shown in the UI. Servers that reject
   * the extended field list (400) are retried once with the minimal field
   * set instead of failing the whole sync.
   */
  async listDocumentsByTag(tagId: number): Promise<TagDocumentRef[] | null> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    if (!enabled || baseUrl.length === 0 || apiToken.length === 0) return null;

    const all: TagDocumentRef[] = [];
    let fields = TAG_DOCUMENT_METADATA_FIELDS;
    for (let page = 1; page <= PAPERLESS_TAG_MAX_PAGES; page++) {
      let res = await this.request('GET', tagDocumentsPath(tagId, page, fields));
      if (res && res.status === 400 && fields !== TAG_DOCUMENT_MINIMAL_FIELDS) {
        this.logger.warn(
          `Paperless tag ${tagId}: extended field list rejected - retrying with ${TAG_DOCUMENT_MINIMAL_FIELDS}`,
        );
        fields = TAG_DOCUMENT_MINIMAL_FIELDS;
        res = await this.request('GET', tagDocumentsPath(tagId, page, fields));
      }
      if (!res || res.status !== 200 || !isPage(res.data)) return null;

      for (const doc of res.data.results) {
        all.push(mapTagDocument(doc));
      }

      if (!res.data.next) {
        const seen = new Set<number>();
        return all.filter((d) =>
          seen.has(d.paperlessId) ? false : (seen.add(d.paperlessId), true),
        );
      }
    }

    this.logger.warn(
      `Paperless tag ${tagId}: result set exceeds ${PAPERLESS_TAG_MAX_PAGES} pages - sync aborted`,
    );
    return null;
  }

  /**
   * Additively assigns a tag (existing tags are preserved) and verifies the
   * result by re-reading the document. A merely accepted job is not a
   * confirmed assignment.
   */
  async assignTagToDocument(
    paperlessDocumentId: number,
    tagId: number,
  ): Promise<TagAssignmentResult> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    if (!enabled || baseUrl.length === 0 || apiToken.length === 0) {
      return { success: false, verified: false, errorCode: 'NOT_CONFIGURED' };
    }

    const before = await this.request('GET', `/documents/${paperlessDocumentId}/`);
    if (before && before.status === 404) {
      return { success: false, verified: false, errorCode: 'DOCUMENT_NOT_FOUND' };
    }
    if (before && (before.status === 401 || before.status === 403)) {
      return { success: false, verified: false, errorCode: 'AUTH_FAILED' };
    }
    const beforeTags: unknown = (before?.data as { tags?: unknown } | null)?.tags;
    if (Array.isArray(beforeTags) && beforeTags.some((t) => t === tagId)) {
      return { success: true, verified: true };
    }

    const bulk = await this.request('POST', '/bulk_edit/', {
      documents: [paperlessDocumentId],
      method: 'modify_tags',
      parameters: { added_tags: [tagId] },
    });

    let assigned = bulk !== null && bulk.status === 200;

    if (!assigned && bulk !== null && (bulk.status === 404 || bulk.status === 405)) {
      if (before && Array.isArray(beforeTags)) {
        const merged = Array.from(new Set([...beforeTags.map((t) => Number(t)), tagId]));
        const patch = await this.request('PATCH', `/documents/${paperlessDocumentId}/`, {
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

    // Verify by re-reading (short retry loop for async bulk edits).
    for (let attempt = 0; attempt < 3; attempt++) {
      const after = await this.request('GET', `/documents/${paperlessDocumentId}/`);
      if (after && after.status === 200) {
        const afterTags: unknown = (after.data as { tags?: unknown } | null)?.tags;
        if (Array.isArray(afterTags) && afterTags.some((t) => t === tagId)) {
          return { success: true, verified: true };
        }
      } else if (after === null) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    return { success: false, verified: false, errorCode: 'VERIFY_FAILED' };
  }
}
