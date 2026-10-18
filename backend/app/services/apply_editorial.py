import json
from pathlib import Path
from sqlalchemy import select
from app.db.session import SessionLocal
from app.api.v1.catalog_studio import CatalogProfile,validated
A=Path('/app/assets/catalog');mapping=json.loads((A/'editorial-banner-map.json').read_text())
groups=json.loads((A/'groups.json').read_text())
for g in groups:
 if not g.get('hero_image'):g['hero_image']=mapping.get(g['id'],'')
(A/'groups.json').write_text(json.dumps(groups,ensure_ascii=False,indent=2))
with SessionLocal() as db:
 profiles=db.scalars(select(CatalogProfile)).all()
 backup=Path('/app/exports/catalog-profiles-before-editorial.json')
 if not backup.exists():backup.write_text(json.dumps([{'id':p.id,'name':p.name,'settings':json.loads(p.settings)} for p in profiles],ensure_ascii=False,indent=2))
 for p in profiles:
  c=json.loads(p.settings)
  for g in c.get('groups',[]):
   if not g.get('hero_image') and not any(g.get('banner_images') or []):g['hero_image']=mapping.get(g['id'],'')
  for key,old,new in [('brand_color','#075B37','#2F4A3A'),('paper_color','#FFFBEF','#FAF7F0'),('pale_color','#EEF2EA','#ECE7DD'),('text_color','#202820','#29352D')]:
   if c.get(key)==old:c[key]=new
  c=validated(c);p.settings=json.dumps(c,ensure_ascii=False)
 db.commit();print('Editorial banners applied to',len(profiles),'profiles; custom images/colors preserved')
