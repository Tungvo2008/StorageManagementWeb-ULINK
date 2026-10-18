import json
from pathlib import Path
from sqlalchemy import select
from app.db.session import SessionLocal
from app.api.v1.catalog_studio import CatalogProfile
with SessionLocal() as db:
 rows=db.scalars(select(CatalogProfile)).all();backup=Path('/app/exports/before-cover-20261017.json')
 if not backup.exists():backup.write_text(json.dumps([dict(id=p.id,settings=p.settings) for p in rows],ensure_ascii=False,indent=2))
 for p in rows:
  cfg=json.loads(p.settings);cfg.update(title='PRODUCT',subtitle='CATALOG',cover_tagline='Kết nối tinh hoa Việt đến thị trường Mỹ',cover_image='/api/v1/public/product-images/ulink-cover-seamless-ivory-v2.png');p.settings=json.dumps(cfg,ensure_ascii=False)
 db.commit();print('Updated',len(rows),'profiles')
