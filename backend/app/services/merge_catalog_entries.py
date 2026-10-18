import json
from pathlib import Path
from collections import defaultdict
from sqlalchemy import select
from app.db.session import SessionLocal
from app.api.v1.catalog_admin import CatalogEntry
from app.api.v1.catalog_studio import CatalogProfile
with SessionLocal() as db:
 entries=db.scalars(select(CatalogEntry).order_by(CatalogEntry.id)).all();profiles=db.scalars(select(CatalogProfile)).all();by=defaultdict(list)
 for e in entries:by[(e.listing_id,e.unit_size.strip().casefold(),e.case_pack.strip().casefold())].append(e)
 merges=[];aliases={}
 for rows in by.values():
  keep=rows[0]
  for drop in rows[1:]:
   assert keep.unit_size==drop.unit_size and keep.case_pack==drop.case_pack
   aliases[drop.id]=keep.id;merges.append(dict(keep_id=keep.id,keep_reference=keep.reference,removed={c.name:getattr(drop,c.name) for c in drop.__table__.columns}))
 if merges:
  backup=Path('/app/exports/before-catalog-dedup-20261017.json');assert not backup.exists(),'Existing backup: inspect before reapplying'
  backup.write_text(json.dumps(dict(merges=merges,profiles=[dict(id=p.id,settings=p.settings) for p in profiles]),ensure_ascii=False,indent=2))
  for p in profiles:
   c=json.loads(p.settings)
   if c.get('entry_ids') is not None:c['entry_ids']=list(dict.fromkeys(aliases.get(i,i) for i in c['entry_ids']))
   for old,new in aliases.items():
    o=c.get('overrides',{}).get(str(old))
    if o:
     existing=c['overrides'].get(str(new));assert not existing or existing==o,'Conflicting override requires review'
     c['overrides'][str(new)]=o;del c['overrides'][str(old)]
   p.settings=json.dumps(c,ensure_ascii=False)
  for m in merges:db.delete(db.get(CatalogEntry,m['removed']['id']))
  db.commit()
 remaining=db.scalars(select(CatalogEntry)).all();assert len({(e.listing_id,e.unit_size,e.case_pack) for e in remaining})==len(remaining)
 print(json.dumps(dict(removed=len(merges),remaining=len(remaining),aliases=merges),ensure_ascii=False))
