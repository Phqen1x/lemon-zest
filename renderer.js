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
const redoBtn = document.getElementById('redo-btn');
const saveBtn = document.getElementById('save-btn');
const superimposeBtn = document.getElementById('superimpose-btn');
const brushSlider = document.getElementById('brush-slider');
const imageFrame = document.getElementById('image-frame');
const promptInput = document.getElementById('prompt-input');
const strengthSlider = document.getElementById('strength-slider');
const strengthValue = document.getElementById('strength-value');
const stepsSlider = document.getElementById('steps-slider');
const stepsValue = document.getElementById('steps-value');
const toolBrushBtn = document.getElementById('tool-brush');
const toolLassoBtn = document.getElementById('tool-lasso');
const toolRectBtn = document.getElementById('tool-rect');
const toolCircleBtn = document.getElementById('tool-circle');
const toolFillBtn = document.getElementById('tool-fill');
const selectAllBtn = document.getElementById('select-all-btn');
const toleranceSlider = document.getElementById('tolerance-slider');
const toleranceSliderGroup = document.getElementById('tolerance-slider-group');
const inpaintOverlay = document.getElementById('inpaint-overlay');
const toolbar = document.querySelector('.toolbar');
const toolbarRow2 = document.querySelector('.toolbar-row2');
const brushSliderGroup = document.getElementById('brush-slider-group');
const statusOverlay = document.getElementById('status-overlay');
const overlayStatusText = document.getElementById('overlay-status-text');
const downloadProgress = document.getElementById('download-progress');
const downloadBarFill = document.getElementById('download-bar-fill');
const downloadDetail = document.getElementById('download-detail');

let imageLoaded = false;
let imageModified = false;
let isDrawing = false;
let brushSize = 30;
let fillTolerance = 32;
let undoStack = []; // stores ImageData snapshots of imageCanvas
let redoStack = [];
let debounceTimer = null;
let inpaintInFlight = false;
let cursorX = null;
let cursorY = null;
let oneTimePrompt = null; // temporary prompt override for superimpose
let inpaintController = null; // AbortController for in-flight inpaint fetch
let inpaintAbortedByUser = false;

// Tool state
let currentTool = 'rect'; // 'brush' | 'lasso' | 'rect' | 'circle' | 'fill'
let lassoPath = [];         // array of {x, y} points
let shapeStart = null;      // {x, y} for rect/circle drag start

// Zoom state
let zoomLevel = 1.0;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4.0;
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
const zoomLevelDisplay = document.getElementById('zoom-level-display');

// --- Display scaling ---
// Canvas backing store is always IMG_SIZE x IMG_SIZE.
// CSS width/height scales it to fit the available content area.
const contentArea = document.querySelector('.content');

function fitCanvas() {
  // Measure available space (content area minus image-frame border)
  const borderSize = 3 * 2; // 3px border on each side
  const pad = 16; // breathing room
  const availW = contentArea.clientWidth - borderSize - pad;
  const availH = contentArea.clientHeight - borderSize - pad;
  const baseSize = Math.max(64, Math.min(availW, availH, IMG_SIZE));
  const displaySize = Math.round(baseSize * zoomLevel);
  canvas.style.width = displaySize + 'px';
  canvas.style.height = displaySize + 'px';
  zoomLevelDisplay.textContent = Math.round(zoomLevel * 100) + '%';
}

function setZoom(newZoom) {
  zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
  fitCanvas();
}

// Convert mouse event coordinates from CSS space to canvas backing-store space
function canvasCoords(e) {
  const cw = canvas.clientWidth || canvas.width;
  const scale = canvas.width / cw;
  return { x: Math.round(e.offsetX * scale), y: Math.round(e.offsetY * scale) };
}

// Convert client (page) coordinates to clamped canvas backing-store space
function canvasCoordsFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const cw = canvas.clientWidth || canvas.width;
  const scale = canvas.width / cw;
  const x = Math.round((clientX - rect.left) * scale);
  const y = Math.round((clientY - rect.top) * scale);
  return {
    x: Math.max(0, Math.min(IMG_SIZE - 1, x)),
    y: Math.max(0, Math.min(IMG_SIZE - 1, y))
  };
}

fitCanvas();
window.addEventListener('resize', fitCanvas);
// No image loaded at startup — show pointer cursor to hint the area is clickable
canvas.style.cursor = 'pointer';

// --- Zoom controls ---
document.getElementById('zoom-in-btn').addEventListener('click', () => {
  const next = ZOOM_STEPS.find(z => z > zoomLevel + 0.01);
  setZoom(next !== undefined ? next : MAX_ZOOM);
});

document.getElementById('zoom-out-btn').addEventListener('click', () => {
  const prev = [...ZOOM_STEPS].reverse().find(z => z < zoomLevel - 0.01);
  setZoom(prev !== undefined ? prev : MIN_ZOOM);
});

// Ctrl+scroll (trackpad pinch or mouse) = zoom; plain scroll = pan
contentArea.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(zoomLevel * factor);
  }
}, { passive: false });

// --- Brush slider ---
brushSlider.addEventListener('input', () => {
  brushSize = parseInt(brushSlider.value, 10);
});

// --- Tolerance slider ---
toleranceSlider.addEventListener('input', () => {
  fillTolerance = parseInt(toleranceSlider.value, 10);
});

// --- Parameter sliders ---
strengthSlider.addEventListener('input', () => {
  strengthValue.textContent = parseFloat(strengthSlider.value).toFixed(2);
});

stepsSlider.addEventListener('input', () => {
  stepsValue.textContent = stepsSlider.value;
});

// --- Tool toggle ---
toolBrushBtn.addEventListener('click', () => setTool('brush'));
toolLassoBtn.addEventListener('click', () => setTool('lasso'));
toolRectBtn.addEventListener('click', () => setTool('rect'));
toolCircleBtn.addEventListener('click', () => setTool('circle'));
toolFillBtn.addEventListener('click', () => setTool('fill'));

function setTool(tool) {
  currentTool = tool;
  toolBrushBtn.classList.toggle('active', tool === 'brush');
  toolLassoBtn.classList.toggle('active', tool === 'lasso');
  toolRectBtn.classList.toggle('active', tool === 'rect');
  toolCircleBtn.classList.toggle('active', tool === 'circle');
  toolFillBtn.classList.toggle('active', tool === 'fill');
  if (imageLoaded) {
    canvas.style.cursor = tool === 'brush' ? 'none' : 'crosshair';
  }
  // Show/hide tool-specific sliders
  brushSliderGroup.classList.toggle('hidden', tool !== 'brush');
  toleranceSliderGroup.classList.toggle('hidden', tool !== 'fill');
  // Cancel any in-progress shape
  lassoPath = [];
  shapeStart = null;
  redraw();
}

// Keyboard shortcuts for tools and actions
document.addEventListener('keydown', (e) => {
  // Ctrl+Z → Undo
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
    e.preventDefault();
    undoBtn.click();
    return;
  }
  // Ctrl+Y or Ctrl+Shift+Z → Redo
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
    e.preventDefault();
    redoBtn.click();
    return;
  }
  // Ctrl+S → Save As
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveBtn.click();
    return;
  }
  // Ctrl+= or Ctrl++ → Zoom in
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    document.getElementById('zoom-in-btn').click();
    return;
  }
  // Ctrl+- → Zoom out
  if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    e.preventDefault();
    document.getElementById('zoom-out-btn').click();
    return;
  }
  // Ctrl+0 → Reset zoom
  if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault();
    setZoom(1.0);
    return;
  }
  // Ctrl+A → Select All
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault();
    selectAllBtn.click();
    return;
  }
  // Escape → Abort running inpaint
  if (e.key === 'Escape' && inpaintInFlight) {
    e.preventDefault();
    abortBtn.click();
    return;
  }
  // Enter → Execute inpaint (works from prompt input too)
  if (e.key === 'Enter') {
    e.preventDefault();
    executeBtn.click();
    return;
  }
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'b' || e.key === 'B') setTool('brush');
  if (e.key === 'l' || e.key === 'L') setTool('lasso');
  if (e.key === 'r' || e.key === 'R') setTool('rect');
  if (e.key === 'c' || e.key === 'C') setTool('circle');
  if (e.key === 'f' || e.key === 'F') setTool('fill');
});

// --- Open image ---
document.getElementById('open-btn').addEventListener('click', async () => {
  const filePath = await window.electronAPI.openFileDialog();
  if (!filePath) return;
  loadImage(filePath);
});

// Feature 1: clicking the content area when no image is loaded opens the file picker
contentArea.addEventListener('click', () => {
  if (!imageLoaded && statusOverlay.style.display === 'none') {
    document.getElementById('open-btn').click();
  }
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
    redoStack = [];
    undoBtn.disabled = true;
    redoBtn.disabled = true;
    imageLoaded = true;
    imageModified = false;
    saveBtn.disabled = false;
    superimposeBtn.disabled = false;
    selectAllBtn.disabled = false;
    guide.style.display = 'none';
    canvas.style.cursor = currentTool === 'brush' ? 'none' : 'crosshair';
    setStatus('Ready');
    redraw();
  };
  img.src = dataURL;
}

// Superimpose an image at specified position (centered if x/y not provided)
// promptOverride: null = use promptInput, '' = no prompt (simple overlay), string = one-time prompt
async function superimposeImage(filePath, x = null, y = null, promptOverride = null) {
  if (!imageLoaded || inpaintInFlight) return;

  // Save undo snapshot
  undoStack.push(imageCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE));
  if (undoStack.length > 20) undoStack.shift();
  undoBtn.disabled = false;
  redoStack = [];
  redoBtn.disabled = true;

  const dataURL = await window.electronAPI.readFileAsDataURL(filePath);
  const img = new Image();
  
  img.onload = () => {
    // Determine position: center if not specified
    let targetX = x !== null ? x : IMG_SIZE / 2;
    let targetY = y !== null ? y : IMG_SIZE / 2;

    // Scale image if it's too large for the canvas
    let w = img.width;
    let h = img.height;
    const maxSize = IMG_SIZE * 0.8; // Don't let it take up more than 80% of canvas
    if (w > maxSize || h > maxSize) {
      const scale = Math.min(maxSize / w, maxSize / h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    // Calculate top-left corner (image is centered on target position)
    const dx = Math.round(targetX - w / 2);
    const dy = Math.round(targetY - h / 2);

    // Determine the effective prompt
    const prompt = promptOverride !== null ? promptOverride : promptInput.value.trim();
    const isGenericPrompt = !prompt || prompt.toLowerCase() === 'seamless background fill';

    if (isGenericPrompt) {
      // Simple overlay mode - just draw the image directly
      imageCtx.drawImage(img, dx, dy, w, h);
      imageModified = true;
      setStatus('Image superimposed');
      redraw();
    } else {
      // Prompt-guided mode - create mask and use inpainting API
      // First draw the superimposed image onto the canvas
      imageCtx.drawImage(img, dx, dy, w, h);
      
      // Create white mask region where the image was placed
      maskCtx.fillStyle = '#FFFFFF';
      maskCtx.fillRect(dx, dy, w, h);

      imageModified = true;
      oneTimePrompt = prompt;
      redraw();

      // Trigger inpainting with the provided prompt
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => runInpaint(), 400);
    }
  };
  
  img.src = dataURL;
}

// --- Superimpose button ---
document.getElementById('superimpose-btn').addEventListener('click', async () => {
  const filePath = await window.electronAPI.openSuperimposeDialog();
  if (!filePath) return;
  // Superimpose at center (no x, y specified)
  showSuperimposePromptDialog(filePath, null, null);
});

// --- Superimpose prompt dialog ---
const siDialog = document.getElementById('superimpose-dialog');
const siCurrentPrompt = document.getElementById('si-current-prompt');
const siCustomPrompt = document.getElementById('si-custom-prompt');
const siOkBtn = document.getElementById('si-ok-btn');
const siCancelBtn = document.getElementById('si-cancel-btn');

let pendingSuperimpose = null; // { filePath, x, y }

function showSuperimposePromptDialog(filePath, x, y) {
  pendingSuperimpose = { filePath, x, y };
  const current = promptInput.value.trim() || 'seamless background fill';
  siCurrentPrompt.textContent = '"' + current + '"';
  siCustomPrompt.value = '';
  // Reset to "current" radio
  document.querySelector('input[name="si-prompt-choice"][value="current"]').checked = true;
  siDialog.style.display = 'flex';
  siCustomPrompt.focus();
}

// Auto-select "custom" radio when typing in the custom prompt field
siCustomPrompt.addEventListener('focus', () => {
  document.querySelector('input[name="si-prompt-choice"][value="custom"]').checked = true;
});

siOkBtn.addEventListener('click', () => {
  if (!pendingSuperimpose) return;
  const { filePath, x, y } = pendingSuperimpose;
  const choice = document.querySelector('input[name="si-prompt-choice"]:checked').value;
  let promptOverride = null;
  if (choice === 'custom') {
    promptOverride = siCustomPrompt.value.trim() || null;
  } else if (choice === 'none') {
    promptOverride = '';
  }
  // choice === 'current' leaves promptOverride as null (uses promptInput)
  siDialog.style.display = 'none';
  pendingSuperimpose = null;
  superimposeImage(filePath, x, y, promptOverride);
});

siCancelBtn.addEventListener('click', () => {
  siDialog.style.display = 'none';
  pendingSuperimpose = null;
});

// Enter key submits the dialog
siDialog.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    siOkBtn.click();
  } else if (e.key === 'Escape') {
    siCancelBtn.click();
  }
});

// --- Drawing ---

// Document-level handlers for tracking mouse during drag (outside canvas)
function onDragMove(e) {
  const { x, y } = canvasCoordsFromClient(e.clientX, e.clientY);
  cursorX = x;
  cursorY = y;

  if (currentTool === 'brush') {
    paintMask(x, y);
  } else if (currentTool === 'lasso') {
    lassoPath.push({ x, y });
    redraw();
  } else {
    // rect or circle — just redraw for preview
    redraw();
  }
}

function onDragEnd() {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  if (!isDrawing) return;
  isDrawing = false;

  if (currentTool === 'brush') {
    redraw();
  } else if (currentTool === 'lasso') {
    if (lassoPath.length >= 3) {
      fillLassoMask();
    }
    lassoPath = [];
    redraw();
  } else if (currentTool === 'rect') {
    if (shapeStart && cursorX !== null) {
      fillRectMask(shapeStart.x, shapeStart.y, cursorX, cursorY);
    }
    shapeStart = null;
    redraw();
  } else if (currentTool === 'circle') {
    if (shapeStart && cursorX !== null) {
      fillCircleMask(shapeStart.x, shapeStart.y, cursorX, cursorY);
    }
    shapeStart = null;
    redraw();
  }
}

canvas.addEventListener('mousedown', (e) => {
  if (!imageLoaded || inpaintInFlight) return;
  const { x, y } = canvasCoords(e);

  // Save undo snapshot for all tools
  undoStack.push(imageCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE));
  if (undoStack.length > 20) undoStack.shift();
  undoBtn.disabled = false;
  redoStack = [];
  redoBtn.disabled = true;

  if (currentTool === 'fill') {
    // Fill is a single-click tool — no drag needed
    console.log(`[fill] mousedown at (${x}, ${y}), tolerance=${fillTolerance}, imageLoaded=${imageLoaded}`);
    floodFillMask(x, y, fillTolerance);
    redraw();
    return;
  }

  isDrawing = true;

  if (currentTool === 'brush') {
    paintMask(x, y);
  } else if (currentTool === 'lasso') {
    lassoPath = [{ x, y }];
    redraw();
  } else if (currentTool === 'rect' || currentTool === 'circle') {
    shapeStart = { x, y };
    redraw();
  }

  // Track mouse globally so dragging outside the canvas still works
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
});

canvas.addEventListener('mousemove', (e) => {
  if (isDrawing) return; // handled by document-level listener
  const { x, y } = canvasCoords(e);
  cursorX = x;
  cursorY = y;
  redraw();
});

canvas.addEventListener('mouseleave', () => {
  if (!isDrawing) {
    cursorX = null;
    cursorY = null;
    redraw();
  }
  // When drawing, document-level listeners continue tracking
});

function paintMask(x, y) {
  maskCtx.fillStyle = '#ffffff';
  maskCtx.beginPath();
  maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
  maskCtx.fill();
  redraw();
}

function fillLassoMask() {
  if (lassoPath.length < 3) return;
  maskCtx.fillStyle = '#ffffff';
  maskCtx.beginPath();
  maskCtx.moveTo(lassoPath[0].x, lassoPath[0].y);
  for (let i = 1; i < lassoPath.length; i++) {
    maskCtx.lineTo(lassoPath[i].x, lassoPath[i].y);
  }
  maskCtx.closePath();
  maskCtx.fill();
}

function fillRectMask(x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (w < 2 || h < 2) return;
  maskCtx.fillStyle = '#ffffff';
  maskCtx.fillRect(x, y, w, h);
}

function fillCircleMask(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = Math.abs(x2 - x1) / 2;
  const ry = Math.abs(y2 - y1) / 2;
  if (rx < 2 || ry < 2) return;
  maskCtx.fillStyle = '#ffffff';
  maskCtx.beginPath();
  maskCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  maskCtx.fill();
}

function floodFillMask(startX, startY, tolerance) {
  console.log(`[floodFillMask] start=(${startX}, ${startY}), tolerance=${tolerance}`);
  const imgData = imageCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE);
  const pixels = imgData.data;
  const maskData = maskCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE);
  const mask = maskData.data;

  const idx = (startY * IMG_SIZE + startX) * 4;
  const targetR = pixels[idx];
  const targetG = pixels[idx + 1];
  const targetB = pixels[idx + 2];
  console.log(`[floodFillMask] target color: rgb(${targetR}, ${targetG}, ${targetB})`);

  const visited = new Uint8Array(IMG_SIZE * IMG_SIZE);
  const stack = [startX + startY * IMG_SIZE];
  visited[startX + startY * IMG_SIZE] = 1;
  let filledCount = 0;

  while (stack.length > 0) {
    const pos = stack.pop();
    const px = pos % IMG_SIZE;
    const py = (pos - px) / IMG_SIZE;
    const pi = pos * 4;

    // Mark this pixel in the mask
    mask[pi] = 255;
    mask[pi + 1] = 255;
    mask[pi + 2] = 255;
    mask[pi + 3] = 255;
    filledCount++;

    // Check 4 neighbors
    const neighbors = [];
    if (px > 0) neighbors.push(pos - 1);
    if (px < IMG_SIZE - 1) neighbors.push(pos + 1);
    if (py > 0) neighbors.push(pos - IMG_SIZE);
    if (py < IMG_SIZE - 1) neighbors.push(pos + IMG_SIZE);

    for (const npos of neighbors) {
      if (visited[npos]) continue;
      visited[npos] = 1;
      const ni = npos * 4;
      const dr = Math.abs(pixels[ni] - targetR);
      const dg = Math.abs(pixels[ni + 1] - targetG);
      const db = Math.abs(pixels[ni + 2] - targetB);
      if (dr <= tolerance && dg <= tolerance && db <= tolerance) {
        stack.push(npos);
      }
    }
  }

  console.log(`[floodFillMask] filled ${filledCount} pixels`);
  maskCtx.putImageData(maskData, 0, 0);
}

// --- Select All ---
selectAllBtn.addEventListener('click', () => {
  console.log(`[selectAll] clicked, imageLoaded=${imageLoaded}, inpaintInFlight=${inpaintInFlight}, disabled=${selectAllBtn.disabled}`);
  if (!imageLoaded || inpaintInFlight) {
    console.log('[selectAll] early return — imageLoaded or inpaintInFlight guard');
    return;
  }
  undoStack.push(imageCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE));
  if (undoStack.length > 20) undoStack.shift();
  undoBtn.disabled = false;
  redoStack = [];
  redoBtn.disabled = true;
  maskCtx.fillStyle = '#ffffff';
  maskCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
  console.log('[selectAll] mask filled white, calling redraw');
  redraw();
});

// Track whether the mask has content (avoid scanning every redraw)
let maskHasContent = false;

function checkMaskContent() {
  const d = maskCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE).data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 200) { maskHasContent = true; return; }
  }
  maskHasContent = false;
}

function hasMaskContent() {
  return maskHasContent;
}

// --- Execute button ---
const executeBtn = document.getElementById('execute-btn');
const abortBtn = document.getElementById('abort-btn');

executeBtn.addEventListener('click', () => {
  if (!imageLoaded || inpaintInFlight) return;
  runInpaint();
});

abortBtn.addEventListener('click', () => {
  if (!inpaintInFlight || !inpaintController) return;
  inpaintAbortedByUser = true;
  inpaintController.abort();
});

function updateExecuteBtn() {
  executeBtn.disabled = !imageLoaded || inpaintInFlight || !hasMaskContent();
}

function redraw() {
  checkMaskContent();
  updateExecuteBtn();
  // Always start by drawing the clean image
  ctx.clearRect(0, 0, IMG_SIZE, IMG_SIZE);
  ctx.drawImage(imageCanvas, 0, 0);

  // Red overlay on masked areas while drawing, has selection, or processing
  if (isDrawing || inpaintInFlight || hasMaskContent()) {
    const maskData = maskCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE);
    const hasMask = maskData.data.some((v, i) => i % 4 === 0 && v > 200);
    if (hasMask) {
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
  }

  // Lasso preview path
  if (currentTool === 'lasso' && isDrawing && lassoPath.length > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(lassoPath[0].x, lassoPath[0].y);
    for (let i = 1; i < lassoPath.length; i++) {
      ctx.lineTo(lassoPath[i].x, lassoPath[i].y);
    }
    // Draw closure line back to start
    ctx.lineTo(lassoPath[0].x, lassoPath[0].y);
    ctx.stroke();
    ctx.restore();
  }

  // Rectangle preview
  if (currentTool === 'rect' && isDrawing && shapeStart && cursorX !== null) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)';
    ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    const x = Math.min(shapeStart.x, cursorX);
    const y = Math.min(shapeStart.y, cursorY);
    const w = Math.abs(cursorX - shapeStart.x);
    const h = Math.abs(cursorY - shapeStart.y);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  // Circle/ellipse preview
  if (currentTool === 'circle' && isDrawing && shapeStart && cursorX !== null) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)';
    ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    const cx = (shapeStart.x + cursorX) / 2;
    const cy = (shapeStart.y + cursorY) / 2;
    const rx = Math.abs(cursorX - shapeStart.x) / 2;
    const ry = Math.abs(cursorY - shapeStart.y) / 2;
    if (rx > 0 && ry > 0) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Cursor preview
  if (cursorX !== null && cursorY !== null && imageLoaded) {
    ctx.save();
    if (currentTool === 'brush') {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cursorX, cursorY, brushSize / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(cursorX, cursorY, 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Crosshair cursor for lasso, rect, circle
      const armLen = 10;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cursorX - armLen, cursorY);
      ctx.lineTo(cursorX + armLen, cursorY);
      ctx.moveTo(cursorX, cursorY - armLen);
      ctx.lineTo(cursorX, cursorY + armLen);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// --- Inpaint ---

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

  // Cap at full image size
  size = Math.min(size, IMG_SIZE);

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

function canvasToBase64(cvs) {
  return cvs.toDataURL('image/png').split(',')[1];
}


async function runInpaint() {
  if (!imageLoaded || inpaintInFlight) return;
  inpaintInFlight = true;

  // Snapshot the scroll position so we can restore it after the async inpaint.
  // DOM changes during overlay show/hide can silently shift the scroll offset.
  const savedScrollLeft = contentArea.scrollLeft;
  const savedScrollTop = contentArea.scrollTop;

  setStatus('Inpainting...', true);
  imageFrame.classList.add('pulsing');
  inpaintOverlay.style.display = 'flex';
  toolbar.classList.add('inpaint-disabled');
  toolbarRow2.classList.add('inpaint-disabled');

  const start = performance.now();

  try {
    // Find mask bounds and crop to just the masked region
    const bounds = getMaskBounds();

    let imageB64, maskB64, sendW, sendH;

    if (bounds) {
      // Cropped mode — send only the region around the mask
      const croppedImage = cropCanvas(imageCanvas, bounds);
      const croppedMask = cropCanvas(maskCanvas, bounds);
      console.log(`Crop: ${bounds.w}x${bounds.h} at (${bounds.x},${bounds.y}) vs full ${IMG_SIZE}x${IMG_SIZE}`);
      imageB64 = canvasToBase64(croppedImage);
      maskB64 = canvasToBase64(croppedMask);
      sendW = bounds.w;
      sendH = bounds.h;
    } else {
      // Full image mode — mask too large or covers most of the image
      console.log(`Sending full ${IMG_SIZE}x${IMG_SIZE} image`);
      imageB64 = canvasToBase64(imageCanvas);
      maskB64 = canvasToBase64(maskCanvas);
      sendW = IMG_SIZE;
      sendH = IMG_SIZE;
    }

    // Get the backend URL from the health endpoint.
    // The model must already be loaded — the startup overlay ensures this.
    // We look for any model entry that has a backend_url, regardless of type name.
    const healthRes = await fetch('http://localhost:8000/api/v1/health');
    const health = await healthRes.json();
    const imageModel = health.all_models_loaded?.find(m => m.type === 'image');
    if (!imageModel) {
      throw new Error('Image model is not ready. Please wait for the model to finish loading.');
    }
    const backendUrl = imageModel.backend_url.replace(/\/v1$/, '');

    // Use /sdapi/v1/img2img which properly supports mask-based inpainting
    // (the OpenAI /v1/images/edits endpoint uses EDIT mode which ignores masks)
    const payload = {
      prompt: oneTimePrompt || promptInput.value || 'seamless background fill',
      init_images: [imageB64],
      mask: maskB64,
      denoising_strength: parseFloat(strengthSlider.value),
      steps: parseInt(stepsSlider.value, 10),
      cfg_scale: 1.0,
      width: sendW,
      height: sendH,
      batch_size: 1,
    };

    console.log(`[inpaint] Sending ${sendW}x${sendH} to ${backendUrl}`);
    inpaintController = new AbortController();
    inpaintAbortedByUser = false;
    const timeout = setTimeout(() => inpaintController.abort(), 300000); // 5 min timeout
    const res = await fetch(`${backendUrl}/sdapi/v1/img2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: inpaintController.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const b64 = json.images?.[0] || json.data?.[0]?.b64_json;
    if (!b64) throw new Error('No image data in server response');

    const latency = (performance.now() - start) / 1000;
    await applyResult(b64, bounds);
    setStatus('Ready', false, latency);
    // Reset mask on success
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
  } catch (err) {
    console.error('Inpaint error:', err);
    // err may be a DOM Event (from img.onerror) rather than an Error instance,
    // so guard against missing .message before calling .includes()
    const msg = err instanceof Error ? err.message : String(err);
    if (err.name === 'AbortError' && inpaintAbortedByUser) {
      // User cancelled — revert to the snapshot taken before inpaint started
      if (undoStack.length > 0) {
        const prev = undoStack.pop();
        imageCtx.putImageData(prev, 0, 0);
        undoBtn.disabled = undoStack.length === 0;
      }
      setStatus('Cancelled');
    } else if (err.name === 'AbortError') {
      setStatus('Inpaint timed out — try a smaller selection or fewer steps');
    } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      setStatus('Connection Error: Is Lemonade Server running?');
      waitForServerReady();
    } else {
      setStatus(`Error: ${msg}`);
    }
    // Preserve mask on error so the user can retry
  } finally {
    inpaintInFlight = false;
    inpaintController = null;
    oneTimePrompt = null;
    imageFrame.classList.remove('pulsing');
    inpaintOverlay.style.display = 'none';
    toolbar.classList.remove('inpaint-disabled');
    toolbarRow2.classList.remove('inpaint-disabled');
    redraw();
    // Restore scroll position after all layout changes settle
    contentArea.scrollLeft = savedScrollLeft;
    contentArea.scrollTop = savedScrollTop;
  }
}

async function applyResult(b64, bounds) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = 'data:image/png;base64,' + b64;
  });

  // Work in backing-store coordinates for the region being updated
  const rx = bounds ? bounds.x : 0;
  const ry = bounds ? bounds.y : 0;
  const rw = bounds ? bounds.w : IMG_SIZE;
  const rh = bounds ? bounds.h : IMG_SIZE;

  // Read original pixels and the mask for this region.
  // The mask is still intact here — it gets reset below after compositing.
  const origData   = imageCtx.getImageData(rx, ry, rw, rh);
  const maskData   = maskCtx.getImageData(rx, ry, rw, rh);

  // Decode the model result into pixel data (scale to region size if needed)
  const tmpCanvas  = document.createElement('canvas');
  tmpCanvas.width  = rw;
  tmpCanvas.height = rh;
  tmpCanvas.getContext('2d').drawImage(img, 0, 0, rw, rh);
  const resultData = tmpCanvas.getContext('2d').getImageData(0, 0, rw, rh);

  // Composite: use result pixels only where the mask is white (>200).
  // Everywhere the mask is black, keep the original pixel unchanged.
  // This prevents model drift in unmasked areas from bleeding into the image.
  const composited = new ImageData(rw, rh);
  for (let i = 0; i < maskData.data.length; i += 4) {
    const src = maskData.data[i] > 200 ? resultData.data : origData.data;
    composited.data[i]     = src[i];
    composited.data[i + 1] = src[i + 1];
    composited.data[i + 2] = src[i + 2];
    composited.data[i + 3] = src[i + 3];
  }
  imageCtx.putImageData(composited, rx, ry);

  // Reset mask
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);

  imageModified = true;
  redraw();
}

// --- Save As ---
saveBtn.addEventListener('click', async () => {
  if (!imageLoaded) return;
  const dataURL = imageCanvas.toDataURL('image/png');
  const saved = await window.electronAPI.saveFileDialog(dataURL);
  if (saved) {
    imageModified = false;
    setStatus(`Saved: ${saved}`);
  }
});

// --- Undo ---
undoBtn.addEventListener('click', () => {
  if (undoStack.length === 0) return;
  const current = imageCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE);
  const prev = undoStack.pop();
  // Only offer redo if the image actually changed (not just a mask/selection)
  const imageChanged = !current.data.every((v, i) => v === prev.data[i]);
  if (imageChanged) {
    redoStack.push(current);
    if (redoStack.length > 20) redoStack.shift();
    redoBtn.disabled = false;
  }
  imageCtx.putImageData(prev, 0, 0);
  undoBtn.disabled = undoStack.length === 0;
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
  imageModified = true;
  redraw();
});

// --- Redo ---
redoBtn.addEventListener('click', () => {
  if (redoStack.length === 0) return;
  undoStack.push(imageCtx.getImageData(0, 0, IMG_SIZE, IMG_SIZE));
  if (undoStack.length > 20) undoStack.shift();
  undoBtn.disabled = false;
  const next = redoStack.pop();
  imageCtx.putImageData(next, 0, 0);
  redoBtn.disabled = redoStack.length === 0;
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
  imageModified = true;
  redraw();
});

// --- Reset ---
document.getElementById('reset-btn').addEventListener('click', () => {
  if (!confirm('Reset the canvas? This will discard all changes.')) return;
  imageCtx.clearRect(0, 0, IMG_SIZE, IMG_SIZE);
  ctx.clearRect(0, 0, IMG_SIZE, IMG_SIZE);
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, IMG_SIZE, IMG_SIZE);
  undoStack = [];
  redoStack = [];
  undoBtn.disabled = true;
  redoBtn.disabled = true;
  saveBtn.disabled = true;
  selectAllBtn.disabled = true;
  imageLoaded = false;
  imageModified = false;
  canvas.style.cursor = 'pointer';
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
document.getElementById('win-close').addEventListener('click', () => handleCloseRequest());

// Show exit dialog or close immediately based on unsaved state
function handleCloseRequest() {
  if (imageLoaded && imageModified) {
    document.getElementById('exit-dialog').style.display = 'flex';
  } else {
    window.electronAPI.confirmClose();
  }
}

// System-level close (Alt+F4, etc.) is routed through main.js → 'check-close' IPC
window.electronAPI.onCheckClose(() => handleCloseRequest());

// --- Exit dialog buttons ---
document.getElementById('exit-save-btn').addEventListener('click', async () => {
  document.getElementById('exit-dialog').style.display = 'none';
  const dataURL = imageCanvas.toDataURL('image/png');
  const saved = await window.electronAPI.saveFileDialog(dataURL);
  if (saved) {
    imageModified = false;
    window.electronAPI.confirmClose();
  } else {
    // User cancelled the save dialog — keep the app open
    document.getElementById('exit-dialog').style.display = 'flex';
  }
});

document.getElementById('exit-discard-btn').addEventListener('click', () => {
  window.electronAPI.confirmClose();
});

document.getElementById('exit-cancel-btn').addEventListener('click', () => {
  document.getElementById('exit-dialog').style.display = 'none';
});

// --- Server health polling & progress overlay ---
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function showOverlay(text) {
  overlayStatusText.textContent = text;
  downloadProgress.style.display = 'none';
  statusOverlay.style.display = 'flex';
}

function showDownloadProgress(model, status, completed, total) {
  statusOverlay.style.display = 'flex';
  overlayStatusText.textContent = status || `Downloading ${model}…`;
  downloadProgress.style.display = 'block';

  if (total > 0) {
    const pct = Math.round((completed / total) * 100);
    downloadBarFill.classList.remove('indeterminate');
    downloadBarFill.style.width = pct + '%';
    downloadDetail.textContent = `${formatBytes(completed)} / ${formatBytes(total)} (${pct}%)`;
  } else {
    downloadBarFill.classList.add('indeterminate');
    downloadBarFill.style.width = '';
    downloadDetail.textContent = completed > 0 ? formatBytes(completed) : '';
  }
}

function hideDownloadProgress() {
  downloadProgress.style.display = 'none';
}

function hideOverlay() {
  statusOverlay.style.display = 'none';
  hideDownloadProgress();
}

// Track whether a download is in progress so health polling doesn't hide it
let downloadInProgress = false;
let healthPollingActive = false;

function connectLogStream() {
  let eventSource;
  try {
    eventSource = new EventSource('http://localhost:8000/api/v1/logs/stream');
  } catch (e) {
    return;
  }

  eventSource.onmessage = (event) => {
    const line = event.data;

    // Match "[FLM]  Overall progress: 45%" or "Progress: 45%"
    const pctMatch = line.match(/(?:Overall progress|Progress):\s*(\d+(?:\.\d+)?)%/i);
    if (pctMatch) {
      downloadInProgress = true;
      const pct = parseFloat(pctMatch[1]);
      showDownloadProgress('model', 'Downloading model…', pct, 100);
      return;
    }

    // Match "[FLM]  Downloading: filename" or "[ModelManager] Downloading: model"
    if (/\bDownloading[:\s]/i.test(line)) {
      downloadInProgress = true;
      const detail = line.replace(/.*\bDownloading[:\s]*/i, '').trim();
      showDownloadProgress('model', `Downloading ${detail || 'model'}…`, 0, 0);
      return;
    }

    // Match "[ModelManager] Downloaded: model" — download finished, waiting for load
    if (/\bDownloaded[:\s]/i.test(line)) {
      downloadInProgress = false;
      showOverlay('Loading model…');
      // Start polling to detect when model is fully loaded
      if (!healthPollingActive) waitForServerReady();
      return;
    }
  };

  // Reconnect on error (server restart, etc.)
  eventSource.onerror = () => {
    eventSource.close();
    setTimeout(connectLogStream, 2000);
  };
}

async function triggerImageModelLoad() {
  try {
    const modelsRes = await fetch('http://localhost:8000/api/v1/models');
    const modelsData = await modelsRes.json();
    const imageModel = modelsData.data?.find(m => m.labels?.includes('image') && m.downloaded);
    if (!imageModel) return;
    // Fire generation request to trigger model loading — result ignored, health polling detects readiness
    fetch('http://localhost:8000/api/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: imageModel.id, prompt: 'load', n: 1, size: '256x256' }),
    }).catch(() => {});
  } catch (e) {
    // Ignored — health polling will retry
  }
}

async function waitForServerReady() {
  if (healthPollingActive) return;
  healthPollingActive = true;
  let imageModelLoadTriggered = false;
  showOverlay('Connecting to server…');

  while (true) {
    try {
      const res = await fetch('http://localhost:8000/api/v1/health');
      const data = await res.json();

      if (data.status === 'ok' && !downloadInProgress) {
        const imageModel = data.all_models_loaded?.find(m => m.type === 'image');
        if (imageModel) {
          hideOverlay();
          setStatus('Ready');
          healthPollingActive = false;
          return;
        }
        // Server is ready but no image model loaded yet — trigger loading once
        if (!imageModelLoadTriggered) {
          imageModelLoadTriggered = true;
          triggerImageModelLoad();
        }
        showOverlay('Loading model…');
      } else if (data.status === 'ok' && downloadInProgress) {
        // Server is up but a download is active — overlay managed by SSE handler
      } else if (data.error) {
        showOverlay(`Server error: ${JSON.stringify(data.error)}`);
      } else {
        showOverlay('Waiting for server…');
      }
    } catch (e) {
      showOverlay('Connecting to server…');
    }

    await new Promise(r => setTimeout(r, 1000));
  }
}

// Start SSE log listener (runs for the lifetime of the app)
connectLogStream();
// Poll health until server is ready
waitForServerReady();

// --- Drag and drop ---
contentArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  contentArea.classList.add('drag-hover');
});

// Only remove the highlight when the drag leaves the content area entirely
// (not when moving over a child element, which would cause flickering)
contentArea.addEventListener('dragleave', (e) => {
  if (!contentArea.contains(e.relatedTarget)) {
    contentArea.classList.remove('drag-hover');
  }
});

contentArea.addEventListener('drop', (e) => {
  e.preventDefault();
  contentArea.classList.remove('drag-hover');
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  // webUtils.getPathForFile() is the correct Electron 32+ API for getting
  // the native file path from a File object with context isolation enabled
  const filePath = window.electronAPI.getPathForFile(file);
  if (!filePath) return;

  if (imageLoaded) {
    // Superimpose mode - get drop coordinates in canvas space
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    // Convert CSS coordinates to canvas backing-store coordinates
    const scale = canvas.width / canvas.clientWidth;
    const canvasX = Math.round(cssX * scale);
    const canvasY = Math.round(cssY * scale);

    showSuperimposePromptDialog(filePath, canvasX, canvasY);
  } else {
    // Load base image mode
    loadImage(filePath);
  }
});
