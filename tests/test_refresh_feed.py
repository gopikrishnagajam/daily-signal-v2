import sys
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from refresh_feed import clean_text, normalize_url, parse_xml, build_feed, dedupe_and_limit

NOW = datetime(2026, 10, 27, 16, 0, tzinfo=timezone.utc)
SOURCE = {'name': 'Example Agency', 'section': 'immigration', 'official': True, 'filter': 'immigration', 'url': 'https://example.org/news.rss'}


def rss(items):
    return ('<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>' + ''.join(
        '<item><title>{}</title><link>{}</link><pubDate>{}</pubDate><description>{}</description></item>'.format(*x)
        for x in items
    ) + '</channel></rss>').encode()


class FeedTests(unittest.TestCase):
    def test_accepts_recent_dated_source(self):
        xml = rss([('New H-1B visa policy', 'https://example.org/story?utm_source=rss', format_datetime(NOW - timedelta(hours=3)), 'An agency announcement')])
        items = parse_xml(xml, SOURCE, NOW)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['url'], 'https://example.org/story')
        self.assertTrue(items[0]['officialSource'])

    def test_expire_after_48h(self):
        xml = rss([('H-1B old story', 'https://example.org/old', format_datetime(NOW - timedelta(hours=49)), 'Old')])
        self.assertEqual(parse_xml(xml, SOURCE, NOW), [])

    def test_ignores_irrelevant_uscis_headlines(self):
        xml = rss([('Agency charity luncheon', 'https://example.org/lunch', format_datetime(NOW), 'A fundraiser')])
        self.assertEqual(parse_xml(xml, SOURCE, NOW), [])

    def test_ignores_missing_publication_date(self):
        xml = b'<rss><channel><item><title>F-1 announcement</title><link>https://example.org/a</link></item></channel></rss>'
        self.assertEqual(parse_xml(xml, SOURCE, NOW), [])

    def test_no_html_execution_in_excerpt(self):
        self.assertEqual(clean_text('<script>alert(1)</script><b>hello</b> world'), 'hello world')

    def test_rejects_insecure_urls(self):
        self.assertIsNone(normalize_url('javascript:alert(1)'))
        self.assertIsNone(normalize_url('http://example.org/article'))

    def test_deduplicates_across_two_feeds(self):
        news = {'id': 'one', 'section': 'us', 'title': 'A story', 'publishedAt': NOW.isoformat(), 'url': 'https://example.org/a'}
        other = {**news, 'id': 'two'}
        self.assertEqual(len(dedupe_and_limit([news, other], NOW)), 1)

    def test_keep_old_snapshot_during_individual_feed_failure(self):
        old = {'articles': [{'id':'saved', 'section':'technology', 'title':'Recent development',
                            'publishedAt':NOW.isoformat(), 'url':'https://example.org/recent'}]}
        xml = rss([('New H-1B visa rule', 'https://example.org/new', format_datetime(NOW), 'A new announcement')])
        feed, ok, failures = build_feed(fetcher=lambda s: xml if s['name']=='Example Agency' else (_ for _ in ()).throw(RuntimeError('failed')),
                                       now=NOW, previous=old, sources=[SOURCE, {'name':'Bad Feed', 'section':'world', 'official':False, 'url':'https://example.org/no'}])
        self.assertEqual(ok, 1)
        self.assertEqual(len(failures), 1)
        self.assertEqual(len(feed['articles']), 2)


if __name__ == '__main__':
    unittest.main()
