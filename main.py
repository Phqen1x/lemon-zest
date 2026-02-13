import gi
import requests
import base64
import threading
import time
from io import BytesIO
from PIL import Image

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Gtk, Adw, Gdk, Cairo, GLib, Gio


class TurboEraser(Adw.Application):
    def __init__(self, **kwargs):
        super().__init__(application_id="com.ubuntu.TurboEraser", **kwargs)
        self.brush_size = 30
        self.debounce_id = 0
        self.undo_stack = []
        self.image_surface = None
        self.mask_surface = None
        self.connect("activate", self.on_activate)

    def on_activate(self, app):
        self.win = Adw.ApplicationWindow(application=app)
        self.win.set_default_size(900, 750)
        self.win.set_title("Turbo Eraser")

        main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)

        # Header
        header = Adw.HeaderBar()
        open_btn = Gtk.Button(
            icon_name="document-open-symbolic", tooltip_text="Open Image"
        )
        open_btn.connect("clicked", self.on_open_clicked)
        header.pack_start(open_btn)

        self.undo_btn = Gtk.Button(icon_name="edit-undo-symbolic")
        self.undo_btn.set_sensitive(False)
        self.undo_btn.connect("clicked", self.on_undo_clicked)
        header.pack_start(self.undo_btn)

        self.slider = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 5, 150, 5)
        self.slider.set_value(self.brush_size)
        self.slider.connect(
            "value-changed", lambda s: setattr(self, "brush_size", s.get_value())
        )
        header.pack_end(self.slider)
        main_box.append(header)

        # Canvas Overlay
        overlay = Gtk.Overlay()
        self.canvas = Gtk.DrawingArea()
        self.canvas.set_vexpand(True)
        self.canvas.set_draw_func(self.draw_cb)
        overlay.set_child(self.canvas)
        main_box.append(overlay)

        # MODERN STATUS BAR
        self.status_bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        self.status_bar.add_css_class("toolbar")  # Gives it a subtle background
        self.status_bar.set_margin_start(12)
        self.status_bar.set_margin_end(12)
        self.status_bar.set_margin_top(6)
        self.status_bar.set_margin_bottom(6)

        self.status_label = Gtk.Label(label="Ready")
        self.latency_label = Gtk.Label(label="")
        self.latency_label.add_css_class("dim-label")

        self.status_spinner = Gtk.Spinner()

        self.status_bar.append(self.status_spinner)
        self.status_bar.append(self.status_label)
        self.status_bar.append(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL))
        self.status_bar.append(self.latency_label)

        main_box.append(self.status_bar)

        # Interaction
        drag = Gtk.GestureDrag()
        drag.connect("drag-begin", self.on_stroke_begin)
        drag.connect("drag-update", self.on_stroke_update)
        drag.connect("drag-end", self.on_stroke_end)
        self.canvas.add_controller(drag)

        self.win.set_child(main_box)
        self.win.present()

    # --- Logic ---
    def update_status(self, text, spinning=False, latency=None):
        self.status_label.set_text(text)
        self.status_spinner.set_spinning(spinning)
        self.status_spinner.set_visible(spinning)
        if latency:
            self.latency_label.set_text(f"{latency:.2f}s")
        else:
            self.latency_label.set_text("")

    def on_stroke_end(self, gesture, x, y):
        if self.debounce_id > 0:
            GLib.source_remove(self.debounce_id)
        self.debounce_id = GLib.timeout_add(400, self.start_inpaint_thread)

    def start_inpaint_thread(self):
        self.debounce_id = 0
        self.update_status("Processing...", spinning=True)

        img_b64 = self.surface_to_b64(self.image_surface)
        mask_b64 = self.surface_to_b64(self.mask_surface)

        thread = threading.Thread(target=self.run_inference, args=(img_b64, mask_b64))
        thread.daemon = True
        thread.start()
        return False

    def run_inference(self, img_b64, mask_b64):
        start_time = time.time()
        payload = {
            "model": "sd-turbo",
            "prompt": "clean background",
            "image": f"data:image/png;base64,{img_b64}",
            "mask": f"data:image/png;base64,{mask_b64}",
        }
        try:
            r = requests.post(
                "http://localhost:8000/v1/images/edits", json=payload, timeout=15
            )
            r.raise_for_status()
            elapsed = time.time() - start_time
            new_b64 = r.json()["data"][0]["b64_json"]
            GLib.idle_add(self.apply_result, new_b64, elapsed)
        except Exception as e:
            GLib.idle_add(self.update_status, f"Error: {str(e)[:30]}", False)

    def apply_result(self, b64, elapsed):
        self.update_status("Done", False, elapsed)
        if b64:
            # (Standard image update logic from previous step)
            img_data = base64.b64decode(b64)
            loader = Gdk.PixbufLoader.new_with_type("png")
            loader.write(img_data)
            loader.close()
            self.image_surface = Gdk.cairo_surface_create_from_pixbuf(
                loader.get_pixbuf(), 1, None
            )
            self.mask_surface = Cairo.ImageSurface(Cairo.Format.RGB24, 512, 512)
            self.canvas.queue_draw()
        return False

    # ... (Include surface_to_b64 and other helper methods from previous responses)
