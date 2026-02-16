# Lemon Zest

Lemon Zest is an Electron-based tool for local, AI-powered object removal. Using **Flux-2-Klein-4B** on a **Lemonade Server**, it provides a near-instant "Magic Eraser" experience.

## Key Features
* **Yellow Lemonade Theme:** Custom frameless window with yellow accent UI.
* **Crop-to-Mask Optimization:** Only the masked region is sent for inference, significantly reducing processing time for small edits.
* **Guide Overlay:** Helpful instructions for new users that disappear when an image is loaded.
* **Full Undo/Reset:** Quickly revert or clear your session.

## Setup
1. **Lemonade Server:** Start with `lemonade run Flux-2-Klein-4B`.
2. **Dependencies:** `npm install`
3. **Run:** `npm start`
