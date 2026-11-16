import json,sqlite3
from pathlib import Path
from sqlalchemy import select
from app.db.session import SessionLocal,engine
from app.db.models import WebsiteListing,WebsiteListingMedia
from app.api.v1.storefront import _render_website_listing
P=Path('/app/exports/brand-catalog-20261115');ROOT=Path('/app/exports/pdp-enrichment-20261115');rows=json.load(open(P/'resolved-manifest.json'))['rows'];result={}
with SessionLocal() as db:
 public=list(db.scalars(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.is_published.is_(True))))
 rendered=[_render_website_listing(db,l,'vi') for l in public];result['published']=len(public);result['missing_images']=sum(not p.image_url for p in rendered)
 result['brands']={b:sum(p.brand==b for p in rendered) for b in ['Cholimex','CHIN-SU']}
 assert all(p.description and p.short_description for p in rendered)
 result['with_description_and_summary']=len(rendered)
 failures=[]
 for r in rows:
  if r['status']=='excluded' and r.get('existing_listing_id'):
   l=db.get(WebsiteListing,r['existing_listing_id'])
   if l.is_published:failures.append(r['code'])
 result['published_excluded']=failures;assert not failures
 result['broken_media']=[]
 for l in public:
  for m in db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id)):
   if not (Path('/app/assets/product-images')/Path(m.image_url).name).is_file():result['broken_media'].append(m.id)
 assert not result['broken_media']
old=sqlite3.connect(str(ROOT/'before-apply.db'));raw=engine.raw_connection()
try:
 old_products=old.execute('select * from products order by id').fetchall();now=raw.cursor().execute('select * from products order by id').fetchall();result['inventory_products_unchanged']=old_products==now;assert result['inventory_products_unchanged']
finally:raw.close();old.close()
(P/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False))
