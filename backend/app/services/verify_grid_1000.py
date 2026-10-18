"""Pagination/load test with 1000 in-memory listings; no database writes."""
import json,time
from pathlib import Path
from app.db.session import SessionLocal
from app.db.models import WebsiteListing
from app.api.v1.catalog_admin import CatalogEntry
from app.api.v1.catalog_studio import CatalogProfile
from app.api.v1.storefront import _render_website_listing
from app.services import ulink_catalog as renderer
with SessionLocal() as real:
 profile=real.get(CatalogProfile,3);settings=json.loads(profile.settings);settings['entry_ids']=None;settings['title']='SYNTHETIC TEST';groups=settings['groups']
 source=real.query(CatalogEntry).all();samples=[_render_website_listing(real,real.get(WebsiteListing,e.listing_id),'vi') for e in source]
 entries=[];listings={};products={}
 for i in range(1000):
  lid=1000000+i;sample=samples[i%len(samples)].model_copy(deep=True);sample.id=lid;sample.sku='TEST-'+str(i);products[lid]=sample
  listings[lid]=WebsiteListing(id=lid,site='ulink',showcase_id=lid,is_published=True)
  entries.append(CatalogEntry(id=i+1,listing_id=lid,reference=f'TEST-{i+1:04}',group_id=groups[i%len(groups)]['id'],sort_order=i,enabled=True,brand=sample.brand or '',unit_size=sample.unit_size or '',case_pack='',minimum_order='',print_description=''))
class Result:
 def all(self):return entries
class FakeDB:
 def scalars(self,query):return Result()
 def get(self,cls,id):return listings[id]
original=renderer._render_website_listing;renderer._render_website_listing=lambda db,l,locale:products[l.id].model_copy(deep=True)
try:
 start=time.monotonic();stats=renderer.build_catalog(FakeDB(),'/app/exports/grid-stress-synthetic.pdf',settings=settings);stats['seconds']=round(time.monotonic()-start,2);assert stats['entries']==1000;stats['fixture']='1000 in-memory listings, no production data writes';print(json.dumps(stats));Path('/app/exports/grid-stress-result.json').write_text(json.dumps(stats))
finally:renderer._render_website_listing=original
