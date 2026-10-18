"""Import reviewed catalog rows into ULINK website listings; --apply commits.
Keeps stock records unchanged. Existing web images and approved labels win.
Inputs: reviewed catalog manifest + locally installed product-images assets.
"""
import json,argparse
from pathlib import Path
from collections import defaultdict
from sqlalchemy import select
from app.db.models import Product,ShowcaseItem,WebsiteCategory,WebsiteListing,WebsiteListingTranslation,WebsiteListingMedia
from app.db.session import SessionLocal

def main(manifest,apply):
 data=json.loads(Path(manifest).read_text());by_target=defaultdict(list)
 for row in data['rows']:by_target[row['target_code']].append(row)
 counts={'new_showcase':0,'new_listings':0,'new_media':0,'existing':0,'blank_images':0}
 with SessionLocal() as db:
  cats={c.slug:c for c in db.scalars(select(WebsiteCategory).where(WebsiteCategory.site=='ulink'))}
  for slug,vi,en in [('plant-based','Thực phẩm chay','Plant-based foods'),('calendars-gifts','Lịch & quà tặng','Calendars & gifts')]:
   if slug not in cats:
    cat=WebsiteCategory(site='ulink',slug=slug,name_vi=vi,name_en=en,sort_order=max(c.sort_order for c in cats.values())+1,is_active=True);db.add(cat);db.flush();cats[slug]=cat
  for order,(code,refs) in enumerate(by_target.items()):
   row=refs[0];p=db.scalar(select(Product).where(Product.sku==code));s=None
   if p:
    l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.product_id==p.id));assert l,code
    counts['existing']+=1
   else:
    s=db.scalar(select(ShowcaseItem).where(ShowcaseItem.code==code));new=s is None
    if new:
     s=ShowcaseItem(code=code,name=row['name'],category=cats[row['category_slug']].name_en,category_slug=row['category_slug'],description='',highlights='[]',specifications='{}',images='[]',brand=row['brand'],min_order_quantity=1,lead_time='Xác nhận khi báo giá / Confirm with quote',badges='[]',sort_order=2000+order,is_active=True);db.add(s);db.flush();counts['new_showcase']+=1
    else:counts['existing']+=1
    l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.showcase_id==s.id))
    if not l:l=WebsiteListing(site='ulink',showcase_id=s.id,category_id=cats[row['category_slug']].id,is_published=True,sort_order=s.sort_order);db.add(l);db.flush();counts['new_listings']+=1
    if new:
     if row['group_id']=='19':s.specifications=json.dumps({'Loại lịch':row['name'],'Năm lịch, thiết kế, kích thước':'Xác nhận theo yêu cầu khi báo giá'},ensure_ascii=False)
     if code=='SC-CAT-NP-149':s.specifications=json.dumps({'Model':'D.04','Mũi kềm':'14 hoặc 16 — xác nhận khi báo giá'},ensure_ascii=False)
     for lang,title in [('vi',row['name']),('en',row['en'])]:
      summary=('Sản phẩm cung ứng theo yêu cầu. Liên hệ ULINK để xác nhận quy cách, số lượng và thời gian giao.' if lang=='vi' else 'Available for wholesale sourcing. Contact ULINK to confirm packaging, quantities and delivery timing.')
      desc=title+'. '+summary
      if row.get('illustrative'):
       desc+=(' Ảnh minh họa loại sản phẩm; không đại diện cho bao bì hoặc thiết kế cố định. Mẫu thực tế sẽ được xác nhận trong báo giá.' if lang=='vi' else 'Illustrative product-type photo; packaging or design is not fixed. Actual samples will be confirmed in the quote.')
      else:desc+=(' Ảnh bao bì tham khảo; quy cách thực tế được xác nhận trong báo giá.' if lang=='vi' else 'Packaging image for reference; actual pack specifications will be confirmed in the quote.')
      t=WebsiteListingTranslation(listing_id=l.id,locale=lang,title=title,summary=summary,description=desc,seo_title=title,seo_description=summary);db.add(t)
      if lang=='vi':s.description=desc
   media=list(db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id)))
   # Preserve current images, especially exact owner-approved ULINK snack art.
   source_has_image=bool(media) or bool(p and p.image_url) or bool(s and s.image_url)
   if not source_has_image:
    files=list(dict.fromkeys(r.get('upload_filename') for r in refs if r.get('upload_filename')))
    # Shrimp salt reference 070 is a chili variant; don't silently change the offered flavor.
    if code=='SC-CAT-NP-069':files=[f for f in files if 'np-070' not in f]
    for i,filename in enumerate(files):
     assert (Path('/app/assets/product-images')/filename).is_file(),filename
     db.add(WebsiteListingMedia(listing_id=l.id,image_url='/api/v1/public/product-images/'+filename,alt_text=row['name']+(' — ảnh minh họa loại sản phẩm' if row.get('illustrative') else ' — ảnh sản phẩm tham khảo'),sort_order=i,is_primary=i==0));counts['new_media']+=1
    if not files:counts['blank_images']+=1
   for r in refs:r['listing_id']=l.id;r['public_code']=code
  if apply:
   db.commit();Path('/app/assets/catalog/ulink-catalog-map.json').write_text(json.dumps({'version':1,'groups':data['groups'],'rows':[{'catalog_code':r['code'],'listing_id':r['listing_id'],'sku':r['target_code'],'group_id':r['group_id'],'owner_image_pending':r.get('owner_image_pending',False)} for r in data['rows']]},ensure_ascii=False,indent=2))
  else:db.rollback()
  print(json.dumps({'apply':apply,**counts,'catalog_refs':len(data['rows']),'unique_products':len(by_target)},ensure_ascii=False))
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('manifest');a.add_argument('--apply',action='store_true');x=a.parse_args();main(x.manifest,x.apply)
