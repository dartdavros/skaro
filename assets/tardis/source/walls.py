"""Four panelled faces, six-pane windows, lettering and front door hardware."""

import math

import bpy

from geometry import bar_between, box, cylinder, decal, rotate_wall


def window(prefix, x, parent, mats):
    paint = mats["paint"]
    box(prefix + " / dark seal", (0.436, 0.018, 0.596), (x, -0.645, 1.803), mats["recess"], parent)
    decal(prefix + " / cloudy glass", 0.432, 0.59, (x, -0.658, 1.803), mats["window"], parent)
    for dx in [-0.231, 0.231]:
        box(prefix + f" / outer jamb {dx}", (0.027, 0.039, 0.647), (x + dx, -0.662, 1.803), paint, parent)
    for z in [1.488, 2.118]:
        box(prefix + f" / outer rail {z}", (0.475, 0.039, 0.027), (x, -0.662, z), paint, parent)
    for dx in [-0.073, 0.073]:
        box(prefix + f" / vertical mullion {dx}", (0.013, 0.023, 0.592), (x + dx, -0.675, 1.803), paint, parent, 0.001)
    box(prefix + " / horizontal mullion", (0.439, 0.023, 0.013), (x, -0.675, 1.803), paint, parent, 0.001)
    box(prefix + " / projecting sill", (0.491, 0.064, 0.028), (x, -0.665, 1.465), paint, parent)


def panels(prefix, x, parent, mats):
    paint = mats["paint"]
    box(prefix + " / door backing", (0.535, 0.045, 1.989), (x, -0.618, 1.1575), paint, parent)
    for dx in [-0.253, 0.253]:
        box(prefix + f" / stile {dx}", (0.041, 0.041, 1.989), (x + dx, -0.651, 1.1575), paint, parent)
    for row, z in enumerate([0.375, 0.801, 1.227], 1):
        box(prefix + f" / recessed panel {row}", (0.451, 0.016, 0.349), (x, -0.643, z), paint, parent, 0.001)
        # Shallow sloped moulding around every inset, including the side/back faces.
        for dx in [-0.225, 0.225]:
            obj = box(prefix + f" / panel {row} bevel {dx}", (0.014, 0.013, 0.359),
                      (x + dx, -0.656, z), paint, parent, 0.001)
            obj.rotation_euler.z = math.copysign(0.35, dx)
        for dz in [-0.18, 0.18]:
            obj = box(prefix + f" / panel {row} bevel {dz}", (0.45, 0.013, 0.014),
                      (x, -0.656, z + dz), paint, parent, 0.001)
            obj.rotation_euler.x = math.copysign(0.35, dz)
    for z in [0.177, 0.588, 1.014, 1.44, 2.14]:
        box(prefix + f" / cross rail {z}", (0.535, 0.04, 0.043), (x, -0.651, z), paint, parent)
    window(prefix + " / window", x, parent, mats)


def sign(prefix, parent, mats):
    box(prefix + " / sign recess", (1.317, 0.018, 0.168), (0, -0.738, 2.323), mats["recess"], parent)
    decal(prefix + " / POLICE PUBLIC CALL BOX", 1.282, 0.145, (0, -0.749, 2.323), mats["sign"], parent)
    for z in [2.23, 2.416]:
        box(prefix + f" / sign rail {z}", (1.376, 0.032, 0.022), (0, -0.75, z), mats["paint"], parent)
    for x in [-0.681, 0.681]:
        box(prefix + f" / sign end {x}", (0.024, 0.032, 0.198), (x, -0.75, 2.323), mats["paint"], parent)


def front_hardware(parent, mats):
    paint, metal = mats["paint"], mats["metal"]
    box("Doors / central closing strip", (0.025, 0.025, 1.984), (0.008, -0.679, 1.158), paint, parent)
    box("Telephone / hatch surround", (0.318, 0.016, 0.400), (-0.278, -0.666, 1.224), paint, parent)
    box("Telephone / ivory plaque backing", (0.285, 0.01, 0.371), (-0.278, -0.681, 1.224), mats["recess"], parent)
    decal("Telephone / instruction plaque", 0.274, 0.359, (-0.278, -0.687, 1.224), mats["notice"], parent)
    # The small hatch handle sits beside the notice, not on the opposite door.
    for z in [1.18, 1.28]:
        bar_between("Telephone / handle mount", (-0.078, -0.67, z), (-0.078, -0.711, z), 0.006, metal, parent)
    bar_between("Telephone / hatch handle", (-0.078, -0.711, 1.18), (-0.078, -0.711, 1.28), 0.006, metal, parent)
    for z in [1.13, 1.253]:
        bar_between("Door / pull mounting", (0.067, -0.68, z), (0.067, -0.721, z), 0.007, metal, parent)
    bar_between("Door / main pull", (0.067, -0.721, 1.13), (0.067, -0.721, 1.253), 0.007, metal, parent)
    lock = cylinder("Door / lock escutcheon", 0.016, 0.007, (0.067, -0.688, 1.05), metal, parent, 20)
    lock.rotation_euler.x = math.pi / 2
    box("Door / keyhole", (0.003, 0.002, 0.008), (0.067, -0.693, 1.05), mats["recess"], parent, 0.0005)


def build_walls(parent, mats):
    for name, angle in [("Front", 0), ("Right", math.pi / 2), ("Back", math.pi), ("Left", -math.pi / 2)]:
        before = set(bpy.data.objects)
        panels(name + " / left leaf", -0.278, parent, mats)
        panels(name + " / right leaf", 0.278, parent, mats)
        box(name + " / centre seam", (0.012, 0.014, 1.986), (0, -0.648, 1.158), mats["recess"], parent)
        sign(name, parent, mats)
        if name == "Front":
            front_hardware(parent, mats)
        rotate_wall(set(bpy.data.objects) - before, angle)
