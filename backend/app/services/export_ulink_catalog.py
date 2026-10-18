#!/usr/bin/env python3
import argparse,json
from pathlib import Path
from app.db.session import SessionLocal
from app.services.ulink_catalog import build_catalog
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',default='/app/exports/ULINK-Catalog.pdf');p.add_argument('--group');p.add_argument('--section-only',action='store_true');g=p.add_mutually_exclusive_group();g.add_argument('--profile',type=int);g.add_argument('--settings-file');a=p.parse_args()
 with SessionLocal() as db:
  settings=None
  if a.profile:
   from app.api.v1.catalog_studio import CatalogProfile,validated
   profile=db.get(CatalogProfile,a.profile)
   if not profile:p.error('Không tìm thấy profile')
   settings=validated(json.loads(profile.settings))
  elif a.settings_file:
   from app.api.v1.catalog_studio import validated
   settings=validated(json.loads(Path(a.settings_file).read_text()))
  print(build_catalog(db,Path(a.output),group_id=a.group,section_only=a.section_only,settings=settings))
