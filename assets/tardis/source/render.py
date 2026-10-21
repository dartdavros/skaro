"""Render the EXPORTED model, not a higher-detail source-only version."""

from pathlib import Path
import sys

import bpy

DIRECTORY = Path(__file__).resolve().parent.parent


def area(name, location, power, size, color):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.shape, data.size, data.color = power, "DISK", size, color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (-obj.location).to_track_quat("-Z", "Y").to_euler()


def setup():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(DIRECTORY / "tardis-2005.glb"))
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.world.color = (0.22, 0.22, 0.22)
    scene.view_settings.view_transform = "AgX"
    area("Key", (3.5, -4.5, 5), 500, 4, (0.9, 0.95, 1))
    area("Fill", (-3, -2, 1.8), 230, 3, (0.82, 0.9, 1))
    area("Rim", (1.5, 3.5, 3.8), 650, 3, (1, 0.92, 0.79))
    camera = bpy.data.cameras.new("Review camera")
    obj = bpy.data.objects.new("Review camera", camera)
    bpy.context.collection.objects.link(obj)
    scene.camera = obj
    camera.type = "ORTHO"
    camera.ortho_scale = 3.68
    return scene, obj


def render():
    scene, camera = setup()
    directory = DIRECTORY / "renders"
    directory.mkdir(exist_ok=True)
    views = {
        "front": (0, -7, 0.08),
        "front-three-quarter": (4.4, -6.5, 2.7),
        "rear-three-quarter": (-4.4, 6.5, 2.5),
        "underside": (4.4, -6.5, -3.4),
    }
    requested = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for name, position in views.items():
        if requested and name not in requested:
            continue
        camera.location = position
        camera.rotation_euler = (-camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(directory / (name + ".png"))
        bpy.ops.render.render(write_still=True)
    print("Rendered exported GLB with transparent background:", directory)


if __name__ == "__main__":
    render()
