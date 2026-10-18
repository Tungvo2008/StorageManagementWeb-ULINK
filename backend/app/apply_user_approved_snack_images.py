"""Replace incorrect Codex mockups with exact owner-approved images. No image generation."""
import json
from pathlib import Path
from sqlalchemy import select
from app.db.models import ShowcaseItem,Product,WebsiteCategory,WebsiteListing,WebsiteListingMedia,WebsiteListingTranslation
from app.db.session import SessionLocal
ROWS=json.loads((Path(__file__).parent/'user_approved_snack_images.json').read_text())
with SessionLocal() as db:
 cat=db.scalar(select(WebsiteCategory).where(WebsiteCategory.site=='ulink',WebsiteCategory.slug=='snacks'));assert cat
 # Retire generated snack art on all PT00081 listings, including items awaiting correct photos.
 for s in db.scalars(select(ShowcaseItem).where(ShowcaseItem.code.like('SC-MD-PT00081-%'))):
  l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.showcase_id==s.id))
  if not l:continue
  for m in list(db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id))):
   if any(prefix in m.image_url for prefix in ['/md-snack-','/md-labeled-','/ulink-t9-label-']):db.delete(m)
  specs=json.loads(s.specifications or '{}')
  if 'Kích thước túi' in specs:specs.pop('Kích thước túi')
  s.specifications=json.dumps(specs,ensure_ascii=False)
  if s.code not in {r['code'] for r in ROWS}:
   for t in db.scalars(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==l.id)):
    desc=(t.title+'. Sản phẩm cung ứng theo yêu cầu. Ảnh sản phẩm đang cập nhật; liên hệ ULINK để xác nhận mẫu, quy cách, số lượng và thời gian giao.' if t.locale=='vi' else t.title+'. Available for wholesale sourcing. Product photo is being updated; contact ULINK to confirm samples, packaging, quantities and lead time.')
    t.description=desc;t.summary=desc;t.seo_description=desc
    if t.locale=='vi':s.description=desc
 db.flush()
 created=0
 for row in ROWS:
  code=row['code'];vi=row['vi'];en=row['en'];p=None
  if code.startswith('SC-'):
   s=db.scalar(select(ShowcaseItem).where(ShowcaseItem.code==code))
   if not s:
    s=ShowcaseItem(code=code,name=vi,category='Snacks & dried fruit',category_slug='snacks',description='',highlights='[]',specifications='{}',images='[]',brand='ULINK',min_order_quantity=1,lead_time=None,badges='[]',sort_order=1600+created,is_active=True);db.add(s);db.flush();created+=1
   l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.showcase_id==s.id))
   if not l:l=WebsiteListing(site='ulink',showcase_id=s.id,category_id=cat.id,is_published=True,sort_order=s.sort_order);db.add(l);db.flush()
   specs=json.loads(s.specifications or '{}');specs.pop('Kích thước túi',None);specs['Khối lượng tịnh']=str(row['weight'])+' g';specs['Đơn vị đóng gói']=row['pack'];s.specifications=json.dumps(specs,ensure_ascii=False);s.name=vi;s.brand='ULINK'
  else:
   p=db.scalar(select(Product).where(Product.sku==code));assert p,code
   l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.product_id==p.id));assert l,code
  for lang,title in [('vi',vi),('en',en)]:
   summary=(f"{vi}. {row['weight']} g/{row['pack'].lower()}. Liên hệ ULINK để xác nhận quy cách, số lượng và thời gian giao." if lang=='vi' else f"{en}. {row['weight']}g per {'jar' if row['pack']=='Hũ' else 'pouch'}. Contact ULINK to confirm packaging, quantities and delivery timing.")
   desc=summary+(' Ảnh do ULINK cung cấp.' if lang=='vi' else 'Image supplied by ULINK.')
   t=db.scalar(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==l.id,WebsiteListingTranslation.locale==lang))
   if not t:t=WebsiteListingTranslation(listing_id=l.id,locale=lang);db.add(t)
   t.title=title;t.summary=summary;t.description=desc;t.seo_title=title;t.seo_description=summary
   if p is None and lang=='vi':s.description=desc
  filename=row['filename'];assert (Path(__file__).resolve().parents[1]/'assets/product-images'/filename).is_file(),filename
  # Owner explicitly replaces previous images; do not retain conflicting old packaging in gallery.
  for m in list(db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id))):db.delete(m)
  db.flush()
  db.add(WebsiteListingMedia(listing_id=l.id,image_url='/api/v1/public/product-images/'+filename,alt_text=vi+' — ảnh ULINK cung cấp',sort_order=0,is_primary=True))
  print('Approved',code,vi)
 db.commit()
 print('Created',created,'new showcase items; applied',len(ROWS),'approved images')
