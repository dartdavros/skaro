"""Base, corner posts, entablature and shallow stepped 2005 roof."""

import math

import bpy

from geometry import box, cylinder, empty, frustum


def build_body(root, mats):
    body = empty("Body", root)
    paint, dark = mats["paint"], mats["recess"]
    box("Base / lower plinth", (1.54, 1.54, 0.075), (0, 0, 0.0375), paint, body, 0.006)
    frustum("Base / bevelled upper edge", 1.54, 1.46, 0.075, 0.125, paint, body)
    box("Base / threshold", (1.425, 1.425, 0.04), (0, 0, 0.14), paint, body)
    # A closed internal shell prevents empty gaps when looking from below.
    box("Body / closed inner shell", (1.22, 1.22, 2.055), (0, 0, 1.1775), dark, body)
    for x in [-0.644, 0.644]:
        for y in [-0.644, 0.644]:
            label = f"Corner {x:+.3f} {y:+.3f}"
            box(label + " / post", (0.152, 0.152, 2.025), (x, y, 1.1725), paint, body, 0.004)
            box(label + " / foot", (0.17, 0.17, 0.092), (x, y, 0.205), paint, body, 0.003)
            box(label + " / capital", (0.175, 0.175, 0.062), (x, y, 2.17), paint, body)
            for offset in [-0.056, 0.056]:
                box(label + f" / face bead {offset}", (0.008, 0.009, 1.865),
                    (x + offset, y + (-0.079 if y < 0 else 0.079), 1.178), paint, body, 0.001)
                box(label + f" / side bead {offset}", (0.009, 0.008, 1.865),
                    (x + (-0.079 if x < 0 else 0.079), y + offset, 1.178), paint, body, 0.001)
    box("Cornice / underneath sign", (1.452, 1.452, 0.047), (0, 0, 2.198), paint, body)
    box("Cornice / sign core", (1.46, 1.46, 0.208), (0, 0, 2.3225), paint, body)
    box("Cornice / top lip", (1.505, 1.505, 0.035), (0, 0, 2.438), paint, body)
    box("Roof / bottom step", (1.435, 1.435, 0.065), (0, 0, 2.488), paint, body, 0.004)
    box("Roof / upper step", (1.35, 1.35, 0.068), (0, 0, 2.553), paint, body, 0.003)
    frustum("Roof / shallow pitched cap", 1.35, 0.245, 2.587, 2.716, paint, body)
    box("Roof / lamp mounting plate", (0.251, 0.251, 0.018), (0, 0, 2.721), paint, body)
    return body


def build_lamp(root, mats):
    lamp = empty("Lamp", root)
    metal, paint, glass = mats["dark_metal"], mats["paint"], mats["lamp"]
    cylinder("Lamp / stepped base", 0.100, 0.025, (0, 0, 2.742), paint, lamp)
    cylinder("Lamp / lower rim", 0.079, 0.022, (0, 0, 2.765), metal, lamp)
    cylinder("Lamp_Glass", 0.065, 0.181, (0, 0, 2.867), glass, lamp, 48)
    cylinder("Lamp / upper rim", 0.080, 0.020, (0, 0, 2.967), metal, lamp)
    for i in range(8):
        angle = i * math.tau / 8
        cylinder(f"Lamp / cage upright {i + 1}", 0.004, 0.184,
                 (0.069 * math.cos(angle), 0.069 * math.sin(angle), 2.866), metal, lamp, 8)
    cylinder("Lamp / mid ring", 0.073, 0.006, (0, 0, 2.867), metal, lamp)
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=0.093, radius2=0.035,
                                  depth=0.035, location=(0, 0, 2.993))
    cap = bpy.context.object
    cap.name = "Lamp / rain cap"
    cap.parent = lamp
    cap.data.materials.append(metal)
    cylinder("Lamp / finial", 0.022, 0.010, (0, 0, 3.015), metal, lamp)
    return lamp
