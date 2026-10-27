import sys
import unittest
from datetime import datetime,timezone,timedelta
from email.utils import format_datetime
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from refresh_feed import parse_xml,dedupe_and_limit
NOW=datetime(2026,10,27,16,0,tzinfo=timezone.utc)
SOURCE={'name':'Test publisher','section':'world','url':'https://example.org/rss.xml','official':False}
class AdditionalTests(unittest.TestCase):
    def test_atom_link_and_date(self):
        xml=(b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Big update</title>'
             b'<link rel="alternate" href="https://example.org/story"/>'
             b'<updated>2026-10-27T15:00:00Z</updated><summary>News from the feed.</summary></entry></feed>')
        self.assertEqual(len(parse_xml(xml,SOURCE,NOW)),1)
    def test_rejects_future_dated_item(self):
        d=format_datetime(NOW+timedelta(hours=2))
        xml=f'<rss><channel><item><title>Future article</title><link>https://example.org/story</link><pubDate>{d}</pubDate></item></channel></rss>'.encode()
        self.assertEqual(parse_xml(xml,SOURCE,NOW),[])
    def test_older_items_expire_even_when_previous_snapshot_kept(self):
        data=[{'id':'a','title':'Old','url':'https://example.org/a','section':'world','publishedAt':(NOW-timedelta(hours=49)).isoformat()},
             {'id':'b','title':'New','url':'https://example.org/b','section':'world','publishedAt':NOW.isoformat()}]
        self.assertEqual([x['id'] for x in dedupe_and_limit(data,NOW)],['b'])
if __name__=='__main__': unittest.main()
