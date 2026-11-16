import json
from sqlalchemy import select
from app.db.session import SessionLocal
from app.db.models import WebsiteListing,WebsiteListingTranslation,WebsiteListingMedia,Product,ShowcaseItem
from app.api.v1.storefront import _render_website_listing
rows=[]
with SessionLocal() as db:
 for l in db.scalars(select(WebsiteListing).where(WebsiteListing.site=='ulink')):
  try:p=_render_website_listing(db,l,'vi')
  except Exception:continue
  s=db.get(ShowcaseItem,l.showcase_id) if l.showcase_id else db.get(Product,l.product_id)
  rows.append({'listing_id':l.id,'product_id':l.product_id,'showcase_id':l.showcase_id,'sku':p.sku,'vi':p.model_dump(mode='json'),'en':_render_website_listing(db,l,'en').model_dump(mode='json'),'canonical_description':s.description,'canonical_specifications':s.specifications,'translations':[{'locale':t.locale,'title':t.title,'summary':t.summary,'description':t.description,'seo_title':t.seo_title,'seo_description':t.seo_description} for t in db.scalars(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==l.id))]})
print(json.dumps(rows,ensure_ascii=False,indent=2))
