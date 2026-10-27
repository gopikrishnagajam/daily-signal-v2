# DAILY SIGNAL v2

**Less noise. More signal.** A complete mobile-first, source-linked daily news website, ready for a new GitHub repository and GitHub Pages deployment. Black `#090B0F` + cobalt `#2F5BFF` + acid lime `#C7FF3D`.

## What's included

- `docs/` — production website (zero framework dependencies): accessible responsive interface, filters, on-device Saved archive, search, article view, source links, timestamps, status, JSON archive import/export, web app manifest, 404 page.
- `scripts/refresh_feed.py` — Python 3.12+ aggregator for dated publisher RSS feeds. Rejects undated, future, expired, or insecure stories; HTML-strip, dedupe, section-cap, and backfill from previous snapshot if a feed temporarily fails. Never fabricates articles.
- `tests/` — regression tests for ingestion, safety, deduplication, and 48-hour retention.
- `.github/workflows/update-and-deploy.yml` — one workflow that refreshes **8:17 AM and 8:17 PM America/Chicago**, checks the feed into Git, and deploys the refreshed site via GitHub Pages in the same execution. It also runs for each push to `main` and manually on demand.

## Install and deploy (first time)

1. Extract this ZIP to a new folder. Keep the old Daily Signal site running; it's your backup.
2. Create a **new public GitHub repository** named `daily-signal-v2`. Public is required for GitHub Pages on a free plan. Do not add a README/gitignore/license via the GitHub wizard since the project already includes a README.
3. In a terminal in the extracted folder, run:

   ```bash
   git init
   git branch -M main
   git add .
   git commit -m "Launch Daily Signal v2"
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/daily-signal-v2.git
   git push -u origin main
   ```

   Alternatively, if you use GitHub CLI, you can create and push in one command after the first commit: `gh repo create daily-signal-v2 --public --source=. --remote=origin --push`.

4. Open the new repository on GitHub → **Settings → Pages → Build and deployment → Source → GitHub Actions**.
5. Open **Actions → Refresh feed and deploy Daily Signal → Run workflow**. This will also run on initial push, but the manual trigger is useful for confirming it.
6. Inspect the workflow logs: the `build` and `deploy` jobs must both succeed. Open the URL shown in the deployment job (`https://YOUR_GITHUB_USERNAME.github.io/daily-signal-v2/`). Confirm published headlines show real source URLs and publication dates.
7. Keep v1 until you are satisfied with v2 and have backed up any saved stories from the old domain. **Do not delete v1 just because the files are uploaded.**

## Important constraints

- This is a **sourced headline and publisher-excerpt** reader, not automatically AI-written investigative reports. It does **not** invent explanations for “why it happened”, make legal advice claims, or pretend RSS blurbs are independently verified journalism.
- News items disappear from the feed after 48 hours. Saved items remain as browser-local snapshots until removed or browser storage is cleared. Export saved articles before switching browsers or devices. There is no account login or cross-device sync.
- The v1 site and v2 will be on different origins. A browser cannot silently read v1's saved data. Export v1 data using that site's capabilities, or manually re-save those stories. The v2 Import action accepts exports from v2 (not undocumented v1 formats).
- On GitHub-hosted pages, the updater runs on GitHub servers; the *mobile browser* does not need to be open. GitHub Actions scheduled jobs are not guaranteed to fire to the minute, and GitHub can disable schedules after 60 days with no activity in public repositories, so check workflow history periodically.
- If **every** RSS source fails, the updater exits with a nonzero status, the job does not deploy a fabricated feed, and the last deployed site remains live. On load, the UI still hides stories older than 48 hours. The feed is only as comprehensive as its sources.
- BBC syndication has publisher terms; this implementation only surfaces short feed excerpts, links, and attribution. Review provider terms before commercial use.

## Run locally

```bash
python -m unittest discover -s tests -v
python scripts/refresh_feed.py  # Requires network access to news RSS sources
python -m http.server 8000 --directory docs
# open http://localhost:8000
```

You may also open the standalone design-preview HTML included separately; the website package itself deliberately begins with no fake news until its first successful refresh.

## Scheduling and editing

Change the `cron` in `.github/workflows/update-and-deploy.yml` to adjust local hours. `timezone: 'America/Chicago'` handles daylight saving time. Manual updates: Actions → workflow → Run workflow. New publishers: edit `SOURCES` in `scripts/refresh_feed.py` and re-run tests.

## Data structure

Public JSON at `docs/feed.json`:

```json
{
  "version": 1,
  "updatedAt": "2026-10-27T15:00:00Z",
  "retentionHours": 48,
  "sections": ["immigration", "us", "india", "world", "technology", "football", "cricket", "f1"],
  "articles": [{"id": "stable-sha256-prefix", "section": "technology", "title": "...", "excerpt": "...", "source": "BBC News", "url": "https://...", "publishedAt": "...", "officialSource": false}]
}
```

## Migration checklist

- [ ] Repository created and code pushed
- [ ] Pages source set to GitHub Actions
- [ ] Feed refresh log reports at least one successful publisher source
- [ ] Site loads on Safari iPhone with live data, source links, Saved, search, and mobile bottom navigation
- [ ] Save an article and reload; it is still present in Saved
- [ ] Export Saved JSON; import it in a different browser to validate manual backup
- [ ] Run workflow manually and confirm a real deployment and updated timestamp
- [ ] Compare v1 saved data, remove v1 only when no data will be lost
