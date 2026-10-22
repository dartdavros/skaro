"""Validate documentation assets and prepare a self-contained portal import payload."""

import base64
import json
import re
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent
IMAGE = re.compile(r"!\[([^\]]*)\]\(\.\./images/([^\s)]+)\)")
ARTICLE_LINK = re.compile(r"\]\(/articles/([a-z0-9-]+)\)")
TYPES = {".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml"}


def checked_file(name):
    path = (ROOT / "images" / name).resolve()
    if path.parent != (ROOT / "images").resolve():
        raise ValueError(f"Invalid image path: {name}")
    data = path.read_bytes()
    content_type = TYPES[path.suffix]
    if path.suffix == ".jpg" and not data.startswith(b"\xff\xd8\xff"):
        raise ValueError(f"Not a JPEG: {name}")
    if path.suffix == ".png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"Not a PNG: {name}")
    if path.suffix == ".svg":
        root = ElementTree.fromstring(data)
        if root.tag != "{http://www.w3.org/2000/svg}svg":
            raise ValueError(f"Not an SVG: {name}")
        if any("script" in element.tag.lower() for element in root.iter()):
            raise ValueError(f"Executable SVG content: {name}")
    return {
        "name": name,
        "contentType": content_type,
        "data": base64.b64encode(data).decode("ascii"),
    }


def prepare():
    catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    slugs = {article["slug"] for article in catalog["articles"]}
    categories = {category["slug"] for category in catalog["categories"]}
    if len(slugs) != len(catalog["articles"]):
        raise ValueError("Duplicate article slug")
    articles = []
    files = {}
    for article in catalog["articles"]:
        slug = article["slug"]
        if article["category"] not in categories:
            raise ValueError(f"Unknown category: {slug}")
        if not set(article["related"]) <= slugs or slug in article["related"]:
            raise ValueError(f"Invalid related articles: {slug}")
        if len(article["related"]) > 5:
            raise ValueError(f"Too many related articles: {slug}")
        raw = (ROOT / "articles" / f"{slug}.md").read_text(encoding="utf-8")
        heading = f"# {article['title']}\n"
        if not raw.startswith(heading):
            raise ValueError(f"Title differs from catalog: {slug}")
        content = re.sub(r"<!--[\s\S]*?-->\s*", "", raw[len(heading):]).strip()
        names = []
        for alt, name in IMAGE.findall(content):
            if not alt.strip():
                raise ValueError(f"Missing image alt text: {slug}/{name}")
            names.append(name)
            if name not in files:
                files[name] = checked_file(name)
        if not names:
            raise ValueError(f"Article has no images: {slug}")
        if not set(ARTICLE_LINK.findall(content)) <= slugs:
            raise ValueError(f"Broken internal article link: {slug}")
        articles.append({**article, "content": content, "images": sorted(set(names))})
    payload = {**catalog, "articles": articles, "files": list(files.values())}
    output = ROOT / "out"
    output.mkdir(exist_ok=True)
    (output / "payload.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )
    print(f"Validated {len(articles)} articles, {len(categories)} categories, {len(files)} images")
    print(f"Payload: {output / 'payload.json'}")


if __name__ == "__main__":
    prepare()
