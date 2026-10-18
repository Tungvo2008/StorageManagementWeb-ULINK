import json
from pathlib import Path
from app.db.session import SessionLocal
from app.api.v1.catalog_studio import CatalogProfile
with SessionLocal() as db:
 p=db.get(CatalogProfile,3);backup=Path('/app/exports/grid-before-image-sizing-20261017.json')
 if not backup.exists():backup.write_text(p.settings)
 c=json.loads(p.settings);c['grid_density']='comfortable';p.settings=json.dumps(c,ensure_ascii=False);db.commit();print('Profile 3 uses consistent images, 9 per continuation page')
