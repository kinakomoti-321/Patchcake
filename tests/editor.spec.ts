import { test, expect, type Page, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

async function fixture(page: Page, name: string, width: number, height: number, color: string) {
  const base64 = await page.evaluate(({ width, height, color }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { width, height, color });
  return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

async function number(page: Page, id: string, value: number) {
  await page.locator(`#${id}`).fill(String(value));
  await page.locator(`#${id}`).press('Tab');
}

async function decoded(page: Page, bytes: Uint8Array) {
  return page.evaluate(async data => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'image/png' }));
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
    const pixels = Array.from(ctx.getImageData(0, 0, image.width, image.height).data);
    URL.revokeObjectURL(url);
    return { width: image.width, height: image.height, pixels };
  }, Array.from(bytes));
}
async function downloadBytes(download: Download) { return readFile((await download.path())!); }

test('undo and redo restore import batches, deletion, positions and list order with usable image pixels', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    await fixture(page, 'red.png', 4, 3, '#ff0000'),
    await fixture(page, 'green.png', 2, 2, '#00ff00'),
  ]);
  await expect(page.locator('.source-row')).toHaveCount(2);
  await page.locator('#editor').press('Control+z');
  await expect(page.locator('.source-row')).toHaveCount(0);
  await expect(page.locator('#export-single')).toBeDisabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.source-row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Select red.png' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Select green.png' }).click();
  await number(page, 'image-x', 1);
  await page.locator('#editor').press('Control+z');
  await expect(page.locator('#image-x')).toHaveValue('0');
  await page.locator('#editor').press('Control+y');
  await expect(page.locator('#image-x')).toHaveValue('1');
  await page.getByRole('button', { name: 'Reorder green.png' }).press('Home');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.source-details strong')).toHaveText(['red.png', 'green.png']);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.source-details strong')).toHaveText(['green.png', 'red.png']);
  await page.getByRole('button', { name: 'Remove green.png' }).click();
  await expect(page.locator('.source-row')).toHaveCount(1);
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.source-details strong')).toHaveText(['green.png', 'red.png']);
  await expect(page.getByRole('button', { name: 'Select green.png' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#image-x')).toHaveValue('1');
  expect(await page.getByRole('button', { name: 'Select green.png' }).locator('img').evaluate(async image => {
    await (image as HTMLImageElement).decode(); return (image as HTMLImageElement).naturalWidth;
  })).toBe(2);
  const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save all', exact: true }).click();
  const zip = await JSZip.loadAsync(await downloadBytes(await wait));
  const png = await decoded(page, await zip.file('patchcake_combined.png')!.async('uint8array'));
  expect([png.width, png.height]).toEqual([8, 3]);
  expect(png.pixels.slice(0, 4)).toEqual([0, 0, 0, 0]);
  expect(png.pixels.slice(4, 8)).toEqual([0, 255, 0, 255]);
  expect(png.pixels.slice(16, 20)).toEqual([255, 0, 0, 255]);
  await page.locator('#editor').press('Meta+Shift+z');
  await expect(page.locator('.source-details strong')).toHaveText(['red.png']);
});

test('a drag is one history step; cancelled drags, navigation and rejected edits preserve redo', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(await fixture(page, 'sample.png', 400, 300, '#123456'));
  await expect(page.locator('.source-row')).toHaveCount(1);
  await page.locator('#zoom').selectOption('1');
  await number(page, 'crop-x', 40); await number(page, 'crop-y', 40);
  await number(page, 'crop-width', 100); await number(page, 'crop-height', 80);
  const rect = (await page.locator('#editor').boundingBox())!;
  const point = { x: rect.x + (rect.width - 400) / 2 + 75, y: rect.y + (rect.height - 300) / 2 + 75 };
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 20, point.y + 15, { steps: 12 }); await page.mouse.up();
  await expect(page.locator('#crop-x')).toHaveValue('60');
  await page.locator('#editor').press('Control+z');
  await expect(page.locator('#crop-x')).toHaveValue('40'); await expect(page.locator('#crop-y')).toHaveValue('40');
  await page.locator('#editor').press('Control+Shift+z');
  await expect(page.locator('#crop-x')).toHaveValue('60'); await expect(page.locator('#crop-y')).toHaveValue('55');
  await page.locator('#editor').press('Control+z');
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 9, point.y + 7, { steps: 3 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await number(page, 'crop-x', 40); // A no-op must not discard redo.
  await number(page, 'crop-width', 0); // A rejected edit must not discard redo.
  await page.mouse.move(point.x, point.y); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(point.x + 10, point.y + 10); await page.mouse.up({ button: 'middle' });
  await page.locator('#zoom').selectOption('0.5');
  await page.locator('#editor').press('Control+y');
  await expect(page.locator('#crop-x')).toHaveValue('60'); await expect(page.locator('#crop-y')).toHaveValue('55');
  await expect(page.locator('#zoom')).toHaveValue('0.5');
  await page.locator('#editor').press('Control+z');
  await number(page, 'crop-x', 41); // A real edit starts a new branch.
  await page.locator('#editor').press('Control+y');
  await expect(page.locator('#crop-x')).toHaveValue('41');
  await page.getByRole('button', { name: 'Move image', exact: true }).click();
  await page.locator('#editor').press('Shift+ArrowRight');
  await expect(page.locator('#image-x')).toHaveValue('10');
  await page.locator('#reset-position').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#image-x')).toHaveValue('10');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#image-x')).toHaveValue('0');
});

test('discarding an import redo branch releases its URL while retained history images remain decodable', async ({ page }) => {
  await page.addInitScript(() => {
    const revoked: string[] = [], revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { revoked.push(url); revoke(url); };
    (window as unknown as { revoked: string[] }).revoked = revoked;
  });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(await fixture(page, 'first.png', 3, 2, '#123456'));
  await expect(page.locator('.source-row')).toHaveCount(1);
  const firstUrl = await page.locator('.source-thumb').getAttribute('src');
  await page.locator('#editor').press('Control+z');
  expect(await page.evaluate(url => (window as unknown as { revoked: string[] }).revoked.includes(url!), firstUrl)).toBe(false);
  await page.locator('#file-input').setInputFiles(await fixture(page, 'second.png', 4, 3, '#abcdef'));
  await expect(page.locator('.source-details strong')).toHaveText(['second.png']);
  expect(await page.evaluate(url => (window as unknown as { revoked: string[] }).revoked.includes(url!), firstUrl)).toBe(true);
  await page.locator('#editor').press('Control+y');
  await expect(page.locator('.source-details strong')).toHaveText(['second.png']);
  await page.locator('#editor').press('Control+z');
  await page.keyboard.press('Control+y');
  expect(await page.locator('.source-thumb').evaluate(async element => {
    const image = element as HTMLImageElement; await image.decode(); return image.naturalWidth;
  })).toBe(4);
});

test('common region exports exact pixels, independent offsets and transparent missing areas', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([await fixture(page, 'red.png', 4, 3, '#ff0000'), await fixture(page, 'green.webp', 2, 2, '#00ff00')]);
  await expect(page.locator('.source-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select green.webp' }).click();
  await expect(page.locator('#image-x')).toHaveValue('0');
  await expect(page.locator('#image-y')).toHaveValue('0');
  await number(page, 'image-x', 1); await number(page, 'image-y', -1);
  await number(page, 'crop-x', -1); await number(page, 'crop-y', -1);
  await number(page, 'crop-width', 6); await number(page, 'crop-height', 5);
  await page.getByRole('button', { name: 'Select red.png' }).click();
  await expect(page.locator('#image-x')).toHaveValue('0');
  await expect(page.locator('#image-y')).toHaveValue('0');
  const wait = page.waitForEvent('download');
  await page.locator('#export-all').click();
  const download = await wait;
  expect(download.suggestedFilename()).toBe('patchcake_patches.zip');
  const zip = await JSZip.loadAsync(await downloadBytes(download));
  expect(Object.keys(zip.files)).toEqual(['red_patch.png', 'green_patch.png', 'patchcake_combined.png']);
  const red = await decoded(page, await zip.file('red_patch.png')!.async('uint8array'));
  const green = await decoded(page, await zip.file('green_patch.png')!.async('uint8array'));
  expect([red.width, red.height, green.width, green.height]).toEqual([6, 5, 6, 5]);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) {
    const i = (y * 6 + x) * 4;
    expect(red.pixels.slice(i, i + 4)).toEqual(x >= 1 && x < 5 && y >= 1 && y < 4 ? [255, 0, 0, 255] : [0, 0, 0, 0]);
    expect(green.pixels.slice(i, i + 4)).toEqual(x >= 2 && x < 4 && y < 2 ? [0, 255, 0, 255] : [0, 0, 0, 0]);
  }
});

test('individual PNG, a completely empty crop, duplicate names and invalid sizes', async ({ page }) => {
  await page.goto('/');
  const source = await fixture(page, '比較.png', 3, 2, '#123456');
  await page.locator('#file-input').setInputFiles([source, source, { ...source, name: '比較.jpg' }]);
  await expect(page.locator('.source-row')).toHaveCount(3);
  await number(page, 'crop-width', 0); await expect(page.locator('#crop-width')).toHaveValue('3');
  await expect(page.locator('#notifications')).toContainText('at least 1 px');
  await number(page, 'crop-width', 16385); await expect(page.locator('#crop-width')).toHaveValue('3');
  await number(page, 'crop-x', 100); await number(page, 'crop-y', 100);
  await expect(page.locator('canvas')).toHaveCount(1);
  const waitSingle = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save active', exact: true }).click();
  const single = await waitSingle;
  expect(single.suggestedFilename()).toBe('比較_patch.png');
  const png = await decoded(page, await downloadBytes(single));
  expect(png.pixels.every(value => value === 0)).toBe(true);
  const waitZip = page.waitForEvent('download'); await page.locator('#export-all').click();
  const zip = await JSZip.loadAsync(await downloadBytes(await waitZip));
  expect(Object.keys(zip.files)).toEqual(['比較_patch.png', '比較_patch_2.png', '比較_patch_3.png', 'patchcake_combined.png']);
});

test('file drop, drag region, resize handles, image movement, keyboard and selection deletion', async ({ page }) => {
  await page.goto('/');
  const file = await fixture(page, 'dropped.png', 400, 300, '#e98d49');
  await page.evaluate(({ name, data }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(data), char => char.charCodeAt(0))], name, { type: 'image/png' }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  }, { name: file.name, data: file.buffer.toString('base64') });
  await expect(page.locator('.source-row')).toHaveCount(1);
  await page.locator('#zoom').selectOption('1');
  await number(page, 'crop-x', 40); await number(page, 'crop-y', 40);
  await number(page, 'crop-width', 100); await number(page, 'crop-height', 80);
  const rect = (await page.locator('#editor').boundingBox())!;
  // At 100%, the image is centered in the editor (400 × 300 source).
  const origin = { x: rect.x + (rect.width - 400) / 2, y: rect.y + (rect.height - 300) / 2 };
  await page.mouse.move(origin.x + 75, origin.y + 75); await page.mouse.down();
  await page.mouse.move(origin.x + 95, origin.y + 90, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('#crop-x')).toHaveValue('60'); await expect(page.locator('#crop-y')).toHaveValue('55');
  await page.mouse.move(origin.x + 160, origin.y + 135); await page.mouse.down();
  await page.mouse.move(origin.x + 180, origin.y + 145, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('#crop-width')).toHaveValue('120'); await expect(page.locator('#crop-height')).toHaveValue('90');
  await page.getByRole('button', { name: 'Move image', exact: true }).click();
  await page.mouse.move(origin.x + 75, origin.y + 75); await page.mouse.down();
  await page.mouse.move(origin.x + 65, origin.y + 80, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('#image-x')).toHaveValue('-10'); await expect(page.locator('#image-y')).toHaveValue('5');
  await page.locator('#editor').press('Shift+ArrowRight'); await expect(page.locator('#image-x')).toHaveValue('0');
  await page.locator('#reset-position').click(); await expect(page.locator('#image-y')).toHaveValue('0');
  await page.getByRole('button', { name: 'Remove dropped.png' }).click();
  await expect(page.locator('#empty-state')).toBeVisible(); await expect(page.locator('#export-all')).toBeDisabled();
});

test('mixed invalid files, active deletion, narrow layout and literal filenames', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    { name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('broken') },
    await fixture(page, '<img onerror=alert(1)>.png', 10, 10, '#fff'),
    await fixture(page, 'second.png', 6, 8, '#000'),
  ]);
  await expect(page.locator('.source-row')).toHaveCount(2);
  await expect(page.locator('#notifications')).toContainText('invalid.png');
  await expect(page.locator('.source-details strong').first()).toHaveText('<img onerror=alert(1)>.png');
  expect(await page.locator('.source-details img').count()).toBe(0);
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  const enlarged = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(enlarged.scroll).toBeLessThanOrEqual(enlarged.client);
  await page.getByRole('button', { name: 'Remove <img onerror=alert(1)>.png' }).click();
  await expect(page.getByRole('button', { name: 'Select second.png' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#image-x')).toHaveValue('0');
  await expect(page.locator('#crop-width')).toHaveValue('10');
});

test('minimal English dark layout puts crop controls below a full-height image list', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('header,h1,.output-section,[data-tool="pan"]')).toHaveCount(0);
  await expect(page.locator('[data-tool]')).toHaveCount(2);
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector('#editor')!.getBoundingClientRect();
    const crop = document.querySelector('.crop-settings')!.getBoundingClientRect();
    const list = document.querySelector('.source-list')!.getBoundingClientRect();
    const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(document.body.innerText);
    return { canvasBottom: canvas.bottom, cropTop: crop.top, listHeight: list.height, scheme: getComputedStyle(document.documentElement).colorScheme, japanese };
  });
  expect(layout.cropTop).toBeGreaterThan(layout.canvasBottom);
  expect(layout.listHeight).toBeGreaterThan(500);
  expect(layout.scheme).toBe('dark');
  expect(layout.japanese).toBe(false);
  await page.locator('#file-input').setInputFiles(await fixture(page, 'sample.png', 100, 100, '#abcdef'));
  await expect(page.locator('.source-indicator')).toHaveText('01');
  await expect(page.locator('.source-indicator svg,#export-combined')).toHaveCount(0);
  await expect(page.locator('.export-actions button')).toHaveText(['Save active', 'Save all']);
  await expect(page.getByRole('button', { name: /^(Undo|Redo)$/ })).toHaveCount(0);
  await page.locator('#editor').press('h');
  await expect(page.getByRole('button', { name: 'Crop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('optional browser tools use visible state and reject invalid mutations', async ({ page }) => {
  await page.addInitScript(() => {
    const registry = new Map();
    Object.defineProperty(document, 'modelContext', { value: { registerTool(tool: { name: string }) { registry.set(tool.name, tool); } } });
    (window as unknown as { registry: Map<string, unknown> }).registry = registry;
  });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(await fixture(page, 'tools.png', 16, 16, '#345678'));
  await expect(page.locator('.source-row')).toHaveCount(1);
  const result = await page.evaluate(() => {
    const registry = (window as unknown as { registry: Map<string, { execute: (input: unknown) => { crop: unknown }; annotations: { readOnlyHint: boolean }; inputSchema: object }> }).registry;
    const tool = registry.get('set_patchcake_crop')!;
    const valid = tool.execute({ x: -2, y: 3, width: 8, height: 9 });
    let invalid = false;
    try { tool.execute({ x: 0, y: 0, width: 0, height: 1 }); } catch { invalid = true; }
    return { names: Array.from(registry.keys()), valid, invalid, state: registry.get('read_patchcake_state')!.execute({}), readOnly: tool.annotations.readOnlyHint, schema: tool.inputSchema };
  });
  expect(result.names).toEqual(['read_patchcake_state', 'set_patchcake_crop']);
  expect(result.invalid).toBe(true); expect(result.readOnly).toBe(false);
  expect(result.state.crop).toEqual({ x: -2, y: 3, width: 8, height: 9 });
  await expect(page.locator('#crop-x')).toHaveValue('-2'); await expect(page.locator('#crop-height')).toHaveValue('9');
});

test('middle-button drag pans only the view and Escape restores the previous view', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(await fixture(page, 'pan.png', 400, 300, '#884422'));
  await expect(page.locator('.source-row')).toHaveCount(1);
  await page.locator('#zoom').selectOption('1');
  await number(page, 'crop-x', 40); await number(page, 'crop-y', 40);
  await number(page, 'crop-width', 100); await number(page, 'crop-height', 80);
  const rect = (await page.locator('#editor').boundingBox())!;
  const point = { x: rect.x + (rect.width - 400) / 2 + 75, y: rect.y + (rect.height - 300) / 2 + 75 };
  await page.mouse.move(point.x, point.y); await expect(page.locator('#cursor-position')).toHaveText('X 75  Y 75 px');
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(point.x + 50, point.y + 30, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#cursor-position')).toHaveText('X 25  Y 45 px');
  await expect(page.locator('#image-x')).toHaveValue('0'); await expect(page.locator('#image-y')).toHaveValue('0');
  await expect(page.locator('#crop-x')).toHaveValue('40'); await expect(page.locator('#crop-y')).toHaveValue('40');
  await expect(page.locator('#crop-width')).toHaveValue('100'); await expect(page.locator('#crop-height')).toHaveValue('80');
  await page.getByRole('button', { name: 'Move image', exact: true }).click();
  await page.mouse.move(point.x, point.y); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(point.x - 20, point.y + 10, { steps: 3 });
  await page.keyboard.press('Escape'); await page.mouse.up({ button: 'middle' });
  await page.mouse.move(point.x + 1, point.y); await page.mouse.move(point.x, point.y);
  await expect(page.locator('#cursor-position')).toHaveText('X 25  Y 45 px');
  await expect(page.locator('#image-x')).toHaveValue('0');
  const wait = page.waitForEvent('download'); await page.locator('#export-single').click();
  const png = await decoded(page, await downloadBytes(await wait));
  expect([png.width, png.height]).toEqual([100, 80]);
  expect(png.pixels.slice(0, 4)).toEqual([136, 68, 34, 255]);
});

test('list drag and keyboard reorder preserve active position and drive exact side-by-side pixels and ZIP order', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    await fixture(page, 'red.png', 4, 3, '#ff0000'),
    await fixture(page, 'green.png', 2, 2, '#00ff00'),
    await fixture(page, 'blue.png', 5, 4, '#0000ff'),
  ]);
  await expect(page.locator('.source-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Select green.png' }).click();
  await number(page, 'image-x', 1); await number(page, 'image-y', -1);
  await number(page, 'crop-x', -1); await number(page, 'crop-y', -1);
  await number(page, 'crop-width', 4); await number(page, 'crop-height', 3);
  const grip = (await page.getByRole('button', { name: 'Reorder blue.png' }).boundingBox())!;
  const first = (await page.locator('.source-row').first().boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, first.y + 3, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.source-details strong')).toHaveText(['blue.png', 'red.png', 'green.png']);
  await expect(page.getByRole('button', { name: 'Select green.png' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#image-x')).toHaveValue('1'); await expect(page.locator('#image-y')).toHaveValue('-1');
  await page.getByRole('button', { name: 'Reorder green.png' }).press('ArrowUp');
  await expect(page.locator('.source-details strong')).toHaveText(['blue.png', 'green.png', 'red.png']);
  await page.getByRole('button', { name: 'Reorder green.png' }).press('ArrowDown');
  await expect(page.locator('.source-details strong')).toHaveText(['blue.png', 'red.png', 'green.png']);
  const waitZip = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save all', exact: true }).click();
  const zip = await JSZip.loadAsync(await downloadBytes(await waitZip));
  expect(Object.keys(zip.files)).toEqual(['blue_patch.png', 'red_patch.png', 'green_patch.png', 'patchcake_combined.png']);
  const png = await decoded(page, await zip.file('patchcake_combined.png')!.async('uint8array'));
  expect([png.width, png.height]).toEqual([12, 3]);
  const ordered = [
    { x: 0, y: 0, width: 5, height: 4, rgba: [0, 0, 255, 255] },
    { x: 0, y: 0, width: 4, height: 3, rgba: [255, 0, 0, 255] },
    { x: 1, y: -1, width: 2, height: 2, rgba: [0, 255, 0, 255] },
  ];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 12; x++) {
    const source = ordered[Math.floor(x / 4)], wx = x % 4 - 1, wy = y - 1;
    const covered = wx >= source.x && wx < source.x + source.width && wy >= source.y && wy < source.y + source.height;
    expect(png.pixels.slice((y * 12 + x) * 4, (y * 12 + x) * 4 + 4)).toEqual(covered ? source.rgba : [0, 0, 0, 0]);
  }
});

test('combined size limits fail cleanly while individual export remains available', async ({ page }) => {
  await page.goto('/');
  const source = await fixture(page, 'small.png', 3, 2, '#ff0000');
  await page.locator('#file-input').setInputFiles([source, { ...source, name: 'other.png' }]);
  await expect(page.locator('.source-row')).toHaveCount(2);
  await number(page, 'crop-width', 9000);
  let downloads = 0; page.on('download', () => downloads++);
  await page.locator('#export-all').click();
  await expect(page.locator('#notifications')).toContainText('Combined PNG is too large');
  await expect(page.locator('#export-single')).toBeEnabled();
  await expect(page.locator('#export-all')).toBeEnabled();
  expect(downloads).toBe(0);
  const activeWait = page.waitForEvent('download'); await page.locator('#export-single').click();
  const individual = await decoded(page, await downloadBytes(await activeWait));
  expect([individual.width, individual.height]).toEqual([9000, 2]);
  await number(page, 'crop-width', 3);
  const wait = page.waitForEvent('download'); await page.locator('#export-all').click();
  const zip = await JSZip.loadAsync(await downloadBytes(await wait));
  const png = await decoded(page, await zip.file('patchcake_combined.png')!.async('uint8array'));
  expect([png.width, png.height]).toEqual([6, 2]);
  expect(png.pixels.slice(0, 4)).toEqual([255, 0, 0, 255]);
});

test('touch reorder and Escape cancellation keep list selection stable', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const page = await context.newPage(); await page.goto('/');
    const source = await fixture(page, 'first.png', 2, 2, '#445566');
    await page.locator('#file-input').setInputFiles([source, { ...source, name: 'second.png' }, { ...source, name: 'third.png' }]);
    await expect(page.locator('.source-row')).toHaveCount(3);
    const handle = page.getByRole('button', { name: 'Reorder third.png' }); await handle.scrollIntoViewIfNeeded();
    const grip = (await handle.boundingBox())!, first = (await page.locator('.source-row').first().boundingBox())!;
    const client = await context.newCDPSession(page);
    const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: first.y + 5 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.source-details strong')).toHaveText(['third.png', 'first.png', 'second.png']);
    await expect(page.getByRole('button', { name: 'Select first.png' })).toHaveAttribute('aria-pressed', 'true');
    const newGrip = (await page.getByRole('button', { name: 'Reorder third.png' }).boundingBox())!;
    const last = (await page.locator('.source-row').last().boundingBox())!;
    await page.mouse.move(newGrip.x + newGrip.width / 2, newGrip.y + newGrip.height / 2); await page.mouse.down();
    await page.mouse.move(newGrip.x + newGrip.width / 2, last.y + last.height - 3, { steps: 3 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(page.locator('.source-details strong')).toHaveText(['third.png', 'first.png', 'second.png']);
    await expect(page.locator('.source-row.dragging,.drop-before,.drop-after')).toHaveCount(0);
  } finally { await context.close(); }
});
