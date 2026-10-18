import json
from pathlib import Path
from sqlalchemy import select
from app.db.session import SessionLocal
from app.db.models import WebsiteListing,WebsiteListingMedia,WebsiteListingTranslation
from app.api.v1.catalog_admin import CatalogEntry
from app.api.v1.storefront import _render_website_listing
items=[(164,'plain-roll','Bánh tráng cuốn','Rice-paper wrappers for fresh rolls'),(229,'plain-frying','Bánh tráng chả giò','Rice-paper wrappers for fried spring rolls'),(231,'plain-strips','Bánh tráng sợi dùng làm bánh tráng trộn','Rice-paper strips for mixed rice-paper snacks'),(232,'plain-cut','Bánh tráng cắt dùng làm bánh tráng trộn','Cut rice-paper pieces for mixed rice-paper snacks')]
def snap(obj):return {c.name:getattr(obj,c.name) for c in obj.__table__.columns}
with SessionLocal() as db:
 backup={};report=[]
 for lid,key,vi,en in items:
  l=db.get(WebsiteListing,lid);assert l.site=='ulink'
  media=db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==lid)).all()
  translations=db.scalars(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==lid)).all()
  entries=db.scalars(select(CatalogEntry).where(CatalogEntry.listing_id==lid)).all()
  backup[str(lid)]=dict(media=[snap(m) for m in media],translations=[snap(t) for t in translations],entries=[snap(e) for e in entries])
  filename='ricepaper-'+key+'-unbranded-v1.png';assert (Path('/app/assets/product-images')/filename).exists()
  url='/api/v1/public/product-images/'+filename
  primary=next((m for m in media if m.is_primary),media[0] if media else None)
  if not primary:primary=WebsiteListingMedia(listing_id=lid,sort_order=0);db.add(primary)
  primary.image_url=url;primary.alt_text=vi+' — ảnh minh hoạ không nhãn';primary.is_primary=True
  for t in translations:
   if t.locale=='vi':t.description=vi+'. Sản phẩm cung ứng theo yêu cầu. Ảnh minh hoạ loại sản phẩm, không có nhãn. Quy cách, số lượng và thời gian giao được xác nhận khi báo giá.'
   elif t.locale=='en':t.description=en+'. Available for sourcing on request. Unbranded illustrative product image. Pack size, quantity and lead time are confirmed with the quote.'
  for e in entries:e.print_description=vi+'. Ảnh minh hoạ sản phẩm không nhãn. Liên hệ để xác nhận quy cách, số lượng và thời gian giao.'
  report.append(dict(listing_id=lid,image_url=url))
 path=Path('/app/exports/before-ricepaper-unbranded-20261017.json')
 if not path.exists():path.write_text(json.dumps(backup,ensure_ascii=False,indent=2,default=str))
 db.commit()
 for row in report:assert _render_website_listing(db,db.get(WebsiteListing,row['listing_id']),'vi').image_url.endswith(row['image_url'])
 print(json.dumps(report,ensure_ascii=False))
