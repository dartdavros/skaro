"""Contract checks against the actual deliverable; no fixtures or mock services."""

import io
import json
from pathlib import Path
import struct
import unittest

from PIL import Image

DIRECTORY = Path(__file__).resolve().parent.parent


def read_glb():
    data = (DIRECTORY / "tardis-2005.glb").read_bytes()
    magic, version, total = struct.unpack_from("<4sII", data)
    assert (magic, version, total) == (b"glTF", 2, len(data))
    size, kind = struct.unpack_from("<II", data, 12)
    assert kind == 0x4E4F534A
    document = json.loads(data[20:20 + size])
    offset = 20 + size
    binary_size, kind = struct.unpack_from("<II", data, offset)
    assert kind == 0x004E4942
    binary = data[offset + 8:offset + 8 + binary_size]
    return document, binary


class ModelContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document, cls.binary = read_glb()

    def test_portable_model_has_embedded_images_and_no_scene_extras(self):
        doc = self.document
        self.assertNotIn("uri", doc["buffers"][0])
        self.assertFalse(doc.get("animations"))
        self.assertFalse(doc.get("cameras"))
        self.assertNotIn("KHR_lights_punctual", doc.get("extensions", {}))
        self.assertGreaterEqual(len(doc["images"]), 5)
        for item in doc["images"]:
            self.assertNotIn("uri", item)
            view = doc["bufferViews"][item["bufferView"]]
            offset, length = view.get("byteOffset", 0), view["byteLength"]
            image = Image.open(io.BytesIO(self.binary[offset:offset + length]))
            image.verify()

    def test_model_has_separate_body_housing_and_lamp(self):
        doc = self.document
        nodes = {node.get("name"): node for node in doc["nodes"]}
        for name in ["TARDIS_2005", "Body_Mesh", "Lamp_Housing", "Lamp_Glass"]:
            self.assertIn(name, nodes)
        self.assertEqual(len(doc["meshes"]), 3)
        glass_mesh = doc["meshes"][nodes["Lamp_Glass"]["mesh"]]
        material = doc["materials"][glass_mesh["primitives"][0]["material"]]
        self.assertEqual(material["name"], "Lamp_Glass")
        self.assertGreater(max(material["emissiveFactor"]), 0)

    def test_geometry_is_bounded_and_light_enough_for_web(self):
        doc = self.document
        positions = [doc["accessors"][primitive["attributes"]["POSITION"]]
                     for mesh in doc["meshes"] for primitive in mesh["primitives"]]
        lower = [min(accessor["min"][axis] for accessor in positions) for axis in range(3)]
        upper = [max(accessor["max"][axis] for accessor in positions) for axis in range(3)]
        # Blender exporter transforms geometry to Y-up before writing accessors.
        sizes = [upper[axis] - lower[axis] for axis in range(3)]
        self.assertAlmostEqual(sizes[0], 1.54, delta=0.02)
        self.assertAlmostEqual(sizes[1], 3.02, delta=0.02)
        self.assertAlmostEqual(sizes[2], 1.54, delta=0.02)
        for low, high in zip(lower, upper):
            self.assertAlmostEqual(low + high, 0, delta=0.025)
        triangles = sum(doc["accessors"][p["indices"]]["count"] // 3
                        for mesh in doc["meshes"] for p in mesh["primitives"])
        self.assertLess(triangles, 50000)
        self.assertLess((DIRECTORY / "tardis-2005.glb").stat().st_size, 8 * 1024 * 1024)

    def test_review_renders_have_transparent_background_and_visible_model(self):
        for view in ["front", "front-three-quarter", "rear-three-quarter", "underside"]:
            with self.subTest(view=view):
                image = Image.open(DIRECTORY / "renders" / (view + ".png"))
                self.assertEqual(image.mode, "RGBA")
                alpha = image.getchannel("A")
                self.assertEqual(alpha.getpixel((0, 0)), 0)
                self.assertEqual(alpha.getextrema(), (0, 255))
                bounds = alpha.getbbox()
                self.assertGreater(bounds[0], 0)
                self.assertGreater(bounds[1], 0)
                self.assertLess(bounds[2], image.width)
                self.assertLess(bounds[3], image.height)


if __name__ == "__main__":
    unittest.main(verbosity=2)
