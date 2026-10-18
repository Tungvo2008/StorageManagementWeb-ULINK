"""Idempotent bootstrap. No inventory rows or existing website media are changed."""
import json
from pathlib import Path
from sqlalchemy import select
from app.db.session import SessionLocal,engine
from app.api.v1.catalog_admin import CatalogEntry
CatalogEntry.__table__.create(engine,checkfirst=True)
m=json.loads(Path('/app/assets/catalog/ulink-catalog-map.json').read_text())
with SessionLocal() as db:
 for order,r in enumerate(m['rows']):
  if db.scalar(select(CatalogEntry.id).where(CatalogEntry.reference==r['catalog_code'])):continue
  db.add(CatalogEntry(listing_id=r['listing_id'],reference=r['catalog_code'],group_id=r['group_id'],sort_order=order,enabled=True))
 db.commit()
 print('Catalog entries:',len(db.scalars(select(CatalogEntry)).all()))
