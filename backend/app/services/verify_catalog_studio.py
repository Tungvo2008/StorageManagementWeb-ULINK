import json,sqlite3
from sqlalchemy import select
from app.db.session import SessionLocal
from app.api.v1.catalog_admin import CatalogEntry,read_catalog,update_catalog,EntryPayload
from app.db.models import WebsiteListing
from app.api.v1.storefront import _render_website_listing
with SessionLocal() as db:
 data=read_catalog(db);assert len(data['entries'])==192
 assert len({e['listing_id'] for e in data['entries']})==179
 for e in data['entries']:
  p=_render_website_listing(db,db.get(WebsiteListing,e['listing_id']),'vi');assert p.name==e['name'] and p.image_url==e['image_url']
 print('Canonical names/images:192 PASS; catalog links:179 PASS')
# Physical stock and every pre-existing media row must remain unchanged.
a=sqlite3.connect('/app/exports/before-catalog-studio.db');b=sqlite3.connect('/app/storage.db')
for table in ['products','website_listing_media','website_listings','showcase_items']:
 assert a.execute('SELECT * FROM '+table+' ORDER BY id').fetchall()==b.execute('SELECT * FROM '+table+' ORDER BY id').fetchall(),table
 print(table,'unchanged PASS')
