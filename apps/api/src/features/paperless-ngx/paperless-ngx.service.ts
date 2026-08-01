import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { SettingsResolverService } from '@insura/foundation';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import type {
  IPaperlessAdapter,
  PaperlessDocumentMetadata,
  PaperlessSyncResult,
  PaperlessSearchResult,
} from './paperless-ngx.interface';

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
 * Paperless-ngx-Adapter (AP-17).
 *
 * Konfiguration (PAPERLESS_ENABLED, PAPERLESS_URL, PAPERLESS_API_TOKEN)
 * wird pro Aufruf ueber die zentrale Settings-Aufloesung bezogen
 * (UI > .env > Default). Admin-UI-Aenderungen wirken damit sofort, ohne
 * Neustart. Bei deaktivierter oder unvollstaendiger Konfiguration
 * degradiert der Adapter kontrolliert (null/leere Ergebnisse, kein Fehler).
 * Secrets (API-Token) werden niemals geloggt.
 */
@Injectable()
export class PaperlessNgxService implements IPaperlessAdapter {
  private readonly logger = new Logger(PaperlessNgxService.name);
  /** Bereits gewarnte Basis-URLs (verhindert Log-Spam bei Nicht-HTTPS). */
  private readonly warnedNonHttps = new Set<string>();

  constructor(
    private readonly httpService: HttpService,
    private readonly settings: SettingsResolverService,
  ) {}

  private async runtimeConfig(): Promise<{
    enabled: boolean;
    baseUrl: string;
    apiToken: string;
  }> {
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
        'PAPERLESS_URL verwendet kein HTTPS. Der API-Token wird im Klartext ' +
          'uebertragen. Verwende https:// fuer Produktionsumgebungen.',
      );
    }

    return { enabled, baseUrl, apiToken };
  }

  private async isConfigured(): Promise<boolean> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    return enabled && baseUrl.length > 0 && apiToken.length > 0;
  }

  private createHeaders(apiToken: string): Record<string, string> {
    return {
      Authorization: `Token ${apiToken}`,
      Accept: 'application/json;version=2',
    };
  }

  private async get<T>(path: string): Promise<T | null> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    if (!enabled || baseUrl.length === 0 || apiToken.length === 0) {
      this.logger.warn(`Paperless nicht konfiguriert – Anfrage ignoriert: GET ${path}`);
      return null;
    }

    try {
      const url = `${baseUrl}${PAPERLESS_API_BASE}${path}`;
      const { data } = await firstValueFrom(
        this.httpService.get<T>(url, {
          headers: this.createHeaders(apiToken),
          timeout: 10_000,
        }),
      );
      return data;
    } catch (err) {
      this.logError('GET', path, err);
      return null;
    }
  }

  private async fetchName(
    resource: 'correspondents' | 'document_types' | 'tags',
    id: number,
  ): Promise<string | null> {
    const { enabled, baseUrl, apiToken } = await this.runtimeConfig();
    if (!enabled || baseUrl.length === 0 || apiToken.length === 0) return null;

    try {
      const url = `${baseUrl}${PAPERLESS_API_BASE}/${resource}/${id}/`;
      const { data } = await firstValueFrom(
        this.httpService.get<PaperlessApiCorrespondent | PaperlessApiDocumentType | PaperlessApiTag>(
          url,
          {
            headers: this.createHeaders(apiToken),
            timeout: 10_000,
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
        `Paperless-API ${method} ${path} fehlgeschlagen: ` +
          `status=${err.response?.status ?? 'keine Antwort'}, ` +
          `message=${err.message}`,
      );
    } else if (err instanceof Error) {
      this.logger.warn(`Paperless-API ${method} ${path} Fehler: ${err.message}`);
    } else {
      this.logger.warn(`Paperless-API ${method} ${path} unbekannter Fehler`);
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
        error: 'Paperless nicht konfiguriert',
      };
    }

    const doc = await this.get<PaperlessApiDocument>(`/documents/${paperlessId}/`);
    if (!doc) {
      return {
        success: false,
        paperlessId,
        deepLink: null,
        error: 'Dokument in Paperless nicht gefunden',
      };
    }

    return {
      success: true,
      paperlessId: doc.id,
      deepLink: await this.buildDeepLink(doc.id),
    };
  }

  /**
   * Sucht nach Dokumenten in Paperless anhand eines Suchbegriffs.
   *
   * Hinweis: Aktuell wird nur die erste Suchergebnisseite zurueckgegeben.
   * Bei grossen Ergebnismengen kann die Paperless-API weitere Seiten
   * enthalten, die ignoriert werden. Ein zukuenftiges Update kann
   * Paginierungsparameter (page, pageSize) einfuehren.
   */
  async searchDocuments(query: string): Promise<PaperlessSearchResult[]> {
    if (!(await this.isConfigured())) return [];

    const result = await this.get<{ results: PaperlessApiDocument[] }>(
      `/documents/?query=${encodeURIComponent(query)}`,
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
          title: doc.title ?? '(kein Titel)',
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

    try {
      const url = `${baseUrl}${PAPERLESS_API_BASE}/`;
      const { status } = await firstValueFrom(
        this.httpService.get(url, {
          headers: this.createHeaders(apiToken),
          timeout: 5_000,
        }),
      );
      return status >= 200 && status < 300;
    } catch {
      return false;
    }
  }
}
