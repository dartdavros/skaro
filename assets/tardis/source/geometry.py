"""Small modelling primitives; Blender uses metres, Z up, front toward -Y."""

import math

import bpy
from mathutils import Vector


def finish(obj, name, material, parent=None, bevel=0):
    obj.name = name
    obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    if bevel:
        modifier = obj.modifiers.new("Soft painted edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.affect = "EDGES"
        normal = obj.modifiers.new("Face normals", "WEIGHTED_NORMAL")
        normal.keep_sharp = True
    return obj


def box(name, size, location, material, parent=None, bevel=0.002):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # World-scaled UVs keep the painted timber grain vertical on every wall.
    uv = obj.data.uv_layers.active
    for polygon in obj.data.polygons:
        for index in polygon.loop_indices:
            vertex = obj.data.vertices[obj.data.loops[index].vertex_index].co
            if abs(polygon.normal.z) > 0.5:
                u, v = vertex.x + location[0], vertex.y + location[1]
            else:
                u = vertex.x + location[0] if abs(polygon.normal.y) > 0.5 else vertex.y + location[1]
                v = vertex.z + location[2]
            uv.data[index].uv = (u * 1.7, v * 0.72)
    return finish(obj, name, material, parent, bevel)


def cylinder(name, radius, depth, location, material, parent=None, vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = finish(bpy.context.object, name, material, parent, 0.001)
    for polygon in obj.data.polygons:
        polygon.use_smooth = abs(polygon.normal.z) < 0.5
    return obj


def frustum(name, bottom, top, z0, z1, material, parent=None):
    vertices = [(x * width / 2, y * width / 2, z)
                for width, z in [(bottom, z0), (top, z1)]
                for x, y in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.uv_layers.new()
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            mesh.uv_layers.active.data[loop_index].uv = (co.x * 2, co.y * 2)
    return finish(obj, name, material, parent, 0.002)


def decal(name, width, height, location, material, parent=None):
    """Vertical plane facing -Y, with conventional top-left image orientation."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(-width / 2, 0, -height / 2), (width / 2, 0, -height / 2),
                     (width / 2, 0, height / 2), (-width / 2, 0, height / 2)],
                    [], [(0, 1, 2, 3)])
    mesh.uv_layers.new()
    for index, uv in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        mesh.uv_layers.active.data[index].uv = uv
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    return finish(obj, name, material, parent)


def bar_between(name, a, b, radius, material, parent=None):
    start, end = Vector(a), Vector(b)
    obj = cylinder(name, radius, (end - start).length, (start + end) / 2, material, parent, 12)
    obj.rotation_euler = (end - start).to_track_quat("Z", "Y").to_euler()
    return obj


def empty(name, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    return obj


def rotate_wall(objects, angle):
    """Rotate geometry AND positions so all four faces share one construction."""
    c, s = math.cos(angle), math.sin(angle)
    for obj in objects:
        x, y = obj.location.x, obj.location.y
        obj.location.x, obj.location.y = c * x - s * y, s * x + c * y
        obj.rotation_euler.z += angle
