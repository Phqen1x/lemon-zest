# Turbo Eraser

A real-time object removal tool built with Python, GTK4, and Libadwaita. It utilizes the **SD-Turbo** model served via **Lemonade Server** for near-instant generative inpainting.

## Features
* **Real-time Inpainting:** Automated removal triggered 300ms after brush release.
* **Modern UI:** Built with Libadwaita for a native Ubuntu experience.
* **Undo Support:** Revert unwanted AI generations instantly.
* **Dynamic Brush:** Adjustable brush size for precision or broad strokes.

## Prerequisites
1.  **Lemonade Server:** [Install Lemonade](https://github.com/lemonade-adaptive/lemonade)
2.  **Model:** Run `lemonade run sd-turbo` on port 8000.
3.  **Python Deps:** `pip install requests Pillow PyGObject`

## Usage
1. Start the Lemonade Server.
2. Run `python main.py`.
3. Open an image, paint over an object with the red brush, and release to erase.
