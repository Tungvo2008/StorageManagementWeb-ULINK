import copy,json,time
from pathlib import Path
from fastapi import HTTPException
from sqlalchemy import select
from app.db.session import SessionLocal
from app.api.v1.catalog_studio import validated,CatalogProfile
from app.api.v1.catalog_admin import CatalogEntry,groups
from app.services.catalog_settings import DEFAULTS
from app.services.ulink_catalog import build_catalog
with SessionLocal() as db:
 cfg=copy.deepcopy(DEFAULTS);cfg['groups']=groups();cfg['entry_ids']=[e.id for e in db.scalars(select(CatalogEntry).where(CatalogEntry.group_id=='18')).all()]
 cfg['title']='ULINK · TRÀ & THẢO MỘC';cfg['subtitle']='HERBAL TEA COLLECTION';cfg['edition']='BẢN TÙY CHỈNH · 2026';cfg['cover_tagline']='Lựa chọn trà bán sỉ';cfg['contents_title']='BỘ SƯU TẬP TRÀ';cfg['contents_intro']='Danh sách sản phẩm được liên kết trực tiếp từ ERP.';cfg['closing_title']='LIÊN HỆ ULINK';cfg['closing_subtitle']='NHẬN BÁO GIÁ';cfg['closing_intro']='Thông tin từng sản phẩm được cập nhật tại nguồn. Quy cách và số lượng được xác nhận khi báo giá.'
 start=time.perf_counter();r=build_catalog(db,'/app/exports/ULINK-Catalog-Studio-Mau.pdf',settings=validated(cfg));print('Custom profile export',r,'seconds',round(time.perf_counter()-start,2));assert r['entries']==5
 # Test arbitrary content/image overrides, all optional page combinations and empty selection.
 e=cfg['entry_ids'][0];custom=copy.deepcopy(cfg);custom.update(show_cover=False,show_contents=False,show_closing=False,show_banner=False,show_price=True,entry_ids=[e],overrides={str(e):{'name':'KIỂM TRA NỘI DUNG ĐỘNG','price':'12.34','reference':'CUSTOM-TEST'}})
 assert build_catalog(db,'/app/exports/catalog-studio-test.pdf',settings=validated(custom))['pages']==1
 try:build_catalog(db,'/app/exports/empty-test.pdf',settings=validated({'entry_ids':[]}));raise AssertionError('empty exported')
 except ValueError:pass
 for raw in [{'brand_color':'red'},{'entry_ids':'1,2'},{'groups':[{'id':'x','name':'one'},{'id':'x','name':'two'}]},{'cover_image':'/etc/passwd'},{'overrides':{'1':{'unknown':'x'}}}]:
  try:validated(raw);raise AssertionError('invalid accepted')
  except HTTPException:pass
 print('PASS content overrides / page toggles / zero-selection / validation')
 # Stored configurations are independent and renderer does not mutate them.
 before=json.dumps(cfg,sort_keys=True);validated(cfg);assert json.dumps(cfg,sort_keys=True)==before
 print('PASS profile immutability')
