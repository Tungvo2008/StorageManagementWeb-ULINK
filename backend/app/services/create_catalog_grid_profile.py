import json
from datetime import datetime,timezone
from sqlalchemy import select
from app.db.session import SessionLocal
from app.api.v1.catalog_studio import CatalogProfile,validated
with SessionLocal() as db:
 original=db.get(CatalogProfile,1);c=json.loads(original.settings);c.update(product_layout='grid',grid_density='compact',show_description=False)
 c=validated(c);name='ULINK · Wholesale Grid · A4 dọc'
 profile=db.scalar(select(CatalogProfile).where(CatalogProfile.name==name))
 if not profile:profile=CatalogProfile(name=name,settings=json.dumps(c,ensure_ascii=False),updated_at=datetime.now(timezone.utc).isoformat());db.add(profile);db.commit()
 print(profile.id)
 assert json.loads(original.settings).get('product_layout','editorial')=='editorial'
