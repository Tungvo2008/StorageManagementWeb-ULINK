"""Apply user-filled showcase TXT, dated 2026-10-11; no inventory changes."""
import json
from pathlib import Path
from sqlalchemy import select
from app.db.models import ShowcaseItem,WebsiteListing,WebsiteListingMedia,WebsiteListingTranslation
from app.db.session import SessionLocal
ROWS={
169:('Sting vị việt quất','Sting Blueberry Energy Drink','Sting',{}),
175:('Trà bí đao Wonderfarm','Wonderfarm Winter Melon Tea','Wonderfarm',{}),
178:('Cà phê hòa tan G7 3 trong 1 — bịch 1,6 kg','G7 3-in-1 Instant Coffee — 1.6kg Bag','G7',{'Quy cách':'Bịch trực thăng 1,6 kg (100 gói × 16 g)'}),
186:('Đậu xanh nguyên hạt','Whole Mung Beans','',{}),187:('Đậu xanh cà vỏ','Peeled Split Mung Beans','',{}),188:('Đậu đen','Black Beans','',{}),189:('Đậu đen xanh lòng','Black Beans with Green Centers','',{}),190:('Đậu phộng','Peanuts','',{}),
193:('Đường phèn kim cương','Diamond Rock Sugar','ULINK',{'Loại đường':'Đường phèn kim cương — tên loại, không phải thương hiệu'}),194:('Tiêu sọ','White Peppercorns','',{}),
197:('Nước mắm Thuận Phát 40N — 610 ml','Thuận Phát 40N Fish Sauce — 610ml','Thuận Phát',{'Độ đạm':'40N','Quy cách':'12 chai × 610 ml','Khối lượng thùng theo thông tin cung cấp':'12 kg'}),
198:('Nước mắm cá cơm nhĩ Hưng Thịnh 40N — 750 ml','Hưng Thịnh 40N Anchovy Fish Sauce — 750ml','Hưng Thịnh',{'Độ đạm':'40N','Quy cách':'12 chai × 750 ml','Khối lượng thùng theo thông tin cung cấp':'12 kg'}),
199:('Bánh tráng dừa Bình Định','Bình Định Coconut Rice Paper','',{}),200:('Bánh tráng cuốn','Rice Paper Wrappers','',{}),201:('Bánh tráng khoai lang','Sweet Potato Rice Paper','',{}),202:('Bánh tráng tôm','Shrimp Rice Paper','',{}),203:('Hành phi','Fried Shallots','',{}),
205:('Súp hải sản iSoup — 14 g × 30','iSoup Seafood Soup — 14g × 30','iSoup',{'Quy cách':'14 g × 30'}),
206:('Súp nấm tuyết tóc tiên iSoup — 14 g × 30','iSoup Snow Fungus and Black Moss Soup — 14g × 30','iSoup',{'Quy cách':'14 g × 30'}),
207:('Súp cá hồi yến mạch iSoup — 23 g × 30','iSoup Salmon and Oat Soup — 23g × 30','iSoup',{'Quy cách':'23 g × 30'}),
208:('Súp cá hồi yến mạch iSoup — 69 g × 15','iSoup Salmon and Oat Soup — 69g × 15','iSoup',{'Quy cách':'69 g × 15'}),
209:('Súp hải sản iSoup — 42 g × 15','iSoup Seafood Soup — 42g × 15','iSoup',{'Quy cách':'42 g × 15'}),
210:('Trà đào cam sả iChill — 120 g × 15','iChill Peach, Orange and Lemongrass Tea — 120g × 15','iChill',{'Quy cách':'120 g × 15'}),
211:('Sâm long nhãn nấm tuyết hạt chia iChill — 27 g × 24','iChill Longan, Snow Fungus and Chia Drink — 27g × 24','iChill',{'Quy cách':'27 g × 24'}),
212:('Sâm long nhãn nấm tuyết hạt chia iChill — 108 g × 15','iChill Longan, Snow Fungus and Chia Drink — 108g × 15','iChill',{'Quy cách':'108 g × 15'}),
213:('Canh chua chay iSoup — 50 g × 20','iSoup Vegetarian Sweet and Sour Soup — 50g × 20','iSoup',{'Quy cách':'50 g × 20'}),
214:('Canh măng chua nấm hương iSoup — 50 g × 20','iSoup Sour Bamboo Shoot and Shiitake Soup — 50g × 20','iSoup',{'Quy cách':'50 g × 20'}),
}
BULK={186,187,188,189,190,193,194}
GENERIC=BULK|{199,200,201,202,203}
def main():
 with SessionLocal() as db:
  for n,(vi,en,brand,specs) in ROWS.items():
   code=f'SC-UL0045-{n}';s=db.scalar(select(ShowcaseItem).where(ShowcaseItem.code==code));assert s,code
   l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.showcase_id==s.id));assert l,code
   filename=f'worldmarket-{n}.webp';assert (Path(__file__).resolve().parents[1]/'assets/product-images'/filename).is_file(),filename
   dv=f'{vi}. Sản phẩm cung ứng theo yêu cầu; liên hệ ULINK để xác nhận số lượng và thời gian giao.'
   de=f'{en}. Available on request; contact ULINK to confirm quantities and delivery timing.'
   if n in GENERIC:
    dv+=' Ảnh minh họa loại sản phẩm, không đại diện cho bao bì cố định. Quy cách đóng gói theo nhu cầu khách hàng.'
    de+=' Illustrative product photo; packaging can be arranged to customer requirements.'
   if n in BULK:
    dv+=' Nguyên liệu mua xá tại Việt Nam rồi đóng gói theo yêu cầu.'
    de+=' Bulk ingredients sourced in Vietnam and packed to order.'
   if n in {208,209}:
    dv+=' Ảnh bao bì tham khảo từ hãng có thể khác trọng lượng; quy cách trong báo giá cần được xác nhận trước khi đặt hàng.'
    de+=' Manufacturer packaging shown may have a different weight; the quoted pack specification must be confirmed before ordering.'
   s.name=vi;s.brand=brand;s.description=dv;s.specifications=json.dumps(specs,ensure_ascii=False)
   for locale,title,desc in [('vi',vi,dv),('en',en,de)]:
    t=db.scalar(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==l.id,WebsiteListingTranslation.locale==locale))
    if not t:t=WebsiteListingTranslation(listing_id=l.id,locale=locale);db.add(t)
    t.title=title;t.description=desc;t.summary=desc;t.seo_title=title;t.seo_description=desc[:300]
   url='/api/v1/public/product-images/'+filename
   current=list(db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id)))
   for m in current:m.is_primary=m.image_url==url
   if not any(m.image_url==url for m in current):db.add(WebsiteListingMedia(listing_id=l.id,image_url=url,alt_text=vi+' — ảnh tham khảo',sort_order=0,is_primary=True))
   print(code,vi)
  db.commit()
if __name__=='__main__':main()
