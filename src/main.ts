import './style.css';
import { loadImage, renderPatch, renderCombinedPatch, pngBlob, uniquePatchNames, validateCrop, type Rect, type SourceImage } from './image';

const icons: Record<string, string> = {
  crop: '<path d="M6 3v15h15M3 6h15v15"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  move: '<path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  minus: '<path d="M5 12h14"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ''}</svg>`;
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main class="editor-layout">
    <section class="work-column" aria-label="Image editor">
      <div class="workspace-toolbar">
        <div class="tool-group" role="group" aria-label="Editing tools">
          <button class="tool active" data-tool="crop" aria-pressed="true" title="Select crop (R)">${icon('crop')}<span>Crop</span></button>
          <button class="tool" data-tool="image" aria-pressed="false" title="Move active image (V)">${icon('move')}<span>Move image</span></button>
        </div>
        <div class="zoom-controls"><button class="icon-button" id="zoom-out" aria-label="Zoom out">${icon('minus')}</button><select id="zoom" aria-label="Zoom"><option value="0.1">10%</option><option value="0.25">25%</option><option value="0.5">50%</option><option value="1">100%</option><option value="2">200%</option><option value="4">400%</option><option value="8">800%</option></select><button class="icon-button" id="zoom-in" aria-label="Zoom in">${icon('plus')}</button><button class="icon-button fit-button" id="fit" title="Fit image and crop" aria-label="Fit to view">${icon('fit')}</button></div>
      </div>
      <div class="canvas-wrap" id="canvas-wrap">
        <canvas id="editor" tabindex="0" aria-label="Image editor. Drag to select a crop. Middle-button drag pans the view. Numeric crop controls are below."></canvas>
        <div class="empty-state" id="empty-state">
          <p>Drop images here</p><button class="button" id="add-empty">${icon('plus')}Add images</button>
        </div>
        <div class="drop-overlay" id="drop-overlay">Drop images to add</div>
        <div class="canvas-tag" id="canvas-tag" hidden><span id="canvas-name"></span></div>
      </div>
      <div class="workspace-status"><span id="tool-hint">Add images to start.</span><span id="cursor-position">px</span></div>
    </section>
    <aside class="sidebar" aria-label="Images and position">
      <section class="sources-section"><div class="section-heading"><h2>Images <span class="count" id="source-count">0</span></h2><button class="button" id="add-sidebar">${icon('plus')}Add</button></div><div id="source-list" class="source-list"><div class="source-empty">No images</div></div></section>
      <section class="position-settings"><div class="section-heading"><h2>Image position</h2><button class="text-button" id="reset-position" disabled title="Reset active image to (0, 0)">Reset</button></div><div class="field-grid"><label>X<input type="number" id="image-x" value="0" step="1" disabled></label><label>Y<input type="number" id="image-y" value="0" step="1" disabled></label></div></section>
    </aside>
    <section class="crop-settings" aria-label="Shared crop region">
      <div class="crop-label"><h2>Crop region</h2><span>All images · px</span></div>
      <div class="field-grid crop-fields"><label>X<input type="number" id="crop-x" value="0" step="1" disabled></label><label>Y<input type="number" id="crop-y" value="0" step="1" disabled></label><label>Width<input type="number" id="crop-width" value="256" min="1" max="16384" step="1" disabled></label><label>Height<input type="number" id="crop-height" value="256" min="1" max="16384" step="1" disabled></label></div>
      <div class="export-actions"><button class="button" id="export-single" disabled title="Save crop from the active image">${icon('download')}Save active</button><button class="button primary" id="export-all" disabled title="Save all crops and a combined PNG in ZIP">Save all</button></div>
    </section>
  </main>
  <input type="file" id="file-input" accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.svg" multiple hidden>
  <div id="notifications" class="notifications" role="status" aria-live="polite" aria-atomic="true"></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('editor');
const ctx = canvas.getContext('2d')!;
const checkerTile = document.createElement('canvas');
checkerTile.width = checkerTile.height = 16;
const checkerContext = checkerTile.getContext('2d')!;
checkerContext.fillStyle = '#24272d'; checkerContext.fillRect(0, 0, 16, 16);
checkerContext.fillStyle = '#1b1e23'; checkerContext.fillRect(0, 0, 8, 8); checkerContext.fillRect(8, 8, 8, 8);
const checkerPattern = ctx.createPattern(checkerTile, 'repeat')!;
const wrap = $('canvas-wrap');
const fileInput = $<HTMLInputElement>('file-input');
const state = { images: [] as SourceImage[], activeId: '', crop: { x: 0, y: 0, width: 256, height: 256 } as Rect, tool: 'crop', zoom: 1, ox: 64, oy: 64, busy: false };
const active = () => state.images.find(image => image.id === state.activeId);
let frame = 0;
let notifyTimer = 0;
let importQueue = Promise.resolve();

interface EditSnapshot { images: SourceImage[]; activeId: string; crop: Rect }
const undoStack: EditSnapshot[] = [];
const redoStack: EditSnapshot[] = [];
const imageUrls = new Set<string>();
const historyLimit = 100;
function snapshot(): EditSnapshot {
  return { images: state.images.map(image => ({ ...image })), activeId: state.activeId, crop: { ...state.crop } };
}
function releaseUnusedImages() {
  const retained = new Set([state, ...undoStack, ...redoStack].flatMap(entry => entry.images.map(image => image.url)));
  for (const url of imageUrls) if (!retained.has(url)) { URL.revokeObjectURL(url); imageUrls.delete(url); }
}
function recordEdit(before: EditSnapshot) {
  // Selection and viewport navigation do not create edits or discard redo.
  const unchanged = (Object.keys(state.crop) as (keyof Rect)[]).every(key => state.crop[key] === before.crop[key]) &&
    state.images.length === before.images.length && state.images.every((image, index) => {
      const previous = before.images[index];
      return image.id === previous.id && image.x === previous.x && image.y === previous.y;
    });
  if (unchanged) return;
  undoStack.push(before);
  if (undoStack.length > historyLimit) undoStack.shift();
  redoStack.length = 0;
  releaseUnusedImages();
}
function edit(change: () => void) {
  finishGesture(true); finishListDrag(true);
  const before = snapshot(); change(); recordEdit(before);
}
function restoreSnapshot(entry: EditSnapshot) {
  state.images = entry.images.map(image => ({ ...image }));
  state.activeId = entry.activeId; state.crop = { ...entry.crop };
  renderSources(); synchronize();
}
function travelHistory(redo: boolean) {
  if (gesture || listDrag) { finishGesture(true); finishListDrag(true); return; }
  const source = redo ? redoStack : undoStack, destination = redo ? undoStack : redoStack;
  const entry = source.pop();
  if (!entry) return;
  destination.push(snapshot()); restoreSnapshot(entry); releaseUnusedImages();
}

function notify(message: string, error = false) {
  const toast = $('notifications');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.add('visible');
  clearTimeout(notifyTimer);
  notifyTimer = window.setTimeout(() => toast.classList.remove('visible'), error ? 9000 : 4000);
}

function setTool(tool: string) {
  state.tool = tool;
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => {
    const selected = button.dataset.tool === tool;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  updateHint();
  canvas.style.cursor = tool === 'crop' ? 'crosshair' : 'move';
}

function updateHint() {
  $('tool-hint').textContent = !state.images.length ? 'Add images to start.' : state.tool === 'crop' ? 'Drag to select or move · Handles to resize · Shift to redraw · Middle drag to pan' : 'Drag to move image · Arrow keys: 1 px · Middle drag to pan';
}

function synchronize() {
  const image = active();
  $('empty-state').hidden = state.images.length > 0;
  $('canvas-tag').hidden = !image;
  $('canvas-name').textContent = image?.name ?? '';
  $('source-count').textContent = String(state.images.length);
  $<HTMLButtonElement>('export-all').disabled = !state.images.length || state.busy;
  $<HTMLButtonElement>('export-single').disabled = !image || state.busy;
  $<HTMLButtonElement>('reset-position').disabled = !image;
  for (const [id, value] of Object.entries({ 'image-x': image?.x ?? 0, 'image-y': image?.y ?? 0, 'crop-x': state.crop.x, 'crop-y': state.crop.y, 'crop-width': state.crop.width, 'crop-height': state.crop.height })) {
    const input = $<HTMLInputElement>(id);
    input.disabled = !image;
    if (document.activeElement !== input) input.value = String(value);
  }
  updateHint();
  scheduleDraw();
}

function renderSources() {
  const list = $('source-list');
  const scrollTop = list.scrollTop;
  list.replaceChildren();
  if (!state.images.length) {
    const empty = document.createElement('div');
    empty.className = 'source-empty'; empty.textContent = 'No images'; list.append(empty);
  }
  for (const [index, image] of state.images.entries()) {
    const row = document.createElement('div');
    row.className = `source-row${image.id === state.activeId ? ' selected' : ''}`;
    row.dataset.imageId = image.id;
    const reorder = document.createElement('button');
    reorder.className = 'icon-button reorder-image'; reorder.innerHTML = icon('grip');
    reorder.setAttribute('aria-label', `Reorder ${image.name}`);
    reorder.title = 'Drag to reorder. Arrow keys move up or down.';
    setupReorderHandle(reorder, image.id);
    const select = document.createElement('button');
    select.className = 'source-select';
    select.setAttribute('aria-pressed', String(image.id === state.activeId));
    select.setAttribute('aria-label', `Select ${image.name}`);
    const thumbnail = new Image(); thumbnail.src = image.url; thumbnail.alt = ''; thumbnail.className = 'source-thumb'; thumbnail.draggable = false;
    const details = document.createElement('span'); details.className = 'source-details';
    const name = document.createElement('strong'); name.textContent = image.name; name.title = image.name;
    const size = document.createElement('span'); size.textContent = `${image.width} × ${image.height} px`;
    details.append(name, size);
    const indicator = document.createElement('span'); indicator.className = 'source-indicator'; indicator.textContent = String(index + 1).padStart(2, '0');
    select.append(thumbnail, details, indicator);
    select.onclick = () => { state.activeId = image.id; renderSources(); synchronize(); };
    const remove = document.createElement('button'); remove.className = 'icon-button remove-image'; remove.innerHTML = icon('trash'); remove.setAttribute('aria-label', `Remove ${image.name}`);
    remove.onclick = () => {
      edit(() => {
        const index = state.images.findIndex(source => source.id === image.id);
        state.images.splice(index, 1);
        if (image.id === state.activeId) state.activeId = state.images[Math.min(index, state.images.length - 1)]?.id ?? '';
      });
      renderSources(); synchronize();
    };
    row.append(reorder, select, remove); list.append(row);
  }
  list.scrollTop = scrollTop;
}

interface ListDrag { pointerId: number; imageId: string; handle: HTMLButtonElement; startX: number; startY: number; x: number; y: number; dragging: boolean; slot?: number }
let listDrag: ListDrag | undefined;
let listScrollFrame = 0;

function moveImageInList(imageId: string, destination: number) {
  const from = state.images.findIndex(image => image.id === imageId);
  const to = Math.max(0, Math.min(state.images.length - 1, destination));
  if (from < 0 || from === to) return;
  const image = state.images[from];
  edit(() => { state.images.splice(from, 1); state.images.splice(to, 0, image); });
  renderSources(); synchronize();
  const handle = $('source-list').querySelector<HTMLButtonElement>(`[data-image-id="${imageId}"] .reorder-image`);
  handle?.focus({ preventScroll: true }); handle?.scrollIntoView({ block: 'nearest' });
  notify(`Moved ${image.name} to position ${to + 1}.`);
}

function updateReorderTarget() {
  if (!listDrag?.dragging) return;
  const list = $('source-list'), bounds = list.getBoundingClientRect();
  const rows = Array.from(list.querySelectorAll<HTMLElement>('.source-row'));
  rows.forEach(row => row.classList.remove('drop-before', 'drop-after'));
  if (listDrag.x < bounds.left || listDrag.x > bounds.right || listDrag.y < bounds.top || listDrag.y > bounds.bottom) { listDrag.slot = undefined; return; }
  const before = rows.findIndex(row => { const box = row.getBoundingClientRect(); return listDrag!.y < box.top + box.height / 2; });
  listDrag.slot = before < 0 ? rows.length : before;
  if (before < 0) rows.at(-1)?.classList.add('drop-after');
  else rows[before].classList.add('drop-before');
}

function scrollReorderList() {
  listScrollFrame = 0;
  if (!listDrag?.dragging) return;
  const list = $('source-list'), bounds = list.getBoundingClientRect();
  if (listDrag.x >= bounds.left && listDrag.x <= bounds.right && listDrag.y >= bounds.top && listDrag.y <= bounds.bottom) {
    const topDistance = listDrag.y - bounds.top, bottomDistance = bounds.bottom - listDrag.y;
    if (topDistance < 32) list.scrollTop -= (32 - topDistance) / 4;
    else if (bottomDistance < 32) list.scrollTop += (32 - bottomDistance) / 4;
    updateReorderTarget();
  }
  listScrollFrame = requestAnimationFrame(scrollReorderList);
}

function finishListDrag(cancel = false) {
  if (!listDrag) return;
  const drag = listDrag; listDrag = undefined;
  cancelAnimationFrame(listScrollFrame); listScrollFrame = 0;
  const list = $('source-list'); list.classList.remove('reordering');
  list.querySelectorAll('.source-row').forEach(row => row.classList.remove('dragging', 'drop-before', 'drop-after'));
  if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  if (!cancel && drag.dragging && drag.slot !== undefined) {
    const from = state.images.findIndex(image => image.id === drag.imageId);
    moveImageInList(drag.imageId, drag.slot > from ? drag.slot - 1 : drag.slot);
  }
}

function setupReorderHandle(handle: HTMLButtonElement, imageId: string) {
  handle.onpointerdown = event => {
    if (event.button !== 0 || listDrag) return;
    event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
    listDrag = { pointerId: event.pointerId, imageId, handle, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, dragging: false };
  };
  handle.onpointermove = event => {
    if (!listDrag || listDrag.pointerId !== event.pointerId) return;
    listDrag.x = event.clientX; listDrag.y = event.clientY;
    if (!listDrag.dragging && Math.hypot(event.clientX - listDrag.startX, event.clientY - listDrag.startY) >= 4) {
      listDrag.dragging = true; $('source-list').classList.add('reordering');
      handle.closest('.source-row')?.classList.add('dragging');
      listScrollFrame = requestAnimationFrame(scrollReorderList);
    }
    updateReorderTarget();
  };
  handle.onpointerup = event => { if (listDrag?.pointerId === event.pointerId && listDrag.handle === handle) finishListDrag(); };
  handle.onpointercancel = handle.onlostpointercapture = event => { if (listDrag?.pointerId === event.pointerId && listDrag.handle === handle) finishListDrag(true); };
  handle.onkeydown = event => {
    if (event.key === 'Escape') { finishListDrag(true); return; }
    if (listDrag || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = state.images.findIndex(image => image.id === imageId);
    const destination = event.key === 'Home' ? 0 : event.key === 'End' ? state.images.length - 1 : index + (event.key === 'ArrowUp' ? -1 : 1);
    moveImageInList(imageId, destination);
  };
}

async function importFiles(files: File[]) {
  const loaded: SourceImage[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      loaded.push(await loadImage(file));
    } catch (error) { errors.push(error instanceof Error ? error.message : 'Could not load the image.'); }
  }
  if (loaded.length) {
    edit(() => {
      const wasEmpty = !state.images.length;
      loaded.forEach(image => imageUrls.add(image.url));
      state.images.push(...loaded);
      if (!state.activeId) state.activeId = loaded[0].id;
      if (wasEmpty) {
        const first = active()!;
        state.crop = { x: 0, y: 0, width: Math.min(256, first.width), height: Math.min(256, first.height) };
        fitView();
      }
    });
  }
  renderSources(); synchronize();
  if (errors.length) notify(errors.join('\n'), true);
  else if (loaded.length) notify(`Added ${loaded.length} image${loaded.length === 1 ? '' : 's'}.`);
}

function enqueueImport(files: File[]) {
  importQueue = importQueue.then(() => importFiles(files)).catch(error => notify(error instanceof Error ? error.message : 'Could not load images.', true));
}

for (const id of ['add-empty', 'add-sidebar']) $(id).onclick = () => fileInput.click();
fileInput.onchange = () => { enqueueImport(Array.from(fileInput.files ?? [])); fileInput.value = ''; };
let dragDepth = 0;
document.addEventListener('dragenter', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); dragDepth++; $('drop-overlay').classList.add('visible');
});
document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop-overlay').classList.remove('visible'); });
document.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; $('drop-overlay').classList.remove('visible');
  enqueueImport(Array.from(event.dataTransfer?.files ?? []));
});
window.addEventListener('blur', () => { dragDepth = 0; $('drop-overlay').classList.remove('visible'); finishListDrag(true); finishGesture(true); });

for (const axis of ['x', 'y'] as const) $<HTMLInputElement>(`image-${axis}`).onchange = event => {
  const input = event.target as HTMLInputElement, value = input.valueAsNumber;
  if (Number.isSafeInteger(value)) { edit(() => { const image = active(); if (image) image[axis] = value; }); }
  else notify('Image position must use whole pixels.', true);
  input.value = String(active()?.[axis] ?? 0); synchronize();
};
for (const key of ['x', 'y', 'width', 'height'] as const) $<HTMLInputElement>(`crop-${key}`).onchange = event => {
  const input = event.target as HTMLInputElement, candidate = { ...state.crop, [key]: input.valueAsNumber };
  try { validateCrop(candidate); edit(() => { state.crop = candidate; }); } catch (error) { notify((error as Error).message, true); }
  input.value = String(state.crop[key]); synchronize();
};
$('reset-position').onclick = () => { edit(() => { const image = active(); if (image) image.x = image.y = 0; }); synchronize(); };
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.onclick = () => setTool(button.dataset.tool!));

function scheduleDraw() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); }
let previousWidth = 0;
let previousHeight = 0;
function resize() {
  if (previousWidth && previousHeight) {
    state.ox += (wrap.clientWidth - previousWidth) / 2;
    state.oy += (wrap.clientHeight - previousHeight) / 2;
  }
  previousWidth = wrap.clientWidth; previousHeight = wrap.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(wrap.clientWidth * dpr); canvas.height = Math.round(wrap.clientHeight * dpr); scheduleDraw();
}
new ResizeObserver(resize).observe(wrap);

function handles(rect: Rect): { x: number; y: number; name: string }[] {
  const x = rect.x, y = rect.y, right = x + rect.width, bottom = y + rect.height, mx = (x + right) / 2, my = (y + bottom) / 2;
  return [{ x, y, name: 'nw' }, { x: mx, y, name: 'n' }, { x: right, y, name: 'ne' }, { x: right, y: my, name: 'e' }, { x: right, y: bottom, name: 'se' }, { x: mx, y: bottom, name: 's' }, { x, y: bottom, name: 'sw' }, { x, y: my, name: 'w' }];
}

function draw() {
  const dpr = window.devicePixelRatio || 1, width = canvas.width / dpr, height = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  const image = active(); if (!image) return;
  ctx.save(); ctx.translate(state.ox, state.oy); ctx.scale(state.zoom, state.zoom);
  ctx.fillStyle = checkerPattern; ctx.fillRect(image.x, image.y, image.width, image.height);
  ctx.drawImage(image.image, image.x, image.y);
  ctx.strokeStyle = '#4b5260'; ctx.lineWidth = 1 / state.zoom; ctx.strokeRect(image.x, image.y, image.width, image.height);
  // World origin remains fixed as source images are aligned independently.
  ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1 / state.zoom; ctx.beginPath(); ctx.moveTo(-8 / state.zoom, 0); ctx.lineTo(8 / state.zoom, 0); ctx.moveTo(0, -8 / state.zoom); ctx.lineTo(0, 8 / state.zoom); ctx.stroke();
  const crop = state.crop;
  ctx.fillStyle = 'rgba(37, 99, 235, 0.16)'; ctx.fillRect(crop.x, crop.y, crop.width, crop.height);
  ctx.strokeStyle = '#79a7ff'; ctx.lineWidth = 1.5 / state.zoom; ctx.strokeRect(crop.x, crop.y, crop.width, crop.height);
  for (const handle of handles(crop)) {
    const size = 7 / state.zoom;
    ctx.fillStyle = '#191b20'; ctx.fillRect(handle.x - size / 2, handle.y - size / 2, size, size);
    ctx.strokeStyle = '#79a7ff'; ctx.lineWidth = 1.5 / state.zoom; ctx.strokeRect(handle.x - size / 2, handle.y - size / 2, size, size);
  }
  ctx.restore();
  const label = `${crop.width} × ${crop.height}`;
  ctx.font = '12px ui-monospace, monospace';
  const tw = ctx.measureText(label).width + 16;
  const lx = Math.min(width - tw - 8, Math.max(8, crop.x * state.zoom + state.ox));
  const ly = Math.min(height - 30, Math.max(40, crop.y * state.zoom + state.oy - 30));
  ctx.fillStyle = '#222c3e'; ctx.fillRect(lx, ly, tw, 24); ctx.fillStyle = '#b4ceff'; ctx.fillText(label, lx + 8, ly + 16);
}

function zoomAt(zoom: number, x = wrap.clientWidth / 2, y = wrap.clientHeight / 2) {
  const clamped = Math.max(.02, Math.min(16, zoom));
  const ratio = clamped / state.zoom;
  state.ox = x - (x - state.ox) * ratio; state.oy = y - (y - state.oy) * ratio; state.zoom = clamped;
  synchronizeZoom(); scheduleDraw();
}
function synchronizeZoom() {
  const select = $<HTMLSelectElement>('zoom');
  select.querySelector('[data-custom]')?.remove();
  if (!Array.from(select.options).some(option => Number(option.value) === state.zoom)) {
    const option = new Option(`${Math.round(state.zoom * 100)}%`, String(state.zoom)); option.dataset.custom = 'true'; select.add(option);
  }
  select.value = String(state.zoom);
}
function fitView() {
  const image = active(); if (!image) return;
  const crop = state.crop;
  const left = Math.min(0, image.x, crop.x), top = Math.min(0, image.y, crop.y);
  const right = Math.max(image.x + image.width, crop.x + crop.width), bottom = Math.max(image.y + image.height, crop.y + crop.height);
  state.zoom = Math.max(.02, Math.min(2, (wrap.clientWidth - 96) / Math.max(1, right - left), (wrap.clientHeight - 96) / Math.max(1, bottom - top)));
  state.ox = (wrap.clientWidth - (right - left) * state.zoom) / 2 - left * state.zoom;
  state.oy = (wrap.clientHeight - (bottom - top) * state.zoom) / 2 - top * state.zoom;
  synchronizeZoom(); scheduleDraw();
}
$('fit').onclick = fitView;
$('zoom-in').onclick = () => zoomAt(state.zoom * 1.25);
$('zoom-out').onclick = () => zoomAt(state.zoom / 1.25);
$<HTMLSelectElement>('zoom').onchange = event => zoomAt(Number((event.target as HTMLSelectElement).value));
canvas.addEventListener('wheel', event => { if (!state.images.length) return; event.preventDefault(); if (gesture) return; const bounds = canvas.getBoundingClientRect(); zoomAt(state.zoom * Math.exp(-event.deltaY * .0015), event.clientX - bounds.left, event.clientY - bounds.top); }, { passive: false });

interface Gesture { pointerId: number; kind: string; handle?: string; sx: number; sy: number; rect: Rect; ix: number; iy: number; ox: number; oy: number; imageId: string; before: EditSnapshot }
let gesture: Gesture | undefined;
function pointerPosition(event: PointerEvent) {
  const bounds = canvas.getBoundingClientRect();
  return { sx: event.clientX - bounds.left, sy: event.clientY - bounds.top, x: (event.clientX - bounds.left - state.ox) / state.zoom, y: (event.clientY - bounds.top - state.oy) / state.zoom };
}
function hitHandle(x: number, y: number) { return handles(state.crop).find(handle => Math.abs(x - handle.x) * state.zoom <= 9 && Math.abs(y - handle.y) * state.zoom <= 9); }
function insideCrop(x: number, y: number) { const rect = state.crop; return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height; }
canvas.onpointerdown = event => {
  if (gesture || !active() || (event.button !== 0 && event.button !== 1)) return;
  event.preventDefault(); canvas.focus();
  const pos = pointerPosition(event), image = active()!;
  let kind = event.button === 1 ? 'pan' : state.tool, handle: string | undefined;
  if (kind === 'crop') {
    handle = event.shiftKey ? undefined : hitHandle(pos.x, pos.y)?.name;
    kind = handle ? 'resize' : !event.shiftKey && insideCrop(pos.x, pos.y) ? 'crop-move' : 'draw';
  }
  gesture = { pointerId: event.pointerId, kind, handle, sx: pos.sx, sy: pos.sy, rect: { ...state.crop }, ix: image.x, iy: image.y, ox: state.ox, oy: state.oy, imageId: image.id, before: snapshot() };
  if (kind === 'draw') { state.crop = { x: Math.round(pos.x), y: Math.round(pos.y), width: 1, height: 1 }; synchronize(); }
  if (kind === 'pan') canvas.style.cursor = 'grabbing';
  canvas.setPointerCapture(event.pointerId);
};
canvas.onpointermove = event => {
  const pos = pointerPosition(event);
  $('cursor-position').textContent = `X ${Math.round(pos.x)}  Y ${Math.round(pos.y)} px`;
  if (!gesture) {
    const handle = state.tool === 'crop' ? hitHandle(pos.x, pos.y)?.name : undefined;
    canvas.style.cursor = state.tool === 'image' ? 'move' : handle ? ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' } as Record<string, string>)[handle] : insideCrop(pos.x, pos.y) ? 'move' : 'crosshair';
    return;
  }
  if (event.pointerId !== gesture.pointerId) return;
  if (gesture.kind === 'pan') {
    state.ox = gesture.ox + pos.sx - gesture.sx; state.oy = gesture.oy + pos.sy - gesture.sy;
    scheduleDraw(); return;
  }
  const dx = Math.round((pos.sx - gesture.sx) / state.zoom), dy = Math.round((pos.sy - gesture.sy) / state.zoom), rect = gesture.rect;
  if (gesture.kind === 'image') {
    const image = state.images.find(image => image.id === gesture!.imageId);
    if (image) { image.x = gesture.ix + dx; image.y = gesture.iy + dy; }
  } else {
    let candidate: Rect;
    if (gesture.kind === 'crop-move') candidate = { ...rect, x: rect.x + dx, y: rect.y + dy };
    else if (gesture.kind === 'draw') {
      const x = Math.round((gesture.sx - state.ox) / state.zoom), y = Math.round((gesture.sy - state.oy) / state.zoom), endX = Math.round(pos.x), endY = Math.round(pos.y);
      candidate = { x: Math.min(x, endX), y: Math.min(y, endY), width: Math.max(1, Math.abs(endX - x)), height: Math.max(1, Math.abs(endY - y)) };
    } else {
      let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
      if (gesture.handle?.includes('w')) left += dx;
      if (gesture.handle?.includes('e')) right += dx;
      if (gesture.handle?.includes('n')) top += dy;
      if (gesture.handle?.includes('s')) bottom += dy;
      candidate = { x: Math.min(left, right), y: Math.min(top, bottom), width: Math.max(1, Math.abs(right - left)), height: Math.max(1, Math.abs(bottom - top)) };
    }
    try { validateCrop(candidate); state.crop = candidate; } catch { return; }
  }
  synchronize();
};
function finishGesture(cancel = false) {
  if (!gesture) return;
  const drag = gesture; gesture = undefined;
  if (cancel) {
    state.crop = drag.rect; state.ox = drag.ox; state.oy = drag.oy;
    const image = state.images.find(image => image.id === drag.imageId);
    if (image) { image.x = drag.ix; image.y = drag.iy; }
  } else if (drag.kind !== 'pan') recordEdit(drag.before);
  if (canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
  canvas.style.cursor = state.tool === 'crop' ? 'crosshair' : 'move'; synchronize();
}
canvas.onpointerup = event => { if (gesture?.pointerId === event.pointerId) finishGesture(); };
canvas.onpointercancel = event => { if (gesture?.pointerId === event.pointerId) finishGesture(true); };
canvas.onlostpointercapture = () => finishGesture(true);
canvas.onauxclick = event => { if (event.button === 1) event.preventDefault(); };
document.addEventListener('keydown', event => {
  const element = event.target as HTMLElement;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y') && !element.closest('input,select,textarea,[contenteditable]')) {
    event.preventDefault(); travelHistory(key === 'y' || event.shiftKey); return;
  }
  if (event.key === 'Escape' && (gesture || listDrag)) { event.preventDefault(); finishGesture(true); finishListDrag(true); return; }
  if ((event.target as HTMLElement).closest('input,select,textarea,button,a,[contenteditable]') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.toLowerCase() === 'r') setTool('crop');
  if (event.key.toLowerCase() === 'v') setTool('image');
  if (document.activeElement !== canvas || !active() || !event.key.startsWith('Arrow')) return;
  event.preventDefault(); const step = event.shiftKey ? 10 : 1;
  edit(() => {
    const target = state.tool === 'image' ? active()! : state.crop;
    if (event.key === 'ArrowLeft') target.x -= step;
    if (event.key === 'ArrowRight') target.x += step;
    if (event.key === 'ArrowUp') target.y -= step;
    if (event.key === 'ArrowDown') target.y += step;
  });
  synchronize();
});

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  // Allow the browser to start consuming the URL before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exportSingle(source: SourceImage, name: string) {
  if (state.busy) return;
  state.busy = true; synchronize();
  try { downloadBlob(await pngBlob(renderPatch({ ...source }, { ...state.crop })), name); notify(`Saved ${name}.`); }
  catch (error) { notify(error instanceof Error ? error.message : 'Could not save PNG.', true); }
  finally { state.busy = false; synchronize(); }
}
async function exportAll() {
  if (state.busy || !state.images.length) return;
  const images = state.images.map(image => ({ ...image })), crop = { ...state.crop }, names = uniquePatchNames(images);
  state.busy = true; synchronize();
  const button = $('export-all'); button.textContent = 'Exporting…';
  try {
    const combined = renderCombinedPatch(images, crop);
    let combinedBlob: Blob;
    try { combinedBlob = await pngBlob(combined); }
    finally { combined.width = combined.height = 1; }
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const [index, image] of images.entries()) {
      const output = renderPatch(image, crop);
      const blob = await pngBlob(output);
      zip.file(names[index], await blob.arrayBuffer());
      output.width = output.height = 1;
    }
    zip.file('patchcake_combined.png', await combinedBlob.arrayBuffer());
    downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), 'patchcake_patches.zip');
    notify(`Saved ${images.length} crops and a combined PNG in ZIP.`);
  } catch (error) { notify(error instanceof Error ? error.message : 'Could not export images.', true); }
  finally { state.busy = false; button.textContent = 'Save all'; synchronize(); }
}
$('export-all').onclick = () => void exportAll();
$('export-single').onclick = () => {
  const image = active();
  if (image) void exportSingle(image, uniquePatchNames(state.images)[state.images.indexOf(image)]);
};

// Optional browser-agent API: the same selection state used by the visible controls.
type ModelTool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown };
const modelContext = (document as Document & { modelContext?: { registerTool: (tool: ModelTool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
if (modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tools: ModelTool[] = [
    { name: 'read_patchcake_state', description: 'Read loaded images, their pixel positions, the active image and the common crop rectangle.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => ({ images: state.images.map(({ id, name, width, height, x, y }) => ({ id, name, width, height, x, y })), activeId: state.activeId, crop: { ...state.crop } }) },
    { name: 'set_patchcake_crop', description: 'Set the shared crop rectangle in integer world pixels and update the editor and numeric controls.', inputSchema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 } }, required: ['x', 'y', 'width', 'height'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: input => {
      if (!state.images.length) throw new Error('Load images first.');
      if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['x', 'y', 'width', 'height'].includes(key))) throw new Error('Invalid crop.');
      const value = input as Rect; const crop = { x: value.x, y: value.y, width: value.width, height: value.height }; validateCrop(crop); edit(() => { state.crop = crop; }); synchronize(); return { crop: { ...state.crop } };
    } },
  ];
  for (const tool of tools) { try { void Promise.resolve(modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Unsupported registries must not interrupt image editing. */ } }
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}

setTool('crop'); synchronizeZoom(); synchronize(); resize();
