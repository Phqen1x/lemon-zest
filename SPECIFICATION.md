# Project Specification: Lemon Zest

## 1. Project Overview
An Electron desktop tool for real-time generative image inpainting using Lemonade Server.

## 2. Requirements
### Functional
* **Guide UI:** Initial state shows instructions to the user.
* **Reset Logic:** A dedicated button to wipe current canvases and history.
* **Crop-to-Mask:** Only the region around the painted mask is sent for inference.
* **OpenAI API Compliance:** Uses standard `/images/edits` endpoint with `model`, `prompt`, `size` parameters.

### Technical
* **Electron:** Frameless `BrowserWindow` with custom title bar and IPC bridge.
* **Canvas Pipeline:** Triple-buffer pattern (display canvas, offscreen image canvas, offscreen mask canvas).
* **State Management:** `ImageData` snapshots for undo; mask cleared after each inpaint.

## 3. Architecture
### Files
* `main.js` — Electron main process, window creation, IPC handlers.
* `preload.js` — IPC bridge exposing file dialog and window controls.
* `renderer.js` — Canvas drawing, mask painting, crop-to-mask, API calls, undo/redo.
* `index.html` — UI layout and yellow lemonade theme CSS.

### Crop-to-Mask Optimization
1. After stroke ends, scan mask for white pixel bounding box.
2. Expand to square with 64px padding, minimum 512x512.
3. If crop > 75% of canvas, fall back to full image.
4. Crop both image and mask canvases to the bounding box.
5. Send cropped region with matching `size` parameter.
6. Paste result back at the correct position.

## 4. Testing Checklist
* Guide text visible on startup, hidden after image load, returns after reset.
* Undo button disabled when stack empty.
* Small mask sends cropped region (check console log for crop dimensions).
* Large mask falls back to full image.
* Pulsing border animation during inference.
* Latency displayed after successful inpaint.
