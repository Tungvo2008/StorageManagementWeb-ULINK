"""Idempotent Ulink sourcing catalog import from user-supplied 2026-09-29 PDF.
No supplier prices, transaction quantities, tax or customer details are published.
"""
import json,argparse
from pathlib import Path
from sqlalchemy import select
from app.db.models import ShowcaseItem,WebsiteCategory,WebsiteListing,WebsiteListingTranslation,WebsiteListingMedia
from app.db.session import SessionLocal
# code, VI title, EN title, brand, carton packaging, image slugs, source lines
ROWS=[
('SC-KNP-OYSTER','Dầu hào Cholimex','Cholimex Oyster Sauce','Cholimex','24 chai × 350 g; 12 chai × 820 g',['dau-hao-chai-350g','dau-hao-chai-820g'],[1,2]),
('SC-KNP-FISH-BRAISE','Gia vị kho cá Cholimex','Cholimex Fish Braising Seasoning','Cholimex','120 gói × 50 g',['gia-vi-kho-ca-goi-50g'],[3]),
('SC-KNP-THAI-HOTPOT','Gia vị lẩu Thái Cholimex','Cholimex Thai Hot Pot Seasoning','Cholimex','24 chai × 280 g',['lau-thai-chai-pet-280g'],[4]),
('SC-KNP-VEG-SATE','Sa tế chay Cholimex','Cholimex Vegetarian Chili Oil','Cholimex','72 hũ × 90 g',['sa-te-chay-90g'],[5]),
('SC-KNP-SHRIMP-SATE','Sa tế tôm Cholimex','Cholimex Shrimp Chili Oil','Cholimex','72 hũ × 90 g',['sa-te-tom-90g'],[6]),
('SC-KNP-SWEET-CHILI','Tương ớt chua ngọt Cholimex','Cholimex Sweet Chili Sauce','Cholimex','12 chai × 830 g; 24 chai thủy tinh × 270 g',['tuong-ot-chua-ngot-chai-thuy-tinh','tuong-ot-chua-ngot-830g'],[7,8]),
('SC-KNP-PLUM-CHILI','Tương ớt xí muội Cholimex','Cholimex Plum Chili Sauce','Cholimex','24 chai thủy tinh × 270 g',['tuong-ot-xi-muoi'],[9]),
('SC-KNP-PHO-HOISIN','Tương đen phở Cholimex','Cholimex Hoisin Sauce for Pho','Cholimex','12 chai × 520 g; 36 chai × 230 g',['tuong-den-pho-230g','tuong-den-pho-520g'],[10,11]),
('SC-UL0045-191','Tương ớt Cholimex','Cholimex Chili Sauce','Cholimex','24 chai × 270 g; 12 chai × 830 g',[],[12,13]),
('SC-KNP-GRILL-MARINADE','Xốt ướp thịt nướng Cholimex','Cholimex Grilled Meat Marinade','Cholimex','36 hũ thủy tinh × 200 g',['xot-uop-thit-nuong-thuy-tinh-200g'],[14]),
('SC-KNP-CHAR-SIU','Xốt ướp xá xíu Cholimex','Cholimex Char Siu Marinade','Cholimex','36 hũ × 200 g',['xot-uop-xa-xiu-thuy-tinh-200g'],[15]),
('SC-KNP-DRIED-CHILI','Ớt khô sa tế Cholimex','Cholimex Dried Chili Sate','Cholimex','32 hũ thủy tinh × 100 g',['ot-kho-sa-te-100g'],[16]),
('SC-KNP-CHILI-SATE','Ớt sa tế Cholimex','Cholimex Chili Sate','Cholimex','36 hũ thủy tinh × 150 g',['ot-sa-te-150g'],[17]),
('SC-KNP-TAMARIND','Xốt rang me Cholimex','Cholimex Tamarind Sauce','Cholimex','24 chai × 280 g',['xot-rang-me-chai-pet-280g'],[18]),
('SC-KNP-BLACK-PEPPER','Xốt tiêu đen Cholimex','Cholimex Black Pepper Sauce','Cholimex','36 hũ × 190 g',['xot-tieu-den-cholimex'],[19]),
('SC-KNP-CHINSU-SEASONING','Hạt nêm CHIN-SU tôm thịt','CHIN-SU Shrimp and Meat Seasoning','CHIN-SU','8 gói × 900 g',['hat-nem-chinsu'],[20]),
('SC-UL0045-192','Tương ớt CHIN-SU','CHIN-SU Chili Sauce','CHIN-SU','12 chai × 1 kg',[],[21]),
('SC-UL0045-198','Nước mắm cá cơm nhĩ Hưng Thịnh 40N — 750 ml','Hưng Thịnh 40N Anchovy Fish Sauce — 750ml','Hưng Thịnh','12 chai × 750 ml',[],[22]),
('SC-UL0045-197','Nước mắm Thuận Phát 40N — 610 ml','Thuận Phát 40N Fish Sauce — 610ml','Thuận Phát','12 chai × 610 ml',[],[23]),
('SC-UL0045-195','Muối chấm Hảo Hảo','Hảo Hảo Dipping Salt','Hảo Hảo','24 hũ × 120 g',[],[24]),
]
def main(apply):
 with SessionLocal() as db:
  cat=db.scalar(select(WebsiteCategory).where(WebsiteCategory.site=='ulink',WebsiteCategory.slug=='condiments'));assert cat
  existing=list(db.scalars(select(ShowcaseItem)))
  # Fail instead of silently duplicating a product imported by another process.
  for code,vi,*_ in ROWS:
   duplicates=[s.code for s in existing if s.name.casefold()==vi.casefold() and s.code!=code]
   if duplicates:raise RuntimeError((code,duplicates))
  assert len({n for r in ROWS for n in r[-1]})==24
  created=0
  for code,vi,en,brand,pack,photos,lines in ROWS:
   s=db.scalar(select(ShowcaseItem).where(ShowcaseItem.code==code));is_new=s is None
   print('NEW' if is_new else 'UPDATE',code,vi,pack)
   if not apply:continue
   if is_new:
    s=ShowcaseItem(code=code,name=vi,category='Sauces & condiments',category_slug='condiments',description='',highlights='[]',specifications='{}',images='[]',brand=brand,min_order_quantity=1,lead_time=None,badges='[]',sort_order=1300+lines[0],is_active=True);db.add(s);db.flush();created+=1
   s.name=vi;s.brand=brand
   specs=json.loads(s.specifications or '{}');specs['Quy cách thùng']=pack;s.specifications=json.dumps(specs,ensure_ascii=False)
   l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.showcase_id==s.id))
   if not l:l=WebsiteListing(site='ulink',showcase_id=s.id,category_id=cat.id,is_published=True,sort_order=s.sort_order);db.add(l);db.flush()
   for locale,title in [('vi',vi),('en',en)]:
    summary=('Sản phẩm cung ứng theo yêu cầu. Liên hệ ULINK để xác nhận quy cách, số lượng và thời gian giao.' if locale=='vi' else 'Available for wholesale sourcing. Contact ULINK to confirm packaging, quantities and delivery timing.')
    ep=pack.replace('chai thủy tinh','glass bottles').replace('hũ thủy tinh','glass jars').replace('chai','bottles').replace('hũ','jars').replace('gói','packs')
    desc=title+'. '+summary+'\n\n'+(('Quy cách thùng: '+pack+'. Ảnh bao bì tham khảo; mẫu thực tế sẽ được xác nhận trong báo giá.') if locale=='vi' else ('Case packaging: '+ep+'. Packaging photos are representative; actual packaging will be confirmed in the quote.'))
    t=db.scalar(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==l.id,WebsiteListingTranslation.locale==locale))
    if not t:t=WebsiteListingTranslation(listing_id=l.id,locale=locale);db.add(t)
    t.title=title;t.summary=summary;t.description=desc;t.seo_title=title;t.seo_description=summary
    if locale=='vi':s.description=desc
   for i,slug in enumerate(photos):
    filename='knp-'+slug+'.webp';assert (Path(__file__).resolve().parents[1]/'assets/product-images'/filename).is_file(),filename
    url='/api/v1/public/product-images/'+filename
    m=db.scalar(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id,WebsiteListingMedia.image_url==url))
    if not m:db.add(WebsiteListingMedia(listing_id=l.id,image_url=url,alt_text=vi+' — ảnh bao bì tham khảo',sort_order=i,is_primary=i==0))
  if apply:db.commit()
  print('Created',created,'; source lines',24)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');main(p.parse_args().apply)
