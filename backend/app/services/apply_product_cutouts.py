"""Install reviewed cutouts in canonical ULINK listing media; preserve originals."""
import json,hashlib
from pathlib import Path
from datetime import datetime,timezone
from sqlalchemy import select
from app.db.session import SessionLocal
from app.db.models import WebsiteListing,WebsiteListingMedia
from app.api.v1.catalog_studio import CatalogProfile
manifest=json.loads(Path('/app/assets/catalog/product-cutouts-20261017.json').read_text())
lookup={x['filename']:x for x in manifest}
def replacement(url):
 x=lookup.get((url or '').split('?')[0].rsplit('/',1)[-1])
 return x['new_url'] if x else None
with SessionLocal() as db:
 allrows=db.execute(select(WebsiteListingMedia,WebsiteListing.site).join(WebsiteListing,WebsiteListing.id==WebsiteListingMedia.listing_id)).all()
 before=[dict(id=m.id,listing_id=m.listing_id,site=s,image_url=m.image_url,alt_text=m.alt_text,sort_order=m.sort_order,is_primary=m.is_primary) for m,s in allrows]
 profiles=db.scalars(select(CatalogProfile)).all()
 backup=Path('/app/exports/before-product-cutouts-20261017.json')
 if not backup.exists():backup.write_text(json.dumps(dict(media=before,profiles=[dict(id=p.id,settings=p.settings) for p in profiles]),ensure_ascii=False,indent=2))
 changes=[]
 for m,site in allrows:
  new=replacement(m.image_url) if site=='ulink' else None
  if new and new!=m.image_url:
   asset=Path('/app/assets/product-images')/new.rsplit('/',1)[-1]
   assert asset.exists(),asset
   changes.append(dict(id=m.id,listing_id=m.listing_id,old=m.image_url,new=new));m.image_url=new
 overrides=0
 for p in profiles:
  settings=json.loads(p.settings);changed=False
  for o in settings.get('overrides',{}).values():
   new=replacement(o.get('image_url'))
   if new and new!=o.get('image_url'):o['image_url']=new;changed=True;overrides+=1
  if changed:p.settings=json.dumps(settings,ensure_ascii=False)
 db.commit()
 # Exact audit: no fields outside selected ULINK image URLs changed.
 for m,site in allrows:
  old=next(b for b in before if b['id']==m.id)
  expected=replacement(old['image_url']) if site=='ulink' else None
  assert m.image_url==(expected or old['image_url'])
  assert (m.alt_text,m.sort_order,m.is_primary)==(old['alt_text'],old['sort_order'],old['is_primary'])
 report=dict(derivatives=len(manifest),media_changed=len(changes),listings_changed=len(set(c['listing_id'] for c in changes)),profile_overrides_changed=overrides,changes=changes,verified_other_sites_unchanged=True)
 Path('/app/exports/product-cutouts-result-20261017.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print(json.dumps({k:v for k,v in report.items() if k!='changes'}))
