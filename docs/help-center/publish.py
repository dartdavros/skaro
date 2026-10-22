"""Run in the existing Chatballs Django shell with PAYLOAD and APPLY supplied.

Uses the real content and file services, with tenant scope and one transaction.
This first-publication utility deliberately refuses a portal that is not empty.
"""

import base64
import hashlib
import json

from django.core.files.uploadedfile import SimpleUploadedFile

from chatballs.support_portals.content_services import (
    add_article_file,
    add_revision,
    create_article,
    create_category,
    publish_revision,
    update_article,
)
from chatballs.support_portals.models import SupportPortal
from chatballs.tenancy.context import TenantContext
from chatballs.tenancy.database import tenant_atomic
from chatballs.tenancy.ingress import support_portal_route
from chatballs.tenancy.lookup import load_organization


def publish(payload, *, apply=False):
    if payload["portal"] != "help.skaro.dev" or payload["locale"] != "en":
        raise ValueError("Unexpected portal or language")
    route = support_portal_route(payload["portal"])
    if route is None:
        raise ValueError("Existing portal host is not registered")
    organization = load_organization(route.organization_id)
    context = TenantContext.for_resource(organization)
    files = {item["name"]: item for item in payload["files"]}
    written = []
    receipt = []
    try:
        with tenant_atomic(context):
            portal = SupportPortal.objects.select_for_update().get(
                pk=route.resource_id, organization=organization, slug="skaro",
                status="PUBLISHED", default_locale="en",
            )
            if portal.categories.exists() or portal.articles.exists():
                raise ValueError("Portal is no longer empty; refusing to overwrite content")
            if not apply:
                return {"action": "dry-run", "portal": portal.id,
                        "categories": len(payload["categories"]),
                        "articles": len(payload["articles"]), "images": len(files)}
            categories = {
                item["slug"]: create_category(context=context, portal=portal, data=item)
                for item in payload["categories"]
            }
            articles = {}
            for item in payload["articles"]:
                article = create_article(context=context, portal=portal, data={
                    "categoryId": categories[item["category"]].id,
                    "slug": item["slug"], "locale": "en", "title": item["title"],
                    "summary": item["summary"], "content": item["content"],
                })
                articles[item["slug"]] = article
                content = item["content"]
                attachments = []
                for name in item["images"]:
                    source = files[name]
                    data = base64.b64decode(source["data"], validate=True)
                    upload = SimpleUploadedFile(name, data, source["contentType"])
                    attached = add_article_file(context=context, article=article, upload=upload)
                    written.append((attached.file.storage, attached.file.name))
                    path = attached.public_path()
                    content = content.replace(f"../images/{name}", path)
                    attachments.append({"name": name, "path": path,
                                        "sha256": hashlib.sha256(data).hexdigest()})
                if "../images/" in content or "<!--" in content:
                    raise ValueError(f"Unresolved content in {item['slug']}")
                revision = add_revision(context=context, article=article, data={
                    "title": item["title"], "summary": item["summary"], "content": content,
                })
                publish_revision(article=article, revision_id=revision.id)
                receipt.append({"slug": article.slug, "id": article.id,
                                "revisionId": revision.id, "files": attachments})
            for position, item in enumerate(payload["articles"], start=1):
                update_article(article=articles[item["slug"]], data={
                    "sortOrder": position,
                    "relatedArticleIds": [articles[slug].id for slug in item["related"]],
                })
    except Exception:
        # Database rollback cannot remove files written to storage. Clean up only
        # new files created by this attempt; pre-existing portal files are untouched.
        for storage, name in reversed(written):
            storage.delete(name)
        raise
    return {"action": "published", "portal": payload["portal"], "articles": receipt}


if "PAYLOAD" in globals():
    print(json.dumps(publish(PAYLOAD, apply=APPLY), ensure_ascii=False))
