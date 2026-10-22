# Skaro Help Center — English source articles

Ten articles for the existing Chatballs portal at <https://help.skaro.dev>.
Source and screenshots checked against the installed release **2.2.4** on
**22 October 2026**. No application implementation or portal UI changes are needed.

- `catalog.json` — English titles, summaries, category order and related articles.
- `articles/*.md` — one source article per file, with readable local image links.
- `images/` — authentic screenshots and clearly identified explanatory diagrams.
- `screenshots.md` — provenance, capture limits and the macOS/Linux image checklist.
- `publication.json` — publication IDs and uploaded image paths, after publication.
- `verification.md` — completed checks and remaining limits, after verification.

## Content maintenance

Use the current released interface and actual behavior as the source. Check
`docs/ui-baseline.md`, `docs/completion-process.md`, `docs/updates.md` and the
relevant implementation before revising an instruction. Old requirements may
describe superseded behavior. Provider model names in screenshots are examples.

The owner will add macOS and Linux screenshots later. Their exact positions are
marked by HTML comments in the source. These comments are stripped from published
content. Keep them out of customer-facing text and avoid broken image placeholders.

Screenshots are documentation evidence of the views shown, not a claim that agents,
installation, updates or merging were executed during documentation work. Existing
task data is shown as authored; it was not translated, replaced or seeded for images.

## Validate and prepare

```sh
python docs/help-center/prepare.py
```

This validates the catalog, local image signatures, SVG structure, image alt text
and internal article links. It writes a self-contained JSON payload to the ignored
`out/` directory. It runs no application build, runtime suite, mock API or server.

## First publication to the existing portal

`transfer.py` writes Python input for the existing Chatballs Django shell.
`publish.py` resolves the existing hostname through Chatballs' tenant directory,
checks the portal is published, English and empty, then uses the actual category,
article, file-upload and publication services within tenant scope.

Without `--apply`, it performs a read-only preflight. With `--apply`, it creates
the three categories, ten articles, article-owned image files, published revisions,
editorial ordering and related-article links. It refuses a non-empty portal so a
rerun cannot silently overwrite later edits. No credentials are stored here.

Run only when the owner has authorized publication. In PowerShell, substitute the
existing SSH connection details; do not deploy code or change server configuration:

```powershell
python docs/help-center/transfer.py | ssh <existing-ssh-options> ubuntu@<server> "docker compose exec -T backend-app python /app/apps/backend/manage.py shell"
```

After a successful preflight, add `--apply` to `transfer.py` for the authorized
publication. Preserve the JSON receipt as `publication.json`.

Use `backend-app`, which mounts the installation's existing media volume. The
administrative container does not mount that volume; importing file bodies there
would leave the published image URLs unavailable to the public application.

For later edits, use Chatballs' article editor or its normal YAML article importer
against the existing categories. Upload each new image as a file of its article
and use the returned relative `/api/v1/help/files/.../` path. External image URLs
are blocked by the portal CSP. A new imported revision still needs publication.

## Verify the real portal

Check all ten public articles, category order, internal links and image responses.
Open the published pages in a browser and check actual text, image layout and
navigation. Record any unavailable platform checks honestly. Do not run a build or
unrelated product tests for these documentation-only changes.
