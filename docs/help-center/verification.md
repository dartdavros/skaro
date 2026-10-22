# Publication verification — 22 October 2026

Published at <https://help.skaro.dev>. Sources and authentic application screenshots
were checked against the installed **Skaro 2.2.4** on Windows.

## Completed

- Published ten English articles in three ordered categories: Getting Started
  (five), Working with Skaro (three), Maintenance & Help (two).
- Public API checks confirmed all ten published revision IDs, English titles,
  category assignments and directed related-article links against the catalog.
- All **23 article-owned image files** returned HTTP 200, an image content type
  and the expected SHA256. These represent **15 unique images**: twelve actual
  screenshots and three explanatory SVG diagrams.
- Local preparation checked image signatures, SVG structure, nonempty alt text,
  local image references and internal article links. Published content contains
  no unresolved local paths, broken placeholder links or owner image comments.
- Opened all ten published articles in the real portal browser. Checked titles,
  navigation, contents lists, text wrapping and image rendering. No horizontal
  overflow was observed at the browser's normal desktop viewport. Checked the
  in-article navigation to the first-project and quota screenshot sections.
- Saved publication IDs and image URLs in `publication.json`. Public HTTP and
  browser check details are in ignored `out/`; a publication screenshot is kept
  at `verification/published-article.jpg`.
- Python utility sources parsed successfully. The content preflight passed before
  first publication. No application build or unrelated test suite was run for
  this documentation task. All authored source modules are below 180 lines;
  no product component was added or changed.

## Upload correction and approved directory permission change

The first import ran through `backend-admin`, which has no shared media mount.
Article metadata was published, but public image requests returned HTTP 500.
Uploading the same bodies through `backend-app` then exposed an existing ownership
mismatch: its `hub` user (100:101) could not create article directories under
the parent owned by 1000:1000.

The owner explicitly approved changing the owner of this one directory:

`/app/apps/backend/media/organizations/94b4137e-f2bb-4308-8749-e25a061a6e65/portal-articles`

The path was checked to be the exact resolved directory, not a symlink. Its owner
was changed from 1000:1000 to 100:101 without recursion. Existing files, mount
configuration and deployment were not changed. The 23 original file bodies were
then uploaded through the working backend's existing storage at their registered
keys; article URLs, revisions and quota accounting were preserved. Public HTTP
and hash checks passed afterward. The README now specifies `backend-app`.

## Explicit limits

- macOS and Linux installation screenshots remain for the owner to supply, as
  agreed. Placement markers and English captions are in `screenshots.md` and the
  source articles; markers are excluded from published text.
- Windows SmartScreen and installer-progress images were not captured. The
  installed app was already at 2.2.4 and was not reinstalled to stage a prompt.
  The installation guide includes the real download page and installed-app shots,
  conditional instructions and a link to Microsoft's documentation.
- Opening an existing view does not verify installation, authentication, task
  execution, merging or updates end to end. None of those operations was performed
  just to illustrate the guides. No mock API, fixtures or seeded data was used.
- Application controls in screenshots are English; existing project-authored task
  names and results keep their original language. No project content was rewritten
  for screenshots. Account emails and credential dialogs were not published.
- The existing portal header/name remains Russian. This task changes its English
  article content and categories, not its existing branding or UI implementation.
- The UI language was temporarily changed to English for capture. Skaro was no
  longer open at final verification, so it was not relaunched merely to alter the
  user's current desktop state. No agent settings, credentials or task state were
  changed during capture.
- No commit was made.
