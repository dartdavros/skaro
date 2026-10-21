"""Build the model with Blender, apply geometry, and export a self-contained GLB."""

import json
from pathlib import Path
import sys

import bpy

SOURCE = Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE))

from body import build_body, build_lamp
from geometry import empty
from materials import make_materials
from walls import build_walls


def join_meshes(objects, name, parent):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    triangulate = obj.modifiers.new("Portable tangent-space triangulation", "TRIANGULATE")
    triangulate.quad_method = "FIXED"
    bpy.ops.object.modifier_apply(modifier=triangulate.name)
    # Store the pivot at the geometric centre, suitable for later flight rotation.
    bpy.context.scene.cursor.location = (0, 0, 1.51)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    obj.location.z -= 1.51
    return obj


def build():
    destination = SOURCE.parent
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    root = empty("TARDIS_2005")
    root["era"] = "Ninth and Tenth Doctors / 2005 exterior"
    root["reference"] = "Visual reconstruction from screen references; not a measured prop replica"
    root["units"] = "metres"
    mats = make_materials(destination / "textures")
    body = build_body(root, mats)
    build_walls(body, mats)
    lamp = build_lamp(root, mats)
    join_meshes([obj for obj in body.children if obj.type == "MESH"], "Body_Mesh", body)
    housing = [obj for obj in lamp.children if obj.type == "MESH" and obj.name != "Lamp_Glass"]
    join_meshes(housing, "Lamp_Housing", lamp)
    glass = bpy.data.objects["Lamp_Glass"]
    join_meshes([glass], "Lamp_Glass", lamp)
    root["fade_targets"] = "Body_Mesh,Lamp_Housing,Lamp_Glass"
    root["lamp_material"] = "Lamp_Glass"
    for image in bpy.data.images:
        if image.source == "FILE":
            image.pack()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [root, body, lamp, *body.children, *lamp.children]:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(destination / "tardis-2005.glb"), export_format="GLB",
        use_selection=True, export_yup=True, export_apply=True,
        export_animations=False, export_cameras=False, export_lights=False,
        export_extras=True, export_image_format="AUTO",
        export_tangents=True,
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(destination / "tardis-2005.blend"))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    manifest = {
        "model": "tardis-2005.glb", "era": "2005 / Ninth and Tenth Doctors",
        "triangles": sum(len(poly.vertices) - 2 for obj in meshes for poly in obj.data.polygons),
        "meshObjects": [obj.name for obj in meshes],
        "glbBytes": (destination / "tardis-2005.glb").stat().st_size,
        "animation": False, "pivot": "bounding box centre",
        "gltfCoordinates": "Y up; front +Z; metres",
        "referenceAccuracy": "visual reconstruction, dimensions not verified against prop measurements",
    }
    (destination / "model-info.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("TARDIS_BUILD", json.dumps(manifest))


if __name__ == "__main__":
    build()
