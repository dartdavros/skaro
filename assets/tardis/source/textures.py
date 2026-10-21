"""Create original repeatable PBR textures and legible prop signage.

Run with ordinary Python plus Pillow and NumPy, before invoking Blender.
No downloaded photograph or third-party 3D asset is embedded in the model.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


DIRECTORY = Path(__file__).resolve().parent.parent / "textures"
FONTS = Path("C:/Windows/Fonts")


def font(size, bold=False, narrow=False, serif=False):
    name = "times.ttf" if serif else ("ARIALNB.TTF" if bold else "ARIALN.TTF") if narrow else "arialbd.ttf" if bold else "arial.ttf"
    return ImageFont.truetype(str(FONTS / name), size)


def noise(rng, width, height, target):
    values = (rng.random((height, width)) * 255).astype(np.uint8)
    return np.asarray(Image.fromarray(values).resize(target, Image.Resampling.BICUBIC), dtype=float) / 255 - 0.5


def save_rgb(name, pixels, resolution=None):
    image = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
    if resolution:
        image = image.resize(resolution, Image.Resampling.LANCZOS)
    image.save(DIRECTORY / name)


def paint():
    rng = np.random.default_rng(2005)
    size = 1024
    target = (size, size)
    broad = noise(rng, 18, 24, target)
    timber = noise(rng, 280, 10, target)
    fibres = noise(rng, 800, 48, target)
    pores = noise(rng, 640, 640, target)
    surface = 0.16 * timber + 0.08 * fibres + 0.10 * pores
    shade = broad * 12 + timber * 4 + fibres * 2 + pores * 3
    rgb = np.array([45, 75, 96])[None, None, :] + shade[:, :, None]
    save_rgb("paint-color.png", rgb)
    gx = (np.roll(surface, -1, axis=1) - np.roll(surface, 1, axis=1)) * 3
    gy = (np.roll(surface, -1, axis=0) - np.roll(surface, 1, axis=0)) * 3
    normals = np.stack([-gx, -gy, np.ones_like(gx)], axis=2)
    normals /= np.linalg.norm(normals, axis=2)[:, :, None]
    save_rgb("paint-normal.png", (normals * 0.5 + 0.5) * 255, (512, 512))
    roughness = np.clip(193 + broad * 30 + timber * 18, 0, 255).astype(np.uint8)
    Image.fromarray(roughness).resize((512, 512), Image.Resampling.LANCZOS).save(DIRECTORY / "paint-roughness.png")


def text_layer(text, face, color):
    bounds = face.getbbox(text)
    image = Image.new("RGBA", (bounds[2] - bounds[0] + 4, bounds[3] - bounds[1] + 4))
    ImageDraw.Draw(image).text((2 - bounds[0], 2 - bounds[1]), text, font=face, fill=color)
    return image


def fit_text(image, text, rectangle, size, **options):
    layer = text_layer(text, font(size, **options), (225, 219, 196, 255))
    x, y, width, height = rectangle
    layer = layer.resize((width, height), Image.Resampling.LANCZOS)
    image.paste(layer, (x, y), layer)


def signage():
    image = Image.new("RGB", (2048, 232), (12, 22, 28))
    fit_text(image, "POLICE", (105, 42, 826, 145), 160, narrow=True)
    fit_text(image, "PUBLIC", (988, 44, 300, 61), 90, narrow=True)
    fit_text(image, "CALL", (1009, 119, 258, 61), 90, narrow=True)
    fit_text(image, "BOX", (1355, 42, 541, 145), 160, narrow=True)
    image.save(DIRECTORY / "police-sign.png")
    rng = np.random.default_rng(1963)
    base = np.array([222, 219, 201])[None, None, :] + noise(rng, 32, 32, (768, 1024))[:, :, None] * 10
    image = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(image)
    draw.rectangle((22, 20, 745, 1003), outline=(100, 104, 96), width=3)
    lines = [("POLICE TELEPHONE", 78, 49, True), ("FREE", 168, 100, False),
             ("FOR USE OF", 290, 45, False), ("PUBLIC", 357, 75, False),
             ("ADVICE & ASSISTANCE", 468, 40, False),
             ("OBTAINABLE IMMEDIATELY", 532, 35, False),
             ("OFFICERS & CARS", 660, 44, False),
             ("RESPOND TO ALL CALLS", 720, 39, False),
             ("PULL TO OPEN", 871, 66, True)]
    for text, y, size, bold in lines:
        draw.text((384, y), text, font=font(size, bold=bold, narrow=True),
                  fill=(61, 72, 76), anchor="mt")
    image.save(DIRECTORY / "telephone.png")


def windows():
    rng = np.random.default_rng(2006)
    target = (768, 1024)
    cloudy = noise(rng, 15, 20, target) * 5
    pebbled = noise(rng, 260, 320, target) * 6
    pixels = np.array([159, 174, 174])[None, None, :] + (cloudy + pebbled)[:, :, None]
    # Slightly mismatched glazing is visible on the original prop.
    for column, tint in enumerate([-6, 4, -1]):
        pixels[:, column * 256:(column + 1) * 256] += tint
    pixels[512:] -= 7
    save_rgb("window.png", pixels)


if __name__ == "__main__":
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    paint()
    signage()
    windows()
    print("Generated six original texture images:", DIRECTORY)
