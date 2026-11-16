import json,sqlite3,sys
from pathlib import Path
from sqlalchemy import select
from app.db.session import SessionLocal,engine
from app.db.models import WebsiteListing,WebsiteListingTranslation,WebsiteListingMedia,ShowcaseItem
from app.api.v1.catalog_admin import CatalogEntry
from app.api.v1.catalog_studio import CatalogProfile
P=Path('/app/exports/brand-catalog-20261115');rows=json.load(open(P/'followup-manifest.json'))['rows'];apply='--apply'in sys.argv
with SessionLocal() as db:
 ready=[]
 for r in rows:
  l=db.get(WebsiteListing,r['result_listing_id']);s=db.get(ShowcaseItem,l.showcase_id)
  assert l.site=='ulink' and not l.is_published and s.code==r['result_sku']
  ts=list(db.scalars(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==l.id)))
  for t in ts:
   assert all(getattr(t,k)==v for k,v in r['expected_translations'][t.locale].items()),('Intervening edit',l.id)
  if apply:
   for t in ts:
    for k,v in r['translations'][t.locale].items():setattr(t,k,v)
  ms=list(db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id)))
  for a in r['assets']:
   assert (Path('/app/assets/product-images')/a['filename']).is_file()
   if not any(Path(m.image_url).name==a['filename'] for m in ms):
    m=WebsiteListingMedia(listing_id=l.id,image_url='/api/v1/public/product-images/'+a['filename'],alt_text=a.get('pack_name') or r['translations']['vi']['title'],sort_order=len(ms),is_primary=not ms);db.add(m);ms.append(m)
    if not s.image_url and apply:s.image_url=m.image_url
  assert ms,('Missing photo',s.code)
  ce=db.scalar(select(CatalogEntry).where(CatalogEntry.listing_id==l.id));assert ce
  if apply:l.is_published=True;ce.enabled=True
  ready.append(ce.id)
 for pid in [1,3]:
  p=db.get(CatalogProfile,pid);settings=json.loads(p.settings)
  if settings.get('entry_ids') is not None:settings['entry_ids']=list(dict.fromkeys(settings['entry_ids']+ready))
  if apply:p.settings=json.dumps(settings,ensure_ascii=False)
 if apply:
  backup=P/'before-followup.db';assert not backup.exists(),'Follow-up already applied'
  with engine.connect() as c:
   dst=sqlite3.connect(str(backup));c.connection.driver_connection.backup(dst);dst.close()
  db.commit()
 else:db.rollback()
print(json.dumps({'apply':apply,'listings':[r['result_sku'] for r in rows]}))
