"""Import 23 sourcing snacks from PT00081; reuse 3 existing inventory listings.
Generated packaging is illustrative, no supplier prices/transaction volumes public.
"""
import json,argparse
from pathlib import Path
from sqlalchemy import select
from app.db.models import ShowcaseItem,WebsiteCategory,WebsiteListing,WebsiteListingTranslation,WebsiteListingMedia
from app.db.session import SessionLocal
# Invoice line, VI, EN, generated image family, flavor, brand
ROWS=[
(1,'Khoai môn sấy vị hành','Onion-Flavored Taro Chips','taro','Hành',''),
(2,'Khoai môn sấy vị trứng muối','Salted Egg Taro Chips','taro','Trứng muối',''),
(3,'Khoai môn sấy vị trứng cua','Crab Roe-Flavored Taro Chips','taro','Trứng cua',''),
(4,'Khoai môn sấy vị hành lá','Scallion-Flavored Taro Chips','taro','Hành lá',''),
(6,'Khoai tây sấy vị hành','Onion-Flavored Potato Chips','potato','Hành',''),
(7,'Khoai tây sấy vị rong biển','Seaweed-Flavored Potato Chips','potato','Rong biển',''),
(9,'Khoai lang sấy vị hành','Onion-Flavored Sweet Potato Chips','sweetyellow','Hành',''),
(10,'Khoai lang tím sấy','Purple Sweet Potato Chips','sweetpurple','',''),
(11,'Khoai lang vàng sấy','Yellow Sweet Potato Chips','sweetyellow','',''),
(12,'Sa kê sấy giòn','Crispy Breadfruit Chips','breadfruit','',''),
(13,'Khoai môn cọng vị hành cay','Spicy Onion Taro Sticks','tarosticks','Hành cay',''),
(14,'Sa kê sấy vị mắm hành','Fish Sauce and Onion Breadfruit Chips','breadfruit','Mắm hành',''),
(15,'Chuối Laba sấy giòn','Crispy Laba Banana Chips','banana','',''),
(16,'Kẹo me Hiệp Ký','Hiệp Ký Tamarind Candy','tamarind','','Hiệp Ký'),
(17,'Mít sấy giòn','Crispy Jackfruit','jackfruit','',''),
(18,'Củ quả sấy giòn','Mixed Vegetable Chips','mixveg','',''),
(19,'Kẹo dâu tằm','Mulberry Candy','mulberry','',''),
(20,'Kẹo dâu tây','Strawberry Candy','strawberry','',''),
(21,'Kẹo dẻo hương trái cây','Fruit-Flavored Gummy Candy','gummy','',''),
(22,'Bắp rang vị trứng muối — bán thành phẩm','Salted Egg Popcorn — Semi-Finished Product','popcorn','Trứng muối',''),
(23,'Sữa chua trái cây sấy thăng hoa mix vị','Mixed Fruit Freeze-Dried Yogurt','yogurt','Mix vị',''),
(24,'Sầu riêng sấy thăng hoa','Freeze-Dried Durian','durian','',''),
(26,'Nấm sấy giòn','Crispy Mushroom Snacks','mushroom','',''),
]
REUSED={5:'KHOAI_TAY_MAM_OT',8:'KHOAI_LANG_TIM_SAY',25:'KHOAI_LANG_SAY'}
assert set(r[0] for r in ROWS)|set(REUSED)==set(range(1,27))
def main(apply):
 with SessionLocal() as db:
  cat=db.scalar(select(WebsiteCategory).where(WebsiteCategory.site=='ulink',WebsiteCategory.slug=='snacks'));assert cat
  created=0
  for n,vi,en,img,flavor,brand in ROWS:
   code=f'SC-MD-PT00081-{n:02d}';s=db.scalar(select(ShowcaseItem).where(ShowcaseItem.code==code))
   print('NEW' if not s else 'EXISTING',code,vi)
   if not apply:continue
   filename=f'md-snack-{img}.webp';assert (Path(__file__).resolve().parents[1]/'assets/product-images'/filename).is_file(),filename
   dv=vi+'. Sản phẩm cung ứng theo yêu cầu; liên hệ ULINK để xác nhận mẫu, quy cách đóng gói, số lượng và thời gian giao. Ảnh do AI tạo để minh họa loại sản phẩm và phong cách bao bì; hình dạng, màu sắc và nhãn thực tế có thể khác.'
   de=en+'. Available for wholesale sourcing; contact ULINK to confirm samples, packaging, quantities and lead time. AI-generated imagery illustrates the product type and packaging style; actual shape, color and labels may differ.'
   if n==22:
    dv+=' Hóa đơn ghi bán thành phẩm; cần xác nhận công đoạn hoàn thiện trước khi sử dụng hoặc bán lẻ.'
    de+=' The source document identifies a semi-finished product; confirm any finishing requirements before use or retail sale.'
   specs={'Hương vị':flavor} if flavor else {}
   if n==22:specs['Tình trạng sản phẩm']='Bán thành phẩm — xác nhận công đoạn hoàn thiện'
   if not s:
    s=ShowcaseItem(code=code,name=vi,category='Snacks & dried fruit',category_slug='snacks',description=dv,highlights='[]',specifications=json.dumps(specs,ensure_ascii=False),images='[]',brand=brand,min_order_quantity=1,lead_time=None,badges='[]',sort_order=1500+n,is_active=True);db.add(s);db.flush();created+=1
   l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.showcase_id==s.id))
   if not l:l=WebsiteListing(site='ulink',showcase_id=s.id,category_id=cat.id,is_published=True,sort_order=s.sort_order);db.add(l);db.flush()
   for lang,title,desc in [('vi',vi,dv),('en',en,de)]:
    t=db.scalar(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==l.id,WebsiteListingTranslation.locale==lang))
    if not t:t=WebsiteListingTranslation(listing_id=l.id,locale=lang);db.add(t)
    t.title=title;t.summary=desc;t.description=desc;t.seo_title=title;t.seo_description=desc[:300]
   url='/api/v1/public/product-images/'+filename
   if not db.scalar(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id,WebsiteListingMedia.image_url==url)):
    db.add(WebsiteListingMedia(listing_id=l.id,image_url=url,alt_text=vi+' — ảnh minh họa tạo bằng AI',sort_order=0,is_primary=True))
  if apply:db.commit()
  print('Created',created,'; reused inventory',REUSED,'; contract note line27 excluded')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');main(p.parse_args().apply)
