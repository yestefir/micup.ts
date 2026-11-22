import { assertFileName, snowflake } from './messages.js';
import type { MicupRequestOptions, RestTransport } from './transport.js';

export interface AttachmentUpload {
  name: string;
  data: Blob;
  contentType?: string;
  description?: string;
}

export interface UploadedAttachment {
  filename: string;
  upload_filename: string;
  file_size: number;
  content_type: string;
  description?: string;
  title?: string;
  flags?: number;
}

export interface RefreshedAttachmentURL {
  original: string;
  refreshed: string;
}

interface UploadPlanItem {
  upload_filename: string;
  content_type?: string;
  upload_mode: string;
  upload_url?: string;
  upload_id?: string;
  part_size?: number;
  parts?: { part_number: number; upload_url: string }[];
}

function uploadURL(address?: string): URL {
  if (!address || !URL.canParse(address)) throw new Error('Micup returned an invalid upload URL');
  const url = new URL(address);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.hash) {
    throw new Error('Micup returned an invalid upload URL');
  }
  return url;
}

async function put(url: URL, data: Blob, signal?: AbortSignal, contentType?: string): Promise<void> {
  const headers = new Headers({ 'User-Agent': 'micup.ts' });
  if (contentType) headers.set('Content-Type', contentType);
  let response: Response;
  try {
    response = await fetch(url.href, { method: 'PUT', body: data, headers, signal, redirect: 'error' });
  } catch (cause) {
    signal?.throwIfAborted();
    throw new Error('Micup attachment upload failed', { cause });
  }
  await response.body?.cancel();
  if (!response.ok) throw new Error('Micup attachment upload returned HTTP ' + response.status);
}

export class MicupAttachments {
  constructor(private readonly rest: RestTransport) {}

  async upload(channelId: string, upload: AttachmentUpload, { signal }: MicupRequestOptions = {}): Promise<UploadedAttachment> {
    const path = '/channels/' + snowflake(channelId, 'Channel ID') + '/attachments';
    assertFileName(upload.name);
    if (!(upload.data instanceof Blob) || upload.data.size <= 0) throw new TypeError('An attachment needs a nonempty Blob');
    const { name, data, description } = upload;
    const type = (upload.contentType ?? data.type) || 'application/octet-stream';
    const plan = await this.rest.request<{ attachments: UploadPlanItem[] }>('POST', path, {
      signal,
      body: { attachments: [{ id: 0, filename: name, file_size: data.size, content_type: type }] },
    });

    const attachments = plan?.attachments;
    const item = Array.isArray(attachments) ? attachments[0] : undefined;
    if (!Array.isArray(attachments) || attachments.length !== 1 || typeof item?.upload_filename !== 'string' ||
        !item.upload_filename || item.content_type !== undefined && typeof item.content_type !== 'string') {
      throw new Error('Micup returned an invalid upload plan');
    }
    const contentType = item.content_type || type;
    if (item.upload_mode === 'singlepart') {
      await put(uploadURL(item.upload_url), data, signal, contentType);
    } else if (item.upload_mode === 'multipart') {
      const size = item.part_size;
      if (!size || !Number.isSafeInteger(size) || size < 1 || typeof item.upload_id !== 'string' || !item.upload_id ||
          !Array.isArray(item.parts) || item.parts.length !== Math.ceil(data.size / size)) {
        throw new Error('Micup returned an invalid multipart upload plan');
      }
      if (item.parts.some((part) => !part || typeof part !== 'object' ||
          !Number.isSafeInteger(part.part_number) || typeof part.upload_url !== 'string')) {
        throw new Error('Micup returned an invalid multipart upload plan');
      }
      const urls = [...item.parts].sort((a, b) => a.part_number - b.part_number).map((part, index) => {
        if (part.part_number !== index + 1) {
          throw new Error('Micup returned an invalid multipart upload plan');
        }
        return uploadURL(part.upload_url);
      });
      for (const [index, url] of urls.entries()) {
        await put(url, data.slice(index * size, (index + 1) * size), signal);
      }
      await this.rest.request<void>('POST', path + '/complete', {
        signal, body: { uploads: [{ upload_filename: item.upload_filename, upload_id: item.upload_id }] },
      });
    } else {
      throw new Error('Unsupported Micup upload mode');
    }
    return { filename: name, upload_filename: item.upload_filename, file_size: data.size, content_type: contentType, description };
  }

  async refresh(urls: readonly string[], options?: MicupRequestOptions): Promise<RefreshedAttachmentURL[]> {
    if (!Array.isArray(urls)) throw new TypeError('Attachment refresh URLs must be an array');
    if (!urls.length || urls.length > 50) throw new RangeError('An attachment refresh takes 1 to 50 URLs');
    for (const url of urls) {
      if (typeof url !== 'string' || !url) throw new TypeError('Attachment refresh URLs must be nonempty strings');
    }
    const result = await this.rest.request<{ refreshed_urls: RefreshedAttachmentURL[] }>('POST', '/attachments/refresh-urls', {
      ...options, body: { attachment_urls: urls }, idempotent: true,
    });
    const refreshed = result?.refreshed_urls;
    if (!Array.isArray(refreshed) || refreshed.length !== urls.length) {
      throw new Error('Micup returned an invalid attachment refresh response');
    }
    for (const item of refreshed) {
      if (!item || typeof item !== 'object' || typeof item.original !== 'string' || !item.original ||
          typeof item.refreshed !== 'string' || !item.refreshed) {
        throw new Error('Micup returned an invalid attachment refresh response');
      }
    }
    return refreshed;
  }
}
