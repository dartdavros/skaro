"""Exportable PBR materials: no Blender-only procedural shader dependencies."""

import bpy


def linear(rgb):
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb)


def material(name, rgb, roughness=0.6, metallic=0, emission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    color = (*linear(rgb), 1)
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if emission:
        shader.inputs["Emission Color"].default_value = color
        shader.inputs["Emission Strength"].default_value = emission
    return mat


def image_node(mat, path):
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(str(path), check_existing=True)
    node.interpolation = "Linear"
    return node


def painted(name, directory):
    mat = material(name, (1, 1, 1), 0.76)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    color = image_node(mat, directory / "paint-color.png")
    mat.node_tree.links.new(color.outputs["Color"], shader.inputs["Base Color"])
    bump = image_node(mat, directory / "paint-normal.png")
    bump.image.colorspace_settings.name = "Non-Color"
    normal = mat.node_tree.nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.16
    mat.node_tree.links.new(bump.outputs["Color"], normal.inputs["Color"])
    mat.node_tree.links.new(normal.outputs["Normal"], shader.inputs["Normal"])
    rough = image_node(mat, directory / "paint-roughness.png")
    rough.image.colorspace_settings.name = "Non-Color"
    mat.node_tree.links.new(rough.outputs["Color"], shader.inputs["Roughness"])
    return mat


def printed(name, path, emission=0):
    mat = material(name, (1, 1, 1), 0.78)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    tex = image_node(mat, path)
    mat.node_tree.links.new(tex.outputs["Color"], shader.inputs["Base Color"])
    if emission:
        mat.node_tree.links.new(tex.outputs["Color"], shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value = emission
    return mat


def make_materials(directory):
    paint = painted("Paint / weathered 2005 blue", directory)
    # Glass remains opaque for stable whole-body fading in the later animation.
    # Surface roughness and its texture reproduce the cloudy prop windows.
    window = printed("Windows / textured cloudy glass", directory / "window.png", 0.1)
    window.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value = 0.34
    return {
        "paint": paint,
        "recess": material("Paint / shadowed joints", (0.055, 0.095, 0.13), 0.92),
        "window": window,
        "sign": printed("Signs / warm ivory lettering", directory / "police-sign.png", 0.22),
        "notice": printed("Door / telephone instructions", directory / "telephone.png"),
        "metal": material("Hardware / aged silver", (0.44, 0.48, 0.47), 0.38, 0.76),
        "dark_metal": material("Lamp / dark blue metal", (0.105, 0.17, 0.21), 0.48, 0.3),
        "lamp": material("Lamp_Glass", (0.77, 0.88, 0.89), 0.24, emission=0.65),
    }
