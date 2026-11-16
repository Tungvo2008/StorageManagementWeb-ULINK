"""Reversible website/catalog enrichment, with strict identity and snapshot guards. Inventory and original assets are never changed."""
import json,sqlite3,argparse
from pathlib import Path
from sqlalchemy import select
from app.db.session import SessionLocal,engine
from app.db.models import WebsiteListing,WebsiteListingTranslation,WebsiteListingMedia,WebsiteCategory,ShowcaseItem
from app.api.v1.catalog_admin import CatalogEntry
from app.api.v1.catalog_studio import CatalogProfile
ROOT=Path('/app/exports/pdp-enrichment-20261115');BR=Path('/app/exports/brand-catalog-20261115');IMG=Path('/app/assets/product-images')
FIELDS=['title','summary','description','seo_title','seo_description']
def main(apply):
 before=json.load(open(BR/'before-all.json'));baseline=json.load(open(ROOT/'content-manifest.json'));brands=json.load(open(BR/'import-manifest.json'))['rows'];optimized=json.load(open(ROOT/'optimized-media.json'))
 if apply:
  backup=ROOT/'before-apply.db'
  if backup.exists():raise RuntimeError('Backup exists; review the prior result before rerunning an apply')
  with engine.connect() as c:
   dst=sqlite3.connect(str(backup));c.connection.driver_connection.backup(dst);dst.close()
 stats={'baseline_listings':0,'brand_listings':0,'new_listings':0,'new_catalog_entries':0,'newly_published':[],'excluded':[],'drafts':[],'media_optimized':0,'media_attached':0};ready=[];excluded_ids=[]
 with SessionLocal() as db:
  # Stop instead of overwriting intervening editor changes.
  for old in before:
   l=db.get(WebsiteListing,old['listing_id']);assert l and l.site=='ulink' and l.product_id==old['product_id'] and l.showcase_id==old['showcase_id'],old['sku']
   now={t.locale:{k:getattr(t,k) for k in FIELDS} for t in db.scalars(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==l.id))}
   expected={t['locale']:{k:t[k] for k in FIELDS} for t in old['translations']};assert now==expected,('Translation edited after snapshot',old['sku'])
  def translations(l,data):
   for lang,values in data.items():
    t=db.scalar(select(WebsiteListingTranslation).where(WebsiteListingTranslation.listing_id==l.id,WebsiteListingTranslation.locale==lang))
    if not t:t=WebsiteListingTranslation(listing_id=l.id,locale=lang);db.add(t)
    for k,v in values.items():assert k in FIELDS;setattr(t,k,v)
  for row in baseline:
   l=db.get(WebsiteListing,row['listing_id']);translations(l,row['translations']);stats['baseline_listings']+=1
  for r in optimized:
   m=db.get(WebsiteListingMedia,r['media_id']);assert m and Path(m.image_url).name==r['filename'],('Media edited',r['media_id'])
   assert (IMG/r['new_filename']).is_file();m.image_url='/api/v1/public/product-images/'+r['new_filename'];stats['media_optimized']+=1
  cat=db.scalar(select(WebsiteCategory).where(WebsiteCategory.site=='ulink',WebsiteCategory.slug=='condiments'));assert cat
  for i,row in enumerate(brands):
   lid=row['existing_listing_id'];l=db.get(WebsiteListing,lid) if lid else None
   if l:
    assert l.site=='ulink' and l.showcase_id,row['code'];s=db.get(ShowcaseItem,l.showcase_id);assert s.code==row['code'],(s.code,row['code'])
   else:
    s=db.scalar(select(ShowcaseItem).where(ShowcaseItem.code==row['code']))
    if s:l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.showcase_id==s.id))
   if row['status']=='excluded':
    if l:
     l.is_published=False
     ce=db.scalar(select(CatalogEntry).where(CatalogEntry.listing_id==l.id))
     if ce:ce.enabled=False;excluded_ids.append(ce.id)
    stats['excluded'].append(row['translations']['vi']['title']);continue
   if not s:
    s=ShowcaseItem(code=row['code'],name=row['translations']['vi']['title'],brand=row['brand'],category='Gia vị & nước chấm',category_slug='condiments',description=row['translations']['vi']['summary'],highlights='[]',specifications='{}',images='[]',badges='[]',sort_order=5000+i,is_active=True,min_order_quantity=1,lead_time='Xác nhận khi báo giá / Confirm with quote');db.add(s);db.flush()
   if not l:
    l=WebsiteListing(site='ulink',showcase_id=s.id,category_id=cat.id,is_published=False,sort_order=5000+i);db.add(l);db.flush();stats['new_listings']+=1
   translations(l,row['translations']);stats['brand_listings']+=1
   media=list(db.scalars(select(WebsiteListingMedia).where(WebsiteListingMedia.listing_id==l.id)));known={Path(m.image_url).name for m in media}
   # Existing owner-reviewed primary remains primary; add exact manufacturer pack photos only.
   for asset in row.get('assets',[]):
    f=IMG/asset['filename'];assert f.is_file(),str(f)
    if f.name in known:continue
    url='/api/v1/public/product-images/'+f.name
    db.add(WebsiteListingMedia(listing_id=l.id,image_url=url,alt_text=(asset.get('pack_name') or row['translations']['vi']['title'])[:255],sort_order=len(media)+stats['media_attached'],is_primary=not media and not known))
    known.add(f.name);stats['media_attached']+=1
    if not s.image_url:s.image_url=url
   has_image=bool(media or known)
   eligible=row['status']=='eligible' and has_image
   if eligible and not l.is_published:l.is_published=True;stats['newly_published'].append({'sku':s.code,'listing_id':l.id,'name':row['translations']['vi']['title']})
   elif not l.is_published:stats['drafts'].append({'sku':s.code,'name':row['translations']['vi']['title'],'reason':row['reason'] if not eligible else 'Chưa có ảnh đúng.'})
   ce=db.scalar(select(CatalogEntry).where(CatalogEntry.listing_id==l.id))
   if not ce:
    ce=CatalogEntry(listing_id=l.id,reference='BR-'+row['brand'].replace('CHIN-SU','CS').replace('Cholimex','CL')+'-'+str(l.id),group_id=row['catalog_group'],sort_order=5000+i,enabled=eligible,brand=row['brand'],unit_size='',case_pack='',minimum_order='',print_description='');db.add(ce);db.flush();stats['new_catalog_entries']+=1
   if eligible:ce.enabled=True;ready.append(ce.id)
   row['result_listing_id']=l.id;row['result_sku']=s.code
  for pid in [1,3]:
   profile=db.get(CatalogProfile,pid)
   if not profile:continue
   settings=json.loads(profile.settings)
   if settings.get('entry_ids') is not None:settings['entry_ids']=list(dict.fromkeys(e for e in settings['entry_ids']+ready if e not in excluded_ids))
   profile.settings=json.dumps(settings,ensure_ascii=False)
  db.flush()
  if apply:db.commit()
  else:db.rollback()
 stats['apply']=apply
 (BR/('apply-result.json' if apply else 'dry-run-result.json')).write_text(json.dumps(stats,ensure_ascii=False,indent=2))
 if apply:(BR/'resolved-manifest.json').write_text(json.dumps({'rows':brands},ensure_ascii=False,indent=2))
 print(json.dumps({k:v if not isinstance(v,list) else len(v) for k,v in stats.items()},ensure_ascii=False))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');main(p.parse_args().apply)
