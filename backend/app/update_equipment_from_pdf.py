"""Update Ulink showcase from the user-approved VIDELI equipment quotation.
Run from ERP backend; preserves invoice records and private supplier prices.
"""
import json
from pathlib import Path
from sqlalchemy import select
from app.db.models import ShowcaseItem, WebsiteListing, WebsiteListingMedia, WebsiteListingTranslation
from app.db.session import SessionLocal

POWER = '220V 1 pha / 220–380V 3 pha'
MATERIAL = 'Inox 304 và các vật liệu khác'
ROWS = [
('SC-UL0044-156','Máy trộn bột 8kg FOENIX','FOENIX 8kg Dough Mixer','foenix-mixer.webp','FOENIX ENGINEERING',{
'Model':'BM-MT-00-FN-08-304-220-01-26-KL','Kích thước':'1050 × 550 × 1010 mm','Điện áp':POWER,'Khối lượng':'160 kg','Điện năng tiêu thụ (theo tài liệu)':'2,4 kWh','Năng suất':'8 kg/lần','Chất liệu':MATERIAL,'Năm sản xuất':'2026'},'Máy trộn bột năng suất 8 kg mỗi lần, phục vụ công đoạn chuẩn bị bột cho cơ sở làm bánh.','Dough mixer with an 8kg batch capacity for bakery dough preparation.'),
('EQ-DOUGH-DIV','Máy chia bột vo tròn tự động SM-936A — 30 viên','SM-936A Automatic Dough Divider and Rounder — 30 Pieces','foenix-divider.webp','',{
'Model':'SM-936A','Số lượng chia':'30 viên','Trọng lượng bột':'30–100 g/viên','Điện áp':POWER,'Công suất':'1,1 kW','Khối lượng':'560 kg','Kích thước':'800 × 600 × 1600 mm','Xuất xứ':'Đài Loan','Tình trạng theo tài liệu':'Hàng thanh lý đã qua sử dụng'},'Máy chia và vo tròn bột tự động thành 30 viên. Thiết bị trong tài liệu là hàng thanh lý đã qua sử dụng; tình trạng cụ thể được xác nhận trong báo giá.','Automatic dough dividing and rounding into 30 pieces. The source quotation describes used liquidation equipment; actual condition will be confirmed in the quote.'),
('SC-UL0044-158','Máy se bột 6 lô 2 băng FOENIX','FOENIX 6-Roller Double-Belt Dough Moulder','foenix-moulder.webp','FOENIX ENGINEERING',{
'Model':'BM-MS-00-FN-62-304-220-01-25-KL','Kích thước':'1220 × 730 × 1040 mm','Điện áp':POWER,'Khối lượng':'180 kg','Công suất':'400 W','Năng suất':'1000–3000 cái/giờ','Trọng lượng bột':'50–140 g/cái','Chất liệu':MATERIAL,'Năm sản xuất':'2025'},'Máy se bột 6 lô, 2 băng tải, phù hợp công đoạn tạo hình bánh mì với trọng lượng bột 50–140 g mỗi cái.','Six-roller, double-belt dough moulder for bread portions weighing 50–140g.'),
('SC-UL0044-159','Tủ ủ bột 30 khay FOENIX','FOENIX 30-Tray Dough Proofer','foenix-proofer.webp','FOENIX ENGINEERING',{
'Model':'BM-TU-00-FN-32-304-220-01-25-KL','Kích thước':'900 × 1200 × 2040 mm','Điện áp':'220V 1 pha','Khối lượng':'180 kg','Công suất':'2 kW','Số khay':'30 khay','Kích thước khay':'46 × 72 cm','Chất liệu':MATERIAL,'Năm sản xuất':'2025'},'Tủ ủ bột 30 khay, sử dụng khay kích thước 46 × 72 cm cho công đoạn ủ bột trước khi nướng.','30-tray dough proofer for 46 × 72cm trays, used before baking.'),
('EQ-OVEN-008','Lò nướng bánh mì điện 8 khay FOENIX','FOENIX 8-Tray Electric Bread Oven','foenix-oven.webp','FOENIX ENGINEERING',{
'Model':'BM-LN-LE-FN-08-304-220-03-26-KL','Kích thước':'2000 × 1200 × 1530 mm','Điện áp':'220–380V 3 pha','Khối lượng':'750 kg','Công suất':'24 kW','Số khay':'8 khay','Kích thước khay':'46 × 72 cm','Năng suất':'80–120 bánh/lần','Thời gian nướng':'15–17 phút','Nhiệt độ':'35–300°C','Chất liệu':MATERIAL,'Năm sản xuất':'2026'},'Lò nướng bánh mì điện 8 khay, khay 46 × 72 cm. Theo tài liệu nhà cung cấp, năng suất 80–120 bánh mỗi lần với thời gian nướng 15–17 phút. Cần đối chiếu nguồn điện tại nơi lắp đặt trước khi đặt hàng.','Eight-tray electric bread oven for 46 × 72cm trays. Supplier specifications list 80–120 loaves per batch and 15–17 minutes baking time. Installation power requirements must be confirmed before ordering.'),
('SC-UL0044-162','Khay bánh mì nhôm 5 sóng 46 × 72 cm','5-Channel Aluminum Baguette Tray — 46 × 72cm','foenix-tray.webp','',{
'Kích thước':'46 × 72 cm','Độ dày':'0,8–1 mm','Số sóng':'5','Chất liệu':'Nhôm'},'Khay nhôm 5 sóng dùng cho bánh mì, kích thước 46 × 72 cm, độ dày 0,8–1 mm.','Five-channel aluminum bread tray, 46 × 72cm, with a thickness of 0.8–1mm.'),
('SC-UL0044-165','Tủ hấp 12 khay FOENIX','FOENIX 12-Tray Steaming Cabinet','foenix-steamer.webp','FOENIX ENGINEERING',{
'Model':'BB-TH-00-FN-12-304-220-01-26-KL','Sức chứa tối đa':'12 khay','Kích thước':'650 × 1050 × 1250 mm','Khối lượng máy':'90 kg','Khối lượng đóng gói':'100 kg','Điện áp':POWER,'Tần số':'50–60 Hz','Công suất ghi trong tài liệu':'9 kW/h (cần xác nhận đơn vị với nhà cung cấp)','Chất liệu':'Inox 304'},'Tủ hấp inox 304, sức chứa tối đa 12 khay, được đối chiếu từ tài liệu bộ thiết bị làm bánh và giò chả của nhà cung cấp.','Stainless steel 304 steaming cabinet with capacity for up to 12 trays, matched to the supplier equipment quotation.'),
]

EN_KEYS={'Model':'Model','Kích thước':'Dimensions','Điện áp':'Voltage','Khối lượng':'Weight','Điện năng tiêu thụ (theo tài liệu)':'Energy consumption (source quotation)','Năng suất':'Capacity','Chất liệu':'Material','Năm sản xuất':'Year of manufacture','Số lượng chia':'Divisions','Trọng lượng bột':'Dough weight','Công suất':'Power','Xuất xứ':'Origin','Tình trạng theo tài liệu':'Condition in source quotation','Số khay':'Tray capacity','Kích thước khay':'Tray size','Thời gian nướng':'Baking time','Nhiệt độ':'Temperature','Độ dày':'Thickness','Số sóng':'Channels','Sức chứa tối đa':'Maximum capacity','Khối lượng máy':'Machine weight','Khối lượng đóng gói':'Packed weight','Tần số':'Frequency','Công suất ghi trong tài liệu':'Power stated in source quotation'}
EN_VALUES={POWER:'220V single phase / 220–380V three phase',MATERIAL:'Stainless steel 304 and other materials','220V 1 pha':'220V single phase','220–380V 3 pha':'220–380V three phase','Đài Loan':'Taiwan','Hàng thanh lý đã qua sử dụng':'Used liquidation equipment','Nhôm':'Aluminum','Inox 304':'Stainless steel 304','9 kW/h (cần xác nhận đơn vị với nhà cung cấp)':'9 kW/h (confirm unit with supplier)'}


def main():
 with SessionLocal() as db:
  for code,vi,en,filename,brand,specs,desc_vi,desc_en in ROWS:
   s=db.scalar(select(ShowcaseItem).where(ShowcaseItem.code==code))
   if not s:raise RuntimeError(code)
   l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.showcase_id==s.id))
   if not l:raise RuntimeError(code)
   s.name=vi;s.brand=brand;s.description=desc_vi
   s.specifications=json.dumps(specs,ensure_ascii=False)
   s.highlights=json.dumps([],ensure_ascii=False)
   s.badges=json.dumps(['AVAILABLE ON REQUEST'])
   s.lead_time='Xác nhận theo số lượng và thời gian sản xuất / Confirm with quote'
   # English specs also live in the English description, which is site-specific.
   en_specs='\n'.join(f'{EN_KEYS.get(k,k)}: {EN_VALUES.get(v,v)}' for k,v in specs.items())
   for locale,title,desc in [('vi',vi,desc_vi),('en',en,desc_en+'\n\nTechnical specifications:\n'+en_specs)]:
    t=db.scalar(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==l.id,WebsiteListingTranslation.locale==locale))
    if not t:t=WebsiteListingTranslation(listing_id=l.id,locale=locale);db.add(t)
    t.title=title;t.description=desc;t.summary=desc_vi if locale=='vi' else desc_en;t.seo_title=title;t.seo_description=t.summary
   image_dir=Path(__file__).resolve().parents[1]/'assets'/'product-images'
   if not (image_dir/filename).is_file():raise FileNotFoundError(filename)
   url='/api/v1/public/product-images/'+filename
   current=list(db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id)))
   for m in current:m.is_primary=(m.image_url==url)
   if not any(m.image_url==url for m in current):db.add(WebsiteListingMedia(listing_id=l.id,image_url=url,alt_text=vi+' — ảnh từ tài liệu nhà cung cấp',sort_order=0,is_primary=True))
   print(code,vi)
  db.commit()

if __name__=='__main__':main()
