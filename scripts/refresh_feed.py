#!/usr/bin/env python3
"""Generate the public Daily Signal news feed from dated, attributed RSS items.

No LLM or synthesized reporting: this is an ingestion job. It preserves
publisher attribution and links, and drops articles older than 48 hours.
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'docs' / 'feed.json'
MAX_AGE = timedelta(hours=48)
MAX_PER_SECTION = 12
MAX_ARTICLES = 65

# Direct publisher/government feeds. A feed failure is reported, not silently invented.
SOURCES = [
    {'name': 'USCIS', 'section': 'immigration', 'url': 'https://www.uscis.gov/news/rss-feed/59144', 'official': True, 'filter': 'immigration'},
    {'name': 'Google News (aggregator)', 'section': 'immigration', 'url': 'https://news.google.com/rss/search?q=F-1+visa+OR+H-1B+OR+SEVIS+OR+OPT+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen', 'official': False, 'filter': 'immigration'},
    {'name': 'BBC News', 'section': 'us', 'url': 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', 'official': False},
    {'name': 'BBC News', 'section': 'india', 'url': 'https://feeds.bbci.co.uk/news/world/asia/india/rss.xml', 'official': False},
    {'name': 'BBC News', 'section': 'world', 'url': 'https://feeds.bbci.co.uk/news/world/rss.xml', 'official': False},
    {'name': 'BBC News', 'section': 'technology', 'url': 'https://feeds.bbci.co.uk/news/technology/rss.xml', 'official': False},
    {'name': 'GitHub Blog', 'section': 'technology', 'url': 'https://github.blog/feed/', 'official': False},
    {'name': 'Ars Technica', 'section': 'technology', 'url': 'https://feeds.arstechnica.com/arstechnica/index', 'official': False},
    {'name': 'BBC Sport', 'section': 'football', 'url': 'https://feeds.bbci.co.uk/sport/football/rss.xml', 'official': False},
    {'name': 'BBC Sport', 'section': 'cricket', 'url': 'https://feeds.bbci.co.uk/sport/cricket/rss.xml', 'official': False},
    {'name': 'BBC Sport', 'section': 'f1', 'url': 'https://feeds.bbci.co.uk/sport/formula1/rss.xml', 'official': False},
]
IMMIGRATION_TERMS = re.compile(
    r'\b(?:f[ -]?1|h[ -]?1b|h1b|sevis|opt|stem opt|uscis|dhs|student visas?|international students?|'
    r'work authori[sz]ation|visa appointments?|employment authori[sz]ation|consular|immigration policy|i-20|i-129)\b', re.I
)
SECTIONS = ('immigration', 'us', 'india', 'world', 'technology', 'football', 'cricket', 'f1')
NS = {'atom': 'http://www.w3.org/2005/Atom', 'dc': 'http://purl.org/dc/elements/1.1/'}


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.texts = []
        self.ignore_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style'}:
            self.ignore_depth += 1

    def handle_endtag(self, tag):
        if tag in {'script', 'style'} and self.ignore_depth:
            self.ignore_depth -= 1

    def handle_data(self, data):
        if not self.ignore_depth:
            self.texts.append(data)


def clean_text(value: str, limit: int = 320) -> str:
    parser = TextExtractor()
    parser.feed(html.unescape(value or ''))
    result = re.sub(r'\s+', ' ', ' '.join(parser.texts)).strip()
    return result[:limit].rstrip() + ('…' if len(result) > limit else '')


def normalize_url(raw: str) -> str | None:
    try:
        u = urlsplit(raw.strip())
        if u.scheme != 'https' or not u.netloc or u.username or u.password:
            return None
        query = urlencode([(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True)
                           if not k.lower().startswith('utm_') and k.lower() not in {'fbclid', 'gclid'}])
        return urlunsplit(('https', u.netloc.lower(), u.path or '/', query, ''))
    except (ValueError, AttributeError):
        return None


def parse_date(value: str) -> datetime | None:
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
    except (ValueError, TypeError):
        try:
            dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def tag_text(el, names):
    for name in names:
        node = el.find(name, NS)
        if node is not None and node.text:
            return node.text.strip()
    return ''


def parse_xml(xml_string: bytes, source: dict, now: datetime) -> list[dict]:
    root = ET.fromstring(xml_string)
    is_atom = root.tag.endswith('}feed') or root.tag == 'feed'
    items = root.findall('atom:entry', NS) if is_atom else root.findall('.//item')
    articles = []
    for it in items:
        title = clean_text(tag_text(it, ['title', 'atom:title']), 180)
        link = tag_text(it, ['link'])
        if not link and is_atom:
            for elem in it.findall('atom:link', NS):
                if elem.get('rel', 'alternate') == 'alternate' and elem.get('href'):
                    link = elem.get('href')
                    break
        url = normalize_url(link)
        published = parse_date(tag_text(it, ['pubDate', 'dc:date', 'atom:published', 'atom:updated']))
        description = clean_text(tag_text(it, ['description', 'atom:summary', 'atom:content']), 260)
        if not title or not url or not published:
            continue
        if now - MAX_AGE > published or published > now + timedelta(minutes=10):
            continue
        if source.get('filter') == 'immigration' and not IMMIGRATION_TERMS.search(title + ' ' + description):
            continue
        uid = hashlib.sha256(url.encode('utf-8')).hexdigest()[:20]
        articles.append({
            'id': uid,
            'section': source['section'],
            'title': title,
            'excerpt': description,
            'source': source['name'],
            'url': url,
            'publishedAt': published.isoformat().replace('+00:00', 'Z'),
            'officialSource': source['official'],
        })
    return articles


def dedupe_and_limit(articles: list[dict], now: datetime) -> list[dict]:
    items = []
    seen_ids = set()
    seen_titles = set()
    counts = {s: 0 for s in SECTIONS}
    for a in sorted(articles, key=lambda x: x.get('publishedAt', ''), reverse=True):
        date = parse_date(a.get('publishedAt', ''))
        if not date or now - MAX_AGE > date or date > now + timedelta(minutes=10):
            continue
        if a.get('section') not in counts:
            continue
        url = normalize_url(a.get('url', ''))
        if not url:
            continue
        title = re.sub(r'[^a-z0-9]', '', a.get('title', '').lower())
        if not title or a.get('id') in seen_ids or title in seen_titles:
            continue
        if counts[a['section']] >= MAX_PER_SECTION:
            continue
        seen_ids.add(a.get('id'))
        seen_titles.add(title)
        items.append(a)
        counts[a['section']] += 1
        if len(items) >= MAX_ARTICLES:
            break
    return items


def fetch_source(source: dict) -> bytes:
    request = urllib.request.Request(source['url'], headers={'User-Agent': 'DailySignalFeedBot/1.0 (+news aggregation; contact owner via website)', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'})
    with urllib.request.urlopen(request, timeout=15) as response:
        if int(response.headers.get('Content-Length', 0)) > 2_000_000:
            raise ValueError('feed too large')
        data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise ValueError('feed too large')
        return data


def build_feed(fetcher=fetch_source, now=None, previous=None, sources=None):
    now = now or datetime.now(timezone.utc)
    sources = SOURCES if sources is None else sources
    articles = []
    failures = []
    succeeded = 0
    for source in sources:
        try:
            articles.extend(parse_xml(fetcher(source), source, now))
            succeeded += 1
        except Exception as exc:
            failures.append(f"{source['name']} / {source['section']}: {type(exc).__name__}: {exc}")
    # Retain recently published articles from the preceding snapshot if a source is down.
    if previous and isinstance(previous.get('articles'), list):
        articles.extend(previous['articles'])
    merged = dedupe_and_limit(articles, now)
    feed = {
        'version': 1,
        'updatedAt': now.isoformat().replace('+00:00', 'Z'),
        'retentionHours': 48,
        'sections': list(SECTIONS),
        'articles': merged,
    }
    return feed, succeeded, failures


def main():
    previous = None
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as exc:
            print(f'Existing feed invalid, ignoring: {exc}', file=sys.stderr)
    feed, succeeded, failures = build_feed(previous=previous)
    for error in failures:
        print(f'WARNING: {error}', file=sys.stderr)
    if succeeded == 0:
        # Keep last published file unchanged on a total failure. UI must filter expired data.
        print('ERROR: all publisher feeds failed; keeping previously published feed', file=sys.stderr)
        sys.exit(1)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=OUTPUT.parent, delete=False) as tmp:
        json.dump(feed, tmp, ensure_ascii=False, indent=2)
        tmp.write('\n')
        tmp_path = Path(tmp.name)
    os.replace(tmp_path, OUTPUT)
    counts = {key: sum(a['section'] == key for a in feed['articles']) for key in SECTIONS}
    print(f"Updated {OUTPUT}: {len(feed['articles'])} fresh articles / {succeeded} sources OK; sections={counts}")


if __name__ == '__main__':
    main()
