import { statfs } from 'node:fs/promises';

export async function diskStatus({ path = '/data', minimumFreeBytes = 10 * 1024 ** 3 } = {}, incomingBytes = 0) {
  try {
    const info = await statfs(path);
    const freeBytes = info.bavail * info.bsize;
    return { ok: Number.isSafeInteger(minimumFreeBytes) && minimumFreeBytes >= 0 && Number.isSafeInteger(incomingBytes) && incomingBytes >= 0 && freeBytes - incomingBytes >= minimumFreeBytes, freeBytes };
  } catch {
    return { ok: false, freeBytes: null };
  }
}
