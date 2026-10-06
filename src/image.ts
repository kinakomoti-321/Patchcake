export interface Rect { x: number; y: number; width: number; height: number }
export interface SourceImage { id: string; name: string; image: HTMLImageElement; url: string; width: number; height: number; x: number; y: number }

export const MAX_SIDE = 16384;
export const MAX_PIXELS = 32 * 1024 * 1024;

export function validateCrop(crop: Rect): void {
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger)) throw new Error('Crop coordinates and dimensions must use whole pixels.');
  if (crop.width < 1 || crop.height < 1) throw new Error('Width and height must be at least 1 px.');
  if (crop.width > MAX_SIDE || crop.height > MAX_SIDE || crop.width * crop.height > MAX_PIXELS) throw new Error('Crop is too large. Each side must be at most 16,384 px, with at most 33,554,432 pixels in total.');
}

export function patchName(name: string): string {
  return `${name.replace(/\.[^.]+$/, '') || 'image'}_patch.png`;
}

export function uniquePatchNames(images: Pick<SourceImage, 'name'>[]): string[] {
  const used = new Set<string>();
  return images.map(({ name }) => {
    const base = patchName(name).replace(/[\\/]/g, '_');
    let candidate = base;
    let index = 2;
    while (used.has(candidate.toLowerCase())) candidate = base.replace(/\.png$/, `_${index++}.png`);
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function renderPatch(source: SourceImage, crop: Rect): HTMLCanvasElement {
  validateCrop(crop);
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the image. Try a smaller crop.');
  // The canvas starts as transparent black. Clip the unscaled source to the common world rectangle.
  ctx.drawImage(source.image, source.x - crop.x, source.y - crop.y);
  return canvas;
}

export function renderCombinedPatch(images: SourceImage[], crop: Rect): HTMLCanvasElement {
  if (!images.length) throw new Error('Add images before exporting.');
  validateCrop(crop);
  const width = crop.width * images.length;
  try { validateCrop({ x: 0, y: 0, width, height: crop.height }); }
  catch { throw new Error('Combined PNG is too large. Reduce the crop size or image count. Each side must be at most 16,384 px, with at most 33,554,432 pixels in total.'); }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the combined PNG. Try a smaller crop.');
  for (const [index, source] of images.entries()) {
    const left = index * crop.width;
    // Clip each source to its own slot so pixels cannot spill into neighboring crops.
    ctx.save(); ctx.beginPath(); ctx.rect(left, 0, crop.width, crop.height); ctx.clip();
    ctx.drawImage(source.image, left + source.x - crop.x, source.y - crop.y);
    ctx.restore();
  }
  return canvas;
}

export function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create PNG. Try a smaller crop.')), 'image/png'));
}

export async function loadImage(file: File): Promise<SourceImage> {
  if (!(file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name))) throw new Error(`${file.name}: Please select an image file.`);
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('empty image');
    return { id: crypto.randomUUID(), name: file.name, image, url, width: image.naturalWidth, height: image.naturalHeight, x: 0, y: 0 };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`${file.name}: Unsupported image format or damaged file.`);
  }
}
