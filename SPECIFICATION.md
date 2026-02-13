# Project Specification: Turbo Eraser

## 1. Project Overview
Turbo Eraser is a high-performance desktop application for Ubuntu designed to provide a "Magic Eraser" experience using local AI. 

## 2. Requirements
### Functional
* **Image Loading:** Load local images via Gtk.FileDialog.
* **Asynchronous Processing:** Non-blocking inference using Python threading.
* **Feedback Loop:** A footer-based status bar displaying server status and request latency.

### Technical
* **Frontend:** GTK4 / Libadwaita.
* **Backend:** Lemonade Server (SD-Turbo).
* **Communication:** JSON-over-HTTP (REST).

## 3. Implementation Plan
### Phase 1: Core Graphics (Complete)
* [x] Cairo canvas with masking.
* [x] Undo stack (10 states).

### Phase 2: Asynchronous Pipeline (Complete)
* [x] Background threading with `GLib.idle_add`.
* [x] Modern Status Bar with spinner and latency timer.

### Phase 3: Advanced Optimization (Planned)
* [ ] GPU VRAM monitoring in the status bar.
* [ ] Brush hardness/softness settings.

## 4. Testing Plan
* **Latency Accuracy:** Compare server-side logs with the status bar timer.
* **Thread Safety:** Stress test by opening the file picker while an AI process is running.
