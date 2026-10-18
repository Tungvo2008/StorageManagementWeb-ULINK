import json,hashlib
from pathlib import Path
from sqlalchemy import select
from app.db.session import SessionLocal
from app.db.models import WebsiteListing,WebsiteListingMedia
from app.api.v1.catalog_studio import CatalogProfile
from app.api.v1.storefront import _render_website_listing
items=json.loads(Path('/app/assets/catalog/packshot-cleanup-v2.json').read_text())
def snap(x):return {c.name:getattr(x,c.name) for c in x.__table__.columns}
with SessionLocal() as db:
 changes=[];before={};profiles=db.scalars(select(CatalogProfile)).all();mapping={}
 for x in items:
  l=db.get(WebsiteListing,x['listing_id']);assert l.site=='ulink'
  path=Path('/app/assets/product-images')/x['new_url'].rsplit('/',1)[-1];assert path.exists()
  if x.get('output_sha256'):assert hashlib.sha256(path.read_bytes()).hexdigest()==x['output_sha256']
  rows=db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id)).all()
  old=x['image_url'].rsplit('/',1)[-1]
  for m in rows:
   if m.image_url.rsplit('/',1)[-1]==old:
    before[str(m.id)]=snap(m);mapping[m.image_url]=x['new_url'];mapping[x['image_url']]=x['new_url'];m.image_url=x['new_url'];changes.append(dict(media_id=m.id,listing_id=l.id,reference=x['reference']))
 backup=Path('/app/exports/before-packshot-cleanup-v2.json')
 if not backup.exists():backup.write_text(json.dumps(dict(media=before,profiles=[dict(id=p.id,settings=p.settings) for p in profiles]),ensure_ascii=False,indent=2,default=str))
 for p in profiles:
  c=json.loads(p.settings);changed=False
  for o in c.get('overrides',{}).values():
   if o.get('image_url') in mapping:o['image_url']=mapping[o['image_url']];changed=True
  if changed:p.settings=json.dumps(c,ensure_ascii=False)
 db.commit()
 for x in items:
  p=_render_website_listing(db,db.get(WebsiteListing,x['listing_id']),'vi');assert p.image_url.endswith(x['new_url'])
 report=dict(assets=len(items),media_updated=len(changes),listings_updated=len(set(x['listing_id'] for x in changes)),changes=changes)
 Path('/app/exports/packshot-cleanup-v2-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='changes'}))
