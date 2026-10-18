"""Apply owner-provided T9 label artwork and product corrections, pouch 18x26cm.
Website listings only; inventory/invoice source unchanged.
"""
import json
from pathlib import Path
from sqlalchemy import select
from app.db.models import ShowcaseItem,Product,WebsiteListing,WebsiteListingMedia,WebsiteListingTranslation
from app.db.session import SessionLocal
# invoice line, PDF page, VI, EN, weight
ROWS=[
(1,7,'Khoai môn sấy vị hành','Green Onion Taro Chips',200),
(2,8,'Khoai môn trứng muối','Salted Egg Taro Chips',200),
(3,9,'Khoai môn sợi vị cua','Crab-Flavored Taro Sticks',200),
(4,26,'Khoai môn sấy vị hành lá','Scallion Taro Chips',200),
(6,2,'Khoai tây vị hành','Green Onion Potato Chips',200),
(7,3,'Khoai tây rong biển','Seaweed Potato Chips',200),
(9,21,'Khoai lang tím sấy hành','Green Onion Purple Sweet Potato Chips',200),
(10,18,'Khoai lang tím sấy','Purple Sweet Potato Chips',200),
(11,17,'Khoai lang vàng sấy','Yellow Sweet Potato Chips',200),
(12,11,'Sa kê sấy giòn','Crispy Breadfruit Chips',200),
(13,25,'Khoai môn sợi hành cay','Spicy Green Onion Taro Sticks',200),
(14,10,'Sa kê mắm hành','Fish Sauce and Green Onion Breadfruit Chips',200),
(17,12,'Mít sấy','Dried Jackfruit',200),
(18,13,'Rau củ sấy','Mixed Vegetable Chips',200),
(22,16,'Bỏng ngô vị trứng muối','Salted Egg Popcorn',200),
(24,15,'Sầu riêng sấy thăng hoa','Freeze-Dried Durian',100),
(26,14,'Nấm hương sấy giòn','Crispy Shiitake Mushrooms',150),
]
OLD=[('KHOAI_TAY_MAM_OT',1),('KHOAI_LANG_TIM_SAY',4),('KHOAI_LANG_SAY',24),('CHUOI_CAU_SAY',6)]
def media(db,l,url,alt,primary,order):
 m=db.scalar(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id,WebsiteListingMedia.image_url==url))
 if not m:m=WebsiteListingMedia(listing_id=l.id,image_url=url);db.add(m)
 m.alt_text=alt;m.is_primary=primary;m.sort_order=order
with SessionLocal() as db:
 for n,page,vi,en,weight in ROWS:
  code=f'SC-MD-PT00081-{n:02d}';s=db.scalar(select(ShowcaseItem).where(ShowcaseItem.code==code));assert s
  l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.showcase_id==s.id));assert l
  files=[f'md-labeled-{n:02d}-v2.webp',f'ulink-t9-label-{page:02d}.webp']
  for f in files:assert (Path(__file__).resolve().parents[1]/'assets/product-images'/f).exists(),f
  s.name=vi;s.brand='ULINK'
  specs=json.loads(s.specifications or '{}');specs.pop('Tình trạng sản phẩm',None)
  specs['Khối lượng tịnh']=f'{weight} g';specs['Kích thước túi']='18 × 26 cm';specs['Đơn vị đóng gói']='Túi'
  if n==3:specs['Hương vị']='Vị cua';specs['Dạng sản phẩm']='Sợi'
  if n==9:specs['Nguyên liệu chính']='Khoai lang tím'
  if n==26:specs['Nguyên liệu chính']='Nấm hương'
  s.specifications=json.dumps(specs,ensure_ascii=False)
  for lang,title in [('vi',vi),('en',en)]:
   summary=('Sản phẩm cung ứng theo yêu cầu; liên hệ ULINK để xác nhận số lượng và thời gian giao.' if lang=='vi' else 'Available for wholesale sourcing; contact ULINK to confirm quantities and delivery timing.')
   desc=title+'. '+summary+'\n\n'+(f'Khối lượng tịnh: {weight} g. Túi: 18 × 26 cm. Nhãn sản phẩm gốc có trong thư viện ảnh. Ảnh túi là phối cảnh minh họa bằng AI dựa trên nhãn ULINK; hình dạng thực tế có thể khác.' if lang=='vi' else f'Net weight: {weight}g. Pouch: 18 × 26cm. Original product label is included in the gallery. The pouch image is an AI-generated mockup based on the ULINK label; actual appearance may differ.')
   t=db.scalar(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==l.id,WebsiteListingTranslation.locale==lang));assert t
   t.title=title;t.summary=summary;t.description=desc;t.seo_title=title;t.seo_description=summary
   if lang=='vi':s.description=desc
  for m in list(db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id))):
   if '/md-snack-' in m.image_url:db.delete(m)
   else:m.is_primary=False
  media(db,l,'/api/v1/public/product-images/'+files[0],vi+' — phối cảnh túi 18 × 26 cm, ảnh AI',True,0)
  media(db,l,'/api/v1/public/product-images/'+files[1],vi+' — nhãn ULINK gốc',False,1)
  print('Updated',code,vi,weight)
 # User confirms Laba and Cau are same; use existing Product's listing, hide duplicate sourcing card.
 dup=db.scalar(select(ShowcaseItem).where(ShowcaseItem.code=='SC-MD-PT00081-15'));assert dup
 dl=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.showcase_id==dup.id));assert dl;dl.is_published=False
 for sku,page in OLD:
  p=db.scalar(select(Product).where(Product.sku==sku));assert p,sku
  l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.product_id==p.id));assert l,sku
  filename=f'ulink-t9-label-{page:02d}.webp';assert (Path(__file__).resolve().parents[1]/'assets/product-images'/filename).exists()
  media(db,l,'/api/v1/public/product-images/'+filename,p.name+' — nhãn ULINK gốc',False,10)
 db.commit()
print('Updated 17 mockups, 21 original label galleries; merged banana duplicate into existing CHUOI_CAU_SAY')
