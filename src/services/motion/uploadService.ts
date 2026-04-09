/**
 * Motion Upload Service
 * Uploads motion samples to DT Cloud (Nextcloud) via WebDAV
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {MotionSample} from '../../types/motion';

const WEBDAV_URL = 'https://office.dngr.us/public.php/webdav/';
// Pre-computed: base64("TJ6dgd7kjQmgBPA:") — share token with empty password
const AUTH_HEADER = 'Basic VEo2ZGdkN2tqUW1nQlBBOg==';

const QUEUE_KEY = 'motion_upload_queue';
const MAX_QUEUE_SIZE = 500;

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

function buildFilename(sample: MotionSample): string {
  const device = sanitize(sample.deviceModel);
  const os = sanitize(`${sample.platform}${sample.osVersion}`);
  const ts = sample.timestamp.replace(/[:.]/g, '-');
  return `${device}__${os}__${ts}.json`;
}

async function getQueue(): Promise<MotionSample[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveQueue(queue: MotionSample[]): Promise<void> {
  // Enforce max queue size — drop oldest
  const trimmed =
    queue.length > MAX_QUEUE_SIZE
      ? queue.slice(queue.length - MAX_QUEUE_SIZE)
      : queue;
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
}

async function uploadOne(sample: MotionSample): Promise<boolean> {
  const filename = buildFilename(sample);
  const url = `${WEBDAV_URL}${filename}`;

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: AUTH_HEADER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sample),
    });
    // Nextcloud returns 201 Created or 204 No Content on success
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

export class MotionUploadService {
  /** Upload a sample immediately; queue on failure */
  async upload(sample: MotionSample): Promise<boolean> {
    const success = await uploadOne(sample);
    if (!success) {
      const queue = await getQueue();
      queue.push(sample);
      await saveQueue(queue);
    }
    return success;
  }

  /** Retry all queued samples */
  async retryQueue(): Promise<void> {
    const queue = await getQueue();
    if (queue.length === 0) {
      return;
    }

    const failed: MotionSample[] = [];
    for (const sample of queue) {
      const success = await uploadOne(sample);
      if (!success) {
        failed.push(sample);
      }
    }
    await saveQueue(failed);
  }

  async getQueueSize(): Promise<number> {
    const queue = await getQueue();
    return queue.length;
  }

  async clearQueue(): Promise<void> {
    await AsyncStorage.removeItem(QUEUE_KEY);
  }
}

export const uploadService = new MotionUploadService();
