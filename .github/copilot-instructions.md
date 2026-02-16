# Lemon Zest Development Guide

## Build & Run

**Dependencies:**
```bash
npm install
```

**Run Application:**
```bash
npm start
```

**Lemonade Server:**
The app requires a local Lemonade Server running Flux-2-Klein-4B:
```bash
lemonade run Flux-2-Klein-4B
```
- API endpoint: `http://localhost:8000/api/v1/images/edits` (OpenAI-compatible)
- Model: `Flux-2-Klein-4B`
- Steps/cfg_scale: Injected server-side from model defaults

## Architecture

### File Structure
- `main.js` — Electron main process: frameless BrowserWindow, IPC handlers for file dialog and file reading
- `preload.js` — IPC bridge: exposes `openFileDialog`, `readFileAsDataURL`, `minimize`, `maximize`, `close`
- `renderer.js` — All client-side logic: canvas drawing, mask painting, crop optimization, API calls, undo
- `index.html` — UI layout and yellow lemonade theme CSS

### UI Structure
- **Custom Title Bar**: Frameless window with `-webkit-app-region: drag` and window control buttons
- **Toolbar**: Open, Undo, Reset buttons + brush size slider
- **Content**: 1024x1024 HTML5 canvas with guide overlay
- **Status Bar**: Spinner, status text, latency display

### Canvas Pipeline (Triple-Buffer)
- `canvas` — Display canvas shown to user, includes overlays and cursor preview
- `imageCanvas` — Offscreen, holds the clean image (never has overlays)
- `maskCanvas` — Offscreen, black = keep, white = inpaint

### Crop-to-Mask Optimization
Instead of sending the full 1024x1024 image for every edit:
1. Scan mask for white pixel bounding box
2. Expand to square with 64px padding, minimum 512x512
3. If crop > 75% of canvas, fall back to full image
4. Crop both image and mask, send with matching `size` parameter
5. Paste result back at correct position

### Drawing Flow
1. User strokes → `mousedown`/`mousemove`/`mouseup` handlers
2. Stroke paints white circles on `maskCanvas`
3. Red semi-transparent overlay shown on display canvas while drawing
4. Stroke end triggers debounced `runInpaint()` (400ms)
5. Mask bounds computed, image+mask cropped to region
6. POST to Lemonade API with cropped image + mask as multipart form
7. Response base64 PNG → pasted back onto `imageCanvas` at crop position
8. Mask cleared for next edit

### File Loading
Files are read via IPC (`readFileAsDataURL`) to avoid canvas tainting from `file://` URLs.

## Conventions

### API Parameters (OpenAI-compliant)
- `image` — PNG file (multipart)
- `mask` — PNG file (multipart)
- `model` — `Flux-2-Klein-4B`
- `prompt` — Description of desired edit
- `size` — `WxH` matching the sent image dimensions

### Button State
- **Undo button**: Enabled only when undo stack has items
- **Reset button**: Always enabled

### Status Updates
`setStatus(text, spinning, latency)` manages status label, spinner visibility, and latency display.

### Error Handling
- Connection errors show "Is Lemonade Server running?"
- HTTP errors show status code
- `inpaintInFlight` guard prevents stacking API calls

## Testing Checklist
- [ ] Guide text visible on startup
- [ ] Guide text hidden after image load
- [ ] Guide text returns after reset
- [ ] Undo button disabled when stack empty
- [ ] Small mask crops to ~512x512 (check console)
- [ ] Large mask sends full 1024x1024
- [ ] Pulsing border during inference
- [ ] Latency displayed after successful inpaint
