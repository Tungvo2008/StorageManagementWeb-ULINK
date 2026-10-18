import copy,json
from datetime import datetime,timezone
from sqlalchemy import select
from app.db.session import engine,SessionLocal
from app.api.v1.catalog_studio import CatalogProfile,validated
from app.api.v1.catalog_admin import CatalogEntry,groups
from app.services.catalog_settings import DEFAULTS
CatalogProfile.__table__.create(engine,checkfirst=True)
with SessionLocal() as db:
 if not db.scalar(select(CatalogProfile.id)):
  c=copy.deepcopy(DEFAULTS);c['groups']=groups();c['entry_ids']=[e.id for e in db.scalars(select(CatalogEntry).where(CatalogEntry.enabled==True)).all()]
  db.add(CatalogProfile(name='ULINK · Wholesale · Gourmet',settings=json.dumps(validated(c),ensure_ascii=False),updated_at=datetime.now(timezone.utc).isoformat()));db.commit()
 print('Catalog Studio profiles ready')
