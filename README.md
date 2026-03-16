# Lemon Zest

Lemon Zest is an Electron-based tool for local, AI-powered image editing. Using **Flux-2-Klein-4B** on a **Lemonade Server**, it provides a smooth and quick image editing experience.

## Key Features
* **Yellow Lemonade Theme:** Custom frameless window with yellow accent UI.
* **Custom Prompt:** Provide the AI with a custom prompt to inform how it will alter the image.
* **Crop-to-Mask Optimization:** Only the masked region is sent for inference, significantly reducing processing time for small edits.
* **Helpful Overlay:** Helpful instructions and tooltips alongside a comfortable UX help users quickly adapt.
* **Full Undo/Reset and Redo:** Quickly revert or clear your session and redo changes you've already undone.
* **Flexible Selection:** Use several tools ranging from a brush, to shapes, to fill to edit images in your own unique ways.
* **Full User Control:** Maintain complete control at all times; selections aren't sent to the AI until the execute button is pressed, and even after sending, users can abort the process.
* **Superimpose:** Drag and drop or click "superimpose" to either paste an image on top of the base image or use a custom prompt to define how the AI should integrate the image.

## Setup
1. **Lemonade Server:** Install `lemonade-server`.
2. **Load the Model:** Load with `lemonade run Flux-2-Klein-4B`. You can also enter the Lemonade GUI app and search for `Flux-2-Klein-4B` in the `models` tab, download it, then press the load button.
3. **Dependencies:** Install dependencies with `npm install`
4. **Run:** Run the application with `npm start`

## Snap
If you don't wish to run the app locally, consider downloading the snap from [snapcraft.io/lemon-zest](https://snapcraft.io/lemon-zest)!
