"""Correct Nông Phố listing content and media from owner supplied labels."""
import json
from pathlib import Path
from sqlalchemy import select
from app.db.session import SessionLocal
from app.db.models import WebsiteListing,WebsiteListingTranslation,WebsiteListingMedia,ShowcaseItem
from app.api.v1.catalog_admin import CatalogEntry
from app.api.v1.catalog_studio import CatalogProfile
from app.api.v1.storefront import _render_website_listing
CONFIG=Path('/app/assets/catalog/nongpho-labels-20261017.json')
items=json.loads(CONFIG.read_text())
def fields(obj):return {c.name:getattr(obj,c.name) for c in obj.__table__.columns if c.name not in ['created_at','updated_at']}
with SessionLocal() as db:
 snapshot={};changed=[]
 for x in items:
  primary=Path('/app/assets/product-images')/x['filename']
  if not primary.exists():continue
  lid=x['listing_id'];listing=db.get(WebsiteListing,lid);assert listing.site=='ulink' and listing.showcase_id
  source=db.get(ShowcaseItem,listing.showcase_id)
  translations=db.scalars(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==lid)).all()
  media=db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==lid)).all()
  entries=db.scalars(select(CatalogEntry).where(CatalogEntry.listing_id==lid)).all()
  snapshot[str(lid)]=dict(source=fields(source),translations=[fields(v) for v in translations],media=[fields(v) for v in media],entries=[fields(v) for v in entries])
  source.brand='Nông Phố'
  specs=json.loads(source.specifications or '{}');specs.update(unit_size=x['unit_size'],brand='Nông Phố',country_of_origin='Vietnam',label_source=x['label_source']);source.specifications=json.dumps(specs,ensure_ascii=False)
  for locale in ['vi','en']:
   t=next((t for t in translations if t.locale==locale),None)
   if not t:t=WebsiteListingTranslation(listing_id=lid,locale=locale);db.add(t)
   t.title=x['name_'+locale];t.summary=x['description_'+locale];t.description=x['description_'+locale];t.seo_title=t.title;t.seo_description=t.summary
  for e in entries:e.brand='Nông Phố';e.unit_size=x['unit_size'];e.print_description=x['description_vi']
  new='/api/v1/public/product-images/'+x['filename'];label='/api/v1/public/product-images/'+x['label_filename']
  old_primary=next((m for m in media if m.is_primary),media[0] if media else None)
  if old_primary:old_primary.image_url=new;old_primary.alt_text=x['name_vi']+' — ảnh mô phỏng theo tem';old_primary.sort_order=0;old_primary.is_primary=True
  else:db.add(WebsiteListingMedia(listing_id=lid,image_url=new,alt_text=x['name_vi']+' — ảnh mô phỏng theo tem',sort_order=0,is_primary=True))
  for m in media:
   if m is not old_primary:m.is_primary=False
  if not any(m.image_url==label for m in media):db.add(WebsiteListingMedia(listing_id=lid,image_url=label,alt_text=x['name_vi']+' — tem gốc chủ hàng cung cấp',sort_order=20,is_primary=False))
  changed.append(lid)
 backup=Path('/app/exports/before-nongpho-labels-20261017.json')
 # Append snapshots only for newly corrected listings; retain original rollback values.
 previous=json.loads(backup.read_text()) if backup.exists() else {}
 for k,v in snapshot.items():previous.setdefault(k,v)
 backup.write_text(json.dumps(previous,ensure_ascii=False,indent=2,default=str))
 db.commit()
 for lid in changed:
  p=_render_website_listing(db,db.get(WebsiteListing,lid),'vi');assert p.brand=='Nông Phố';assert p.image_url.endswith(next(x['filename'] for x in items if x['listing_id']==lid))
 print(json.dumps(dict(listings=changed,count=len(changed)),ensure_ascii=False))
