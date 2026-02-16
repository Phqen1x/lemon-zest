const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// Offscreen canvas holding the clean image (never has overlays)
const imageCanvas = document.createElement('canvas');
imageCanvas.width = 512;
imageCanvas.height = 512;
const imageCtx = imageCanvas.getContext('2d', { willReadFrequently: true });

// Offscreen mask canvas: black = keep, white = inpaint
const maskCanvas = document.createElement('canvas');
maskCanvas.width = 512;
maskCanvas.height = 512;
const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
// Initialize mask to opaque black
maskCtx.fillStyle = '#000000';
maskCtx.fillRect(0, 0, 512, 512);

const guide = document.getElementById('guide');
const statusText = document.getElementById('status-text');
const statusSpinner = document.getElementById('status-spinner');
const latencyText = document.getElementById('latency-text');
const undoBtn = document.getElementById('undo-btn');
const brushSlider = document.getElementById('brush-slider');
const imageFrame = document.getElementById('image-frame');

let imageLoaded = false;
let isDrawing = false;
let brushSize = 30;
let undoStack = []; // stores ImageData snapshots of imageCanvas
let debounceTimer = null;
let cursorX = null;
let cursorY = null;

// --- Brush slider ---
brushSlider.addEventListener('input', () => {
  brushSize = parseInt(brushSlider.value, 10);
});

// --- Open image ---
document.getElementById('open-btn').addEventListener('click', async () => {
  const filePath = await window.electronAPI.openFileDialog();
  if (!filePath) return;
  loadImage(filePath);
});

async function loadImage(filePath) {
  // Read file via Node.js IPC to avoid file:// canvas tainting
  const dataURL = await window.electronAPI.readFileAsDataURL(filePath);
  const img = new Image();
  img.onload = () => {
    // Scale to fit 512x512 preserving aspect ratio
    const scale = Math.min(512 / img.width, 512 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const ox = (512 - w) / 2;
    const oy = (512 - h) / 2;

    // Draw onto the clean image canvas (black background first)
    imageCtx.fillStyle = '#000000';
    imageCtx.fillRect(0, 0, 512, 512);
    imageCtx.drawImage(img, ox, oy, w, h);

    // Reset mask to black
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, 512, 512);

    undoStack = [];
    undoBtn.disabled = true;
    imageLoaded = true;
    guide.style.display = 'none';
    setStatus('Ready');
    redraw();
  };
  img.src = dataURL;
}

// --- Drawing ---
canvas.addEventListener('mousedown', (e) => {
  if (!imageLoaded) return;
  isDrawing = true;

  // Save undo snapshot of the clean image
  undoStack.push(imageCtx.getImageData(0, 0, 512, 512));
  undoBtn.disabled = false;

  paintMask(e.offsetX, e.offsetY);
});

canvas.addEventListener('mousemove', (e) => {
  cursorX = e.offsetX;
  cursorY = e.offsetY;
  if (isDrawing) {
    paintMask(e.offsetX, e.offsetY);
  } else {
    redraw();
  }
});

canvas.addEventListener('mouseup', () => {
  if (!isDrawing) return;
  isDrawing = false;
  redraw();
  schedulInpaint();
});

canvas.addEventListener('mouseleave', () => {
  cursorX = null;
  cursorY = null;
  if (isDrawing) {
    isDrawing = false;
    redraw();
    schedulInpaint();
  } else {
    redraw();
  }
});

function paintMask(x, y) {
  maskCtx.fillStyle = '#ffffff';
  maskCtx.beginPath();
  maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
  maskCtx.fill();
  redraw();
}

function redraw() {
  // Always start by drawing the clean image
  ctx.clearRect(0, 0, 512, 512);
  ctx.drawImage(imageCanvas, 0, 0);

  // Red overlay on masked areas while drawing
  if (isDrawing) {
    const maskData = maskCtx.getImageData(0, 0, 512, 512);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = 512;
    tmpCanvas.height = 512;
    const tmpCtx = tmpCanvas.getContext('2d');
    const overlay = tmpCtx.createImageData(512, 512);
    for (let i = 0; i < maskData.data.length; i += 4) {
      if (maskData.data[i] > 200) {
        overlay.data[i] = 255;     // R
        overlay.data[i + 1] = 0;   // G
        overlay.data[i + 2] = 0;   // B
        overlay.data[i + 3] = 102;  // ~40% alpha
      }
    }
    tmpCtx.putImageData(overlay, 0, 0);
    ctx.drawImage(tmpCanvas, 0, 0);
  }

  // Cursor circle preview
  if (cursorX !== null && cursorY !== null && imageLoaded) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cursorX, cursorY, brushSize / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(cursorX, cursorY, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// --- Convert canvas ImageData to RGB PNG blob (no alpha channel) ---
// This matches the Python version's img.convert("RGB").save(format="PNG")
function canvasToRGBBlob(cvs) {
  const w = cvs.width;
  const h = cvs.height;
  const srcCtx = cvs.getContext('2d');
  const imageData = srcCtx.getImageData(0, 0, w, h);
  const rgba = imageData.data;

  // Force all alpha to 255 (fully opaque) and composite on black
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    rgba[i]     = Math.round(rgba[i] * a);     // R * alpha
    rgba[i + 1] = Math.round(rgba[i + 1] * a); // G * alpha
    rgba[i + 2] = Math.round(rgba[i + 2] * a); // B * alpha
    rgba[i + 3] = 255;                          // full alpha
  }

  // Put back and export
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tmpCtx = tmp.getContext('2d');
  tmpCtx.putImageData(new ImageData(rgba, w, h), 0, 0);

  return new Promise((resolve) => tmp.toBlob(resolve, 'image/png'));
}

// --- Inpaint ---
function schedulInpaint() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runInpaint, 400);
}

async function runInpaint() {
  if (!imageLoaded) return;
  setStatus('Inpainting...', true);
  imageFrame.classList.add('pulsing');

  const start = performance.now();

  try {
    // Export clean image and mask as RGB PNGs (no alpha)
    const imageBlob = await canvasToRGBBlob(imageCanvas);
    const maskBlob = await canvasToRGBBlob(maskCanvas);

    const formData = new FormData();
    formData.append('image', imageBlob, 'image.png');
    formData.append('mask', maskBlob, 'mask.png');
    formData.append('model', 'SD-Turbo');
    formData.append('prompt', 'seamless background fill');
    formData.append('steps', '4');
    formData.append('strength', '0.5');
    formData.append('cfg_scale', '1.0');

    const res = await fetch('http://localhost:8000/api/v1/images/edits', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const b64 = json.data[0].b64_json;

    const latency = (performance.now() - start) / 1000;
    await applyResult(b64);
    setStatus('Ready', false, latency);
  } catch (err) {
    console.error('Inpaint error:', err);
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      setStatus('Connection Error: Is SD-Turbo running?');
    } else {
      setStatus(`Error: ${err.message}`);
    }
  } finally {
    imageFrame.classList.remove('pulsing');
  }
}

async function applyResult(b64) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = 'data:image/png;base64,' + b64;
  });

  // Update the clean image canvas
  imageCtx.clearRect(0, 0, 512, 512);
  imageCtx.drawImage(img, 0, 0);

  // Reset mask
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, 512, 512);

  redraw();
}

// --- Undo ---
undoBtn.addEventListener('click', () => {
  if (undoStack.length === 0) return;
  const prev = undoStack.pop();
  imageCtx.putImageData(prev, 0, 0);
  undoBtn.disabled = undoStack.length === 0;
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, 512, 512);
  redraw();
});

// --- Reset ---
document.getElementById('reset-btn').addEventListener('click', () => {
  imageCtx.clearRect(0, 0, 512, 512);
  ctx.clearRect(0, 0, 512, 512);
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, 512, 512);
  undoStack = [];
  undoBtn.disabled = true;
  imageLoaded = false;
  guide.style.display = 'flex';
  setStatus('Reset');
});

// --- Status ---
function setStatus(text, spinning = false, latency = null) {
  statusText.textContent = text;
  statusSpinner.style.display = spinning ? 'inline-block' : 'none';
  latencyText.textContent = latency !== null ? latency.toFixed(2) + 's' : '';
}

// --- Window controls ---
document.getElementById('win-minimize').addEventListener('click', () => window.electronAPI.minimize());
document.getElementById('win-maximize').addEventListener('click', () => window.electronAPI.maximize());
document.getElementById('win-close').addEventListener('click', () => window.electronAPI.close());
