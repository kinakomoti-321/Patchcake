- 比較用の画像として、複数枚の画像から一部分を切り取るソフトを作りたいです
  - 基本的に同じ部分を切り取る形にしたいです
- Website として公開することを前提としています
- Vite を使用していください

仕様
- ドロップアンドドロップで画像を置けるようにしてください
- 読み込んだ画像は右側に一覧を出し、削除とかできるようにしてください
    - 1枚だけ選択できるようにしてそれを active とします
- active 画像はドラッグで移動できるようにします
    - 数値的にもいじれるように position も数値入れられるようにしてください
- 異なる解像度でも使えるようにデフォルトでは左上の位置を合わせるようにしてください
- 切り取る領域はいわゆる一般的な領域選択ツールと同じようにしてください
  - 半透明な青色の枠でお願いします
  - 具体的な値でも操作できるようにしてください
  - width, height, 左上の座標で指定できるようにしてください
- Output では各画像を切り取った画像をそれぞれ png にしてください
  - 名前は元の画像名_patch.png でお願いします
  - 切り取った領域に画像がない場合はその部分は(0,0,0,0)にしてください

---

> [!NOTE]
> **AI-written implementation specification (2026-10-07)**
>
> This block describes the current implementation, including AI-added details. The original requirements remain above.
>
> ### Interface and architecture
>
> - A static web app built with Vite and TypeScript.
> - English interface text, controls, tooltips, accessibility labels, and error messages.
> - A flat, dark theme with solid surfaces, thin borders, minimal corner rounding, and no decorative shadows or title banner. No light-mode switch.
> - The editing canvas occupies the main area. The right sidebar contains a long, scrollable image list and the active image's position controls.
> - The shared crop controls and export buttons sit at the bottom. Narrow screens stack the editor, sidebar, and crop controls vertically.
> - No output preview panel or separate display-panning tool button. Middle-button drag pans the view; zoom and Fit to view remain available.
> - Images are processed entirely in the browser and are never uploaded. Images and settings are held in memory and are lost on reload or when the page closes.
>
> ### Image loading and selection
>
> - Add multiple images using drag and drop or the Add images / Add buttons.
> - Accept PNG / JPEG / WebP / GIF / BMP / AVIF / SVG and other browser-decodable image formats.
> - Show loading failures with the filename; valid files in the same batch still load.
> - List each image's thumbnail, original filename, and pixel dimensions.
> - At most one image is active. The first loaded image becomes active initially; only the active image appears on the editing canvas.
> - The active row uses its background and border to indicate selection. Row numbers stay visible; there is no active checkmark.
> - Each image can be removed individually. Removing the active image selects its neighbor. With no images, editing and export controls are disabled.
> - Drag the grip at the left of a row to reorder the list with a mouse or touch. An insertion marker shows the drop position; the list scrolls when dragging near its top or bottom edge.
> - A focused reorder grip supports Up / Down arrow keys and Home / End. Escape cancels an in-progress reorder drag; dropping outside the list also cancels it.
> - Reordering preserves the active image, per-image positions, and shared crop. The current list order determines the left-to-right combined output and the order of individual files added to the ZIP.
>
> ### Coordinates and image positions
>
> - Image positions and the crop share a world coordinate system in source pixels. Positive X points right; positive Y points down.
> - Initially, all images start at top-left `(0, 0)` without resizing, even when their resolutions differ.
> - Each image retains its own X / Y position when selection changes.
> - Move image drags only the active image. Its X / Y can also be entered as integers, including negative values.
> - Reset restores only the active image's position to `(0, 0)`.
>
> ### Shared crop rectangle
>
> - One rectangle applies to every loaded image. It is displayed with a translucent blue fill and blue outline.
> - After the first image loads, the initial crop starts at `(0, 0)`. Each dimension is `min(256, the corresponding source dimension)`.
> - The Crop tool draws a rectangle, moves it by dragging inside it, and resizes it using eight handles at the corners and edge midpoints.
> - Shift + drag redraws the crop even when the gesture starts inside the existing rectangle.
> - Bottom controls specify X, Y, Width, and Height as integers. Negative coordinates and regions outside the source images are supported.
> - Width and height must each be between 1 and 16,384 px. Total area must not exceed 33,554,432 pixels. Invalid numeric edits show an error and preserve the previous valid value.
>
> ### Display and shortcuts
>
> - Zoom controls and the mouse wheel change the display scale without affecting image positions or output dimensions.
> - Fit to view shows the active image and the shared crop together.
> - Middle-button drag pans the viewport in either editing tool, without changing image positions, crop coordinates, or the selected tool. Escape restores the view from before the drag.
> - Transparent pixels in the displayed source are shown against a checkerboard. The surrounding workspace uses a solid dark background.
>
> | Action | Key |
> | --- | --- |
> | Undo | Ctrl / Cmd + Z |
> | Redo | Ctrl / Cmd + Shift + Z, or Ctrl + Y |
> | Crop tool | R |
> | Move image tool | V |
> | Move the current target by 1 px | Arrow keys with the canvas focused |
> | Move by 10 px | Shift + arrow keys |
> | Cancel the current drag | Escape |
> | Pan the view | Middle-button drag |
> | Reorder the focused image grip | Up / Down / Home / End |
>
> On the canvas, the arrow-key target is the crop rectangle in Crop mode and the active image in Move image mode.
>
> ### Undo and redo
>
> - Keep up to 100 edits in memory, covering the shared crop, image positions and reset, import batches, image removal, and list reordering. A drag is recorded once when completed; an import batch is one edit.
> - Undo restores images, their order and positions, the shared crop, and the active image from before the edit. Redo restores the state that was undone. Removed images remain available for restoration and export.
> - Selection, tool changes, zoom, and panning do not create history entries. A new edit clears redo. No-op, rejected, and cancelled edits preserve redo.
> - Escape, cancelled pointers, lost pointer capture, or window blur roll back the current drag. Undo / redo during a drag cancels it first without consuming a history entry.
> - Shortcuts work outside input fields, which retain native text-editing behavior. No Undo / Redo buttons are displayed.
> - Source object URLs are retained while current state or history references them, then released when history eviction or a new branch makes them unnecessary. History is lost on reload.
>
> ### PNG and ZIP export
>
> - Save active exports the active image's crop as a PNG. Save all exports `patchcake_patches.zip`, containing every loaded image's individual crop in list order followed by `patchcake_combined.png`.
> - The combined PNG places every crop side by side, from left to right in the current list order, with no gaps, scaling, borders, or captions. There is no separate combined-image save button.
> - The combined image's width is `crop width × image count` and its height is `crop height`. Each source is clipped independently to its crop slot so pixels never spill into neighboring slots. Uncovered areas in every slot remain RGBA `(0, 0, 0, 0)`.
> - Every individual crop has the exact width and height of the shared rectangle.
> - Image-specific positions are applied without resizing the source. Selection frames, handles, checkerboards, and other interface elements are excluded.
> - Uncovered pixels are RGBA `(0, 0, 0, 0)`. Source transparency is preserved.
> - Output names remove the original extension and append `_patch.png`: for example, `sample.jpg` becomes `sample_patch.png`.
> - Duplicate names receive suffixes such as `sample_patch_2.png` to prevent overwriting.
> - Export uses the image list order, positions, and crop at the start of the operation. Export buttons are disabled until that operation completes.
> - The complete combined PNG must obey the same side and pixel-area limits as an individual PNG. An oversized combined image makes Save all show an error without downloading an incomplete ZIP; reduce the crop size or image count. Save active remains available for valid individual crops.
>
> ### Supported scope and limits
>
> - Canvas exports 8-bit RGBA PNGs. Original EXIF/ICC metadata and higher bit depth are not retained.
> - Animated images export a still frame as displayed by the browser.
> - Large images or many loaded files can exceed device memory or browser limits.
> - AI-added optional WebMCP tools expose the image list, positions, active image, and shared crop, and can set the shared rectangle numerically. Unsupported browsers use the ordinary interface.
> - WebMCP registration and input validation have been checked using a mock registry. A real WebMCP-enabled environment has not been verified.
>
> **End of AI-written implementation specification.**
