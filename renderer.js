const IMG_SIZE = 1024;

const canvas = document.getElementById('canvas');
canvas.width = IMG_SIZE;
canvas.height = IMG_SIZE;
const ctx = canvas.getContext('2d', { willReadFrequently: true });

// Offscreen canvas holding the clean image (never has overlays)
const imageCanvas = document.createElement('canvas');
imageCanvas.width = IMG_SIZE;
imageCanvas.height = IMG_SIZE;
const imageCtx = imageCanvas.getContext('2d', { willReadFrequently: true });

// Offscreen mask canvas: black = keep, white = inpaint
const maskCanvas = document.createElement('canvas');
maskCanvas.width = IMG_SIZE;
maskCanvas.height = IMG_SIZE;
const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
// Initialize mask to opaque black
maskCtx.fillStyle = '#000000';
maskCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);

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
let inpaintInFlight = false;
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
    // Scale to fit canvas preserving aspect ratio
    const scale = Math.min(IMG_SIZE / img.width, IMG_SIZE / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const ox = (IMG_SIZE - w) / 2;
    const oy = (IMG_SIZE - h) / 2;

    // Draw onto the clean image canvas (black background first)
    imageCtx.fillStyle = '#000000';
    imageCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
    imageCtx.drawImage(img, ox, oy, w, h);

    // Reset mask to black
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);

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
  undoStack.push(imageCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE));
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
  ctx.clearRect(0, 0, IMG_SIZE, IMG_SIZE);
  ctx.drawImage(imageCanvas, 0, 0);

  // Red overlay on masked areas while drawing
  if (isDrawing) {
    const maskData = maskCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = IMG_SIZE;
    tmpCanvas.height = IMG_SIZE;
    const tmpCtx = tmpCanvas.getContext('2d');
    const overlay = tmpCtx.createImageData(IMG_SIZE, IMG_SIZE);
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

// --- Inpaint ---
function schedulInpaint() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runInpaint, 400);
}

const CROP_PADDING = 64; // px of context around mask bounding box
const MIN_CROP = 512;    // minimum crop dimension — sd models need reasonable sizes

// Find bounding box of white pixels in the mask, return a square crop region
function getMaskBounds() {
  const maskData = maskCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE);
  const d = maskData.data;
  let minX = IMG_SIZE, minY = IMG_SIZE, maxX = 0, maxY = 0;
  let found = false;

  for (let y = 0; y < IMG_SIZE; y++) {
    for (let x = 0; x < IMG_SIZE; x++) {
      const i = (y * IMG_SIZE + x) * 4;
      if (d[i] > 200) { // white pixel in mask
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  if (!found) return null;

  // Add padding
  minX = Math.max(0, minX - CROP_PADDING);
  minY = Math.max(0, minY - CROP_PADDING);
  maxX = Math.min(IMG_SIZE - 1, maxX + CROP_PADDING);
  maxY = Math.min(IMG_SIZE - 1, maxY + CROP_PADDING);

  // Make it square (use the larger dimension)
  let w = maxX - minX + 1;
  let h = maxY - minY + 1;
  let size = Math.max(w, h);

  // Enforce minimum size
  size = Math.max(size, MIN_CROP);

  // If the crop is nearly the full image, just send the full image
  if (size > IMG_SIZE * 0.75) return null;

  // Center the square on the mask bounding box center
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let x = Math.round(cx - size / 2);
  let y = Math.round(cy - size / 2);

  // Clamp to canvas bounds
  x = Math.max(0, Math.min(x, IMG_SIZE - size));
  y = Math.max(0, Math.min(y, IMG_SIZE - size));

  return { x, y, w: size, h: size };
}

// Create a cropped canvas from a source canvas
function cropCanvas(srcCanvas, bounds) {
  const cropped = document.createElement('canvas');
  cropped.width = bounds.w;
  cropped.height = bounds.h;
  const cCtx = cropped.getContext('2d');
  cCtx.drawImage(srcCanvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
  return cropped;
}

function canvasToBlob(cvs) {
  return new Promise((resolve) => cvs.toBlob(resolve, 'image/png'));
}

async function runInpaint() {
  if (!imageLoaded || inpaintInFlight) return;
  inpaintInFlight = true;
  setStatus('Inpainting...', true);
  imageFrame.classList.add('pulsing');

  const start = performance.now();

  try {
    // Find mask bounds and crop to just the masked region
    const bounds = getMaskBounds();

    let imageBlob, maskBlob, sendSize;

    if (bounds) {
      // Cropped mode — send only the region around the mask
      const croppedImage = cropCanvas(imageCanvas, bounds);
      const croppedMask = cropCanvas(maskCanvas, bounds);
      console.log(`Crop: ${bounds.w}x${bounds.h} at (${bounds.x},${bounds.y}) vs full ${IMG_SIZE}x${IMG_SIZE}`);
      imageBlob = await canvasToBlob(croppedImage);
      maskBlob = await canvasToBlob(croppedMask);
      sendSize = `${bounds.w}x${bounds.h}`;
    } else {
      // Full image mode — mask too large or covers most of the image
      console.log(`Sending full ${IMG_SIZE}x${IMG_SIZE} image`);
      imageBlob = await canvasToBlob(imageCanvas);
      maskBlob = await canvasToBlob(maskCanvas);
      sendSize = `${IMG_SIZE}x${IMG_SIZE}`;
    }

    const formData = new FormData();
    formData.append('image', imageBlob, 'image.png');
    formData.append('mask', maskBlob, 'mask.png');
    formData.append('model', 'Flux-2-Klein-4B');
    formData.append('prompt', 'seamless background fill');
    formData.append('size', sendSize);

    const res = await fetch('http://localhost:8000/api/v1/images/edits', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const b64 = json.data[0].b64_json;

    const latency = (performance.now() - start) / 1000;
    await applyResult(b64, bounds);
    setStatus('Ready', false, latency);
  } catch (err) {
    console.error('Inpaint error:', err);
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      setStatus('Connection Error: Is Lemonade Server running?');
    } else {
      setStatus(`Error: ${err.message}`);
    }
  } finally {
    inpaintInFlight = false;
    imageFrame.classList.remove('pulsing');
  }
}

async function applyResult(b64, bounds) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = 'data:image/png;base64,' + b64;
  });

  if (bounds) {
    // Paste the cropped result back at the correct position
    imageCtx.drawImage(img, bounds.x, bounds.y, bounds.w, bounds.h);
  } else {
    // Full image replacement
    imageCtx.clearRect(0, 0, IMG_SIZE, IMG_SIZE);
    imageCtx.drawImage(img, 0, 0);
  }

  // Reset mask
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);

  redraw();
}

// --- Undo ---
undoBtn.addEventListener('click', () => {
  if (undoStack.length === 0) return;
  const prev = undoStack.pop();
  imageCtx.putImageData(prev, 0, 0);
  undoBtn.disabled = undoStack.length === 0;
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
  redraw();
});

// --- Reset ---
document.getElementById('reset-btn').addEventListener('click', () => {
  imageCtx.clearRect(0, 0, IMG_SIZE, IMG_SIZE);
  ctx.clearRect(0, 0, IMG_SIZE, IMG_SIZE);
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
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
