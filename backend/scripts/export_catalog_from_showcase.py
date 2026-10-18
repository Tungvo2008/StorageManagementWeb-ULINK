"""Export the print catalog from the exact same renderer used by ULINK web.
Run inside ERP backend with PYTHONPATH=/app. Content lives in website listings,
translations and media; the map stores only layout groups and stable references.
"""
import argparse,json
from pathlib import Path
from app.db.session import SessionLocal
from app.db.models import WebsiteListing
from app.api.v1.storefront import _render_website_listing

def main(mapping,out):
 m=json.loads(Path(mapping).read_text());rows=[];images={}
 with SessionLocal() as db:
  for ref in m['rows']:
   listing=db.get(WebsiteListing,ref['listing_id']);assert listing and listing.site=='ulink' and listing.is_published,ref
   item=_render_website_listing(db,listing,'vi').model_dump(mode='json');english=_render_website_listing(db,listing,'en').model_dump(mode='json')
   assert item['sku']==ref['sku'],(ref,item['sku'])
   rows.append({'code':ref['catalog_code'],'group_id':ref['group_id'],'listing_id':listing.id,'sku':item['sku'],'name':item['name'],'name_en':english['name'],'brand':item.get('brand'),'image_url':item.get('image_url'),'images':item.get('images'),'description':item.get('description'),'short_description':item.get('short_description'),'specifications':item.get('specifications'),'unit_size':item.get('unit_size'),'case_pack':item.get('case_pack'),'owner_image_pending':ref.get('owner_image_pending',False),'canonical_product':item})
 payload={'source':'ULINK website listings / ERP storefront renderer','groups':m['groups'],'products':rows}
 Path(out).write_text(json.dumps(payload,ensure_ascii=False,indent=2))
 missing=[r for r in rows if not r['image_url']];print(json.dumps({'refs':len(rows),'unique_products':len({r['sku'] for r in rows}),'missing_images':[(r['code'],r['name']) for r in missing]},ensure_ascii=False))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--map',default='/app/assets/catalog/ulink-catalog-map.json');p.add_argument('--out',required=True);a=p.parse_args();main(a.map,a.out)
