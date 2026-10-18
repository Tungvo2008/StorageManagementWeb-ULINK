import re,json
from sqlalchemy import text,select
from app.db.session import engine,SessionLocal
with engine.begin() as c:
 columns=[r[1] for r in c.execute(text('pragma table_info(website_catalog_entries)'))]
 if 'brand' not in columns:c.execute(text("ALTER TABLE website_catalog_entries ADD COLUMN brand VARCHAR(128) NOT NULL DEFAULT ''"))
from app.api.v1.catalog_admin import CatalogEntry
from app.db.models import WebsiteListing
from app.api.v1.storefront import _render_website_listing
approved200={'NP-122','NP-128','NP-117','NP-118','NP-119','NP-120','NP-123','NP-125','NP-188','NP-186'}
with SessionLocal() as db:
 for e in db.scalars(select(CatalogEntry)).all():
  p=_render_website_listing(db,db.get(WebsiteListing,e.listing_id),'vi')
  if not e.brand:e.brand=p.brand or ('ULINK' if e.group_id in ['09','10','11','12'] else '')
  if not e.unit_size:
   explicit=re.search(r'\b\d+(?:[.,]\d+)?\s*(?:kg|g|ml|lít|lit)\b',p.name,re.I)
   e.unit_size=('200 g / túi' if e.reference in approved200 else '150 g / hũ' if e.reference in {'NP-144','NP-145'} else p.unit_size or (explicit.group() if explicit else ''))
 db.commit()
 print('Known label sizes and brands retained')
