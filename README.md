# Patchcake

A browser-based tool for cropping the same region from multiple images into transparent PNGs. See [Document.md](Document.md) for the original requirements and the separately marked AI-written implementation specification.

## Run locally

Use Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Open the URL printed by Vite.

## Workflow

1. Drop multiple images into the editor, or choose **Add images** / **Add**.
2. Select the active image from the list on the right. Images initially share the top-left origin `(0, 0)`, regardless of resolution. Drag the grip beside a row to reorder images. A focused grip also supports Up / Down arrow keys and Home / End.
3. Use **Move image** to drag the active image, or enter its X / Y under **Image position**. **Reset** restores that image to `(0, 0)`.
4. Use **Crop** to select the shared rectangle. Drag inside the rectangle to move it, or drag any of its eight handles to resize it. Shift + drag creates a new rectangle.
5. Set exact X / Y / Width / Height in the **Crop region** controls at the bottom.
6. **Save active** downloads the crop from the active image as a PNG. **Save all** downloads a ZIP containing individual crops in list order and a combined PNG joining every crop horizontally from left to right in that same order.

The interface uses English labels and a flat, dark theme, with no title banner, output preview panel, or theme switch. Middle-button drag pans the view in either editing tool; it does not change image positions or the shared crop. The image list fills the available sidebar height. Narrow screens use a vertical layout, with the crop controls last.

All coordinates and dimensions are integer source pixels. Zoom only changes the display. Export preserves the source scale and fills uncovered areas with RGBA `(0, 0, 0, 0)`. Image processing stays in the browser; files are never uploaded. Images and settings are lost when the page is reloaded or closed.

Output filenames use `original-name_patch.png`, excluding the original extension. Duplicate output names receive suffixes such as `_2` and `_3`. The ZIP filename is `patchcake_patches.zip`. The combined PNG is `patchcake_combined.png`, with width `crop width × image count` and height `crop height`. Crops are joined with no scaling, gaps, borders, or captions; each crop preserves transparent missing areas independently. Reordering keeps the active image and all per-image positions intact.

## Shortcuts

| Action | Key |
| --- | --- |
| Undo | Ctrl / Cmd + Z |
| Redo | Ctrl / Cmd + Shift + Z, or Ctrl + Y |
| Crop tool | R |
| Move image tool | V |
| Move the current target by 1 px | Arrow keys with the canvas focused |
| Move by 10 px | Shift + arrow keys |
| Cancel the current drag | Escape |
| Zoom | Mouse wheel over the editor |
| Pan the view | Middle-button drag |
| Reorder an image | Drag its grip, or focus the grip and press Up / Down / Home / End |

The target is the shared rectangle in Crop mode and the active image in Move image mode. Use **Fit to view** to show the active image and crop rectangle together.

Undo and redo cover crop edits, image positions and reset, import batches, removals, and reordering. Each completed drag is one step. Up to 100 edits are kept in memory. Undo restores the active image from before the edit. Selection, tool changes, zoom, and panning do not create history entries. A new edit clears redo; cancelled, invalid, and unchanged edits preserve it. Undo / redo shortcuts work outside input fields, where native text editing remains available. There are no Undo / Redo buttons. Image URLs are retained while current state or history references them, then released.

## Build and host

```sh
npm run build
npm run preview
```

Deploy `dist/` to a static host. No backend or API key is required. For a subdirectory, use `npm run build -- --base=/your-path/`.

## Verification

```sh
npx playwright install chromium
npm test
```

Browser tests check exported PNG pixels and transparency, independent image positions and resolutions, active PNG / ZIP downloads including the combined image, list order and per-crop clipping, undo / redo and restored image lifetimes, middle-button panning, mouse / touch / keyboard reordering, duplicate names, validation, deletion, English dark layout, crop placement, and narrow screens with enlarged text.

## Limits

- PNG / JPEG / WebP / GIF / BMP / AVIF / SVG and other formats supported by the browser's image decoder.
- Animated inputs export a still frame as displayed by the browser.
- Each output side must be at most 16,384 px, with at most 33,554,432 pixels in total. Available device memory may require smaller crops.
- The combined PNG in **Save all** must fit these limits as a complete image. If it exceeds them, Save all shows an error without downloading an incomplete ZIP; reduce the crop size or image count. **Save active** remains available for valid individual crops.
- Canvas exports 8-bit RGBA PNGs. Original EXIF/ICC metadata and higher bit depth are not retained.
- In WebMCP-enabled browsers, optional tools expose editor state and shared crop configuration. Ordinary browsers work without this API. Registration and validation are tested against a mock registry; a real WebMCP browser has not been verified.
