// Pure browser Canvas2D image loading, edge-aware background removal, crop, and color filters.
// Contains ZERO binary asset imports so Node/tsx unit tests can safely share modules that reference it.

const rawCache = new Map<string, string>();
const processedCache = new Map<string, string>();

export function loadRawImageElement(src?: string | null): Promise<HTMLImageElement | null> {
  if (!src || typeof document === 'undefined') return Promise.resolve(null);
  const cleanSrc = src.trim();
  if (!cleanSrc) return Promise.resolve(null);

  const tryDirect = (url: string) =>
    new Promise<HTMLImageElement | null>(resolve => {
      const img = new Image();
      if (!url.startsWith('data:') && !url.startsWith('blob:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });

  if (cleanSrc.startsWith('data:') || cleanSrc.startsWith('blob:')) {
    return tryDirect(cleanSrc);
  }

  if (typeof fetch !== 'undefined') {
    return fetch(cleanSrc, { mode: 'cors', credentials: 'omit' })
      .then(async res => {
        if (!res.ok) return tryDirect(cleanSrc);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const loaded = await tryDirect(objectUrl);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        return loaded || tryDirect(cleanSrc);
      })
      .catch(() => tryDirect(cleanSrc));
  }

  return tryDirect(cleanSrc);
}

/**
 * Flood-fill edge-connected light/white studio background remover using Canvas2D.
 * Only clears light regions connected to image borders, preserving light garments inside silhouettes.
 */
export async function removeLightBackgroundToDataUrl(
  src?: string | null,
  tolerance = 36
): Promise<string | null> {
  if (typeof document === 'undefined' || !src) return src || null;
  const cacheKey = `${src.slice(0, 128)}::${src.length}::${tolerance}`;
  const cached = rawCache.get(cacheKey);
  if (cached) return cached;

  const img = await loadRawImageElement(src);
  if (!img || !img.naturalWidth || !img.naturalHeight) return src;

  const maxEdge = 960;
  const ratio = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * ratio));
  const h = Math.max(1, Math.round(img.naturalHeight * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return src;

  ctx.drawImage(img, 0, 0, w, h);
  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch {
    return src;
  }

  const data = imageData.data;
  const total = w * h;

  const sampleCorner = (x: number, y: number) => {
    const idx = (y * w + x) * 4;
    return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
  };
  const corners = [
    sampleCorner(0, 0),
    sampleCorner(w - 1, 0),
    sampleCorner(0, h - 1),
    sampleCorner(w - 1, h - 1),
  ];
  const avgCornerLum =
    corners.reduce((sum, c) => sum + (c[0] + c[1] + c[2]) / 3, 0) / corners.length;

  if (avgCornerLum < 180 && corners.every(c => c[3] > 200)) {
    return src;
  }

  const lumCutoff = Math.max(170, 255 - tolerance * 1.45);
  const visited = new Uint8Array(total);
  const bgMask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const isBgPixel = (pIdx: number): boolean => {
    const o = pIdx * 4;
    if (data[o + 3] < 32) return true;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const lum = (r + g + b) / 3;
    return lum >= lumCutoff && sat <= tolerance * 1.25;
  };

  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const pIdx = y * w + x;
    if (visited[pIdx]) return;
    visited[pIdx] = 1;
    if (isBgPixel(pIdx)) {
      bgMask[pIdx] = 1;
      queue[tail++] = pIdx;
    }
  };

  for (let x = 0; x < w; x++) {
    enqueue(x, 0);
    enqueue(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    enqueue(0, y);
    enqueue(w - 1, y);
  }

  while (head < tail) {
    const pIdx = queue[head++];
    const x = pIdx % w;
    const y = (pIdx - x) / w;
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < w) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < h) enqueue(x, y + 1);
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pIdx = y * w + x;
      const o = pIdx * 4;
      if (bgMask[pIdx]) {
        data[o + 3] = 0;
      } else {
        let bgNeighbors = 0;
        if (x > 0 && bgMask[pIdx - 1]) bgNeighbors++;
        if (x + 1 < w && bgMask[pIdx + 1]) bgNeighbors++;
        if (y > 0 && bgMask[pIdx - w]) bgNeighbors++;
        if (y + 1 < h && bgMask[pIdx + w]) bgNeighbors++;
        if (bgNeighbors > 0) {
          const lum = (data[o] + data[o + 1] + data[o + 2]) / 3;
          if (lum > lumCutoff - 28) {
            data[o + 3] = Math.round(data[o + 3] * (bgNeighbors >= 2 ? 0.35 : 0.65));
          }
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const outUrl = canvas.toDataURL('image/png');
  if (rawCache.size > 40) {
    const first = rawCache.keys().next().value;
    if (first) rawCache.delete(first);
  }
  rawCache.set(cacheKey, outUrl);
  return outUrl;
}

export async function loadProcessedLayerImage(opts: {
  src: string;
  removeLightBg?: boolean;
  bgRemovalTolerance?: number;
  brightness?: number;
  contrast?: number;
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
}): Promise<HTMLImageElement | null> {
  if (!opts.src || typeof document === 'undefined') return null;

  const effectiveSrc = opts.removeLightBg
    ? (await removeLightBackgroundToDataUrl(opts.src, opts.bgRemovalTolerance ?? 36)) || opts.src
    : opts.src;

  const brightness = opts.brightness ?? 100;
  const contrast = opts.contrast ?? 100;
  const cx = Math.max(0, Math.min(0.95, opts.cropX ?? 0));
  const cy = Math.max(0, Math.min(0.95, opts.cropY ?? 0));
  const cw = Math.max(0.05, Math.min(1 - cx, opts.cropW ?? 1));
  const ch = Math.max(0.05, Math.min(1 - cy, opts.cropH ?? 1));

  const needsCropOrFilter =
    brightness !== 100 || contrast !== 100 || cx > 0.001 || cy > 0.001 || cw < 0.999 || ch < 0.999;

  if (!needsCropOrFilter) {
    return loadRawImageElement(effectiveSrc);
  }

  const pKey = `${effectiveSrc.slice(0, 96)}:${effectiveSrc.length}:${cx}:${cy}:${cw}:${ch}:${brightness}:${contrast}`;
  const cachedDataUrl = processedCache.get(pKey);
  if (cachedDataUrl) {
    return loadRawImageElement(cachedDataUrl);
  }

  const baseImg = await loadRawImageElement(effectiveSrc);
  if (!baseImg || !baseImg.naturalWidth || !baseImg.naturalHeight) return baseImg;

  const sx = Math.round(cx * baseImg.naturalWidth);
  const sy = Math.round(cy * baseImg.naturalHeight);
  const sw = Math.max(1, Math.round(cw * baseImg.naturalWidth));
  const sh = Math.max(1, Math.round(ch * baseImg.naturalHeight));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = sw;
  outCanvas.height = sh;
  const ctx = outCanvas.getContext('2d');
  if (!ctx) return baseImg;

  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
  ctx.drawImage(baseImg, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.filter = 'none';

  try {
    const url = outCanvas.toDataURL('image/png');
    if (processedCache.size > 50) {
      const first = processedCache.keys().next().value;
      if (first) processedCache.delete(first);
    }
    processedCache.set(pKey, url);
    return loadRawImageElement(url);
  } catch {
    return baseImg;
  }
}
