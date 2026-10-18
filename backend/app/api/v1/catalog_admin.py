"""Authenticated catalog editor. WebsiteListing remains the sole name/media source."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import Column,Integer,String,Text,Boolean,ForeignKey,select
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.db.models import WebsiteListing
from app.db.base import Base
from app.api.v1.storefront import _render_website_listing

router=APIRouter(prefix='/showcase/catalog',tags=['showcase-catalog'])
ASSETS=Path(__file__).resolve().parents[3]/'assets'/'catalog'
class CatalogEntry(Base):
 __tablename__='website_catalog_entries'
 id=Column(Integer,primary_key=True)
 listing_id=Column(Integer,ForeignKey('website_listings.id'),nullable=False,index=True)
 reference=Column(String(64),unique=True,nullable=False)
 group_id=Column(String(32),nullable=False)
 sort_order=Column(Integer,default=0,nullable=False)
 enabled=Column(Boolean,default=False,nullable=False)
 brand=Column(String(128),default='',nullable=False)
 unit_size=Column(String(300),default='',nullable=False)
 case_pack=Column(String(300),default='',nullable=False)
 minimum_order=Column(String(300),default='',nullable=False)
 print_description=Column(Text,default='',nullable=False)

def groups():return json.loads((ASSETS/'groups.json').read_text())
def entry_view(db,e):
 l=db.get(WebsiteListing,e.listing_id)
 p=_render_website_listing(db,l,'vi') if l and l.site=='ulink' else None
 return {**{k:getattr(e,k) for k in ('id','listing_id','reference','group_id','sort_order','enabled','brand','unit_size','case_pack','minimum_order','print_description')},'name':p.name if p else '(Không còn sản phẩm)','sku':p.sku if p else '', 'brand':e.brand or (p.brand if p else ''), 'image_url':p.image_url if p else None,'published':bool(l and l.is_published)}
@router.get('')
def read_catalog(db:Session=Depends(get_db)):
 entries=db.scalars(select(CatalogEntry).order_by(CatalogEntry.group_id,CatalogEntry.sort_order,CatalogEntry.id)).all()
 linked={e.listing_id for e in entries}
 available=[]
 for l in db.scalars(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.is_published==True)).all():
  if l.id not in linked:
   p=_render_website_listing(db,l,'vi')
   if p: available.append({'listing_id':l.id,'name':p.name,'sku':p.sku})
 return {'groups':groups(),'entries':[entry_view(db,e) for e in entries],'available':available}
class EntryPayload(BaseModel):
 group_id:str
 enabled:bool
 brand:str=Field(default='',max_length=128)
 unit_size:str=Field(default='',max_length=300)
 case_pack:str=Field(default='',max_length=300)
 minimum_order:str=Field(default='',max_length=300)
 print_description:str=Field(default='',max_length=600)
 sort_order:int=Field(default=0,ge=0,le=100000)
@router.put('/{entry_id}')
def update_catalog(entry_id:int,payload:EntryPayload,db:Session=Depends(get_db)):
 e=db.get(CatalogEntry,entry_id)
 if not e:raise HTTPException(404,'Không tìm thấy mục catalog')
 if payload.group_id not in {g['id'] for g in groups()}:raise HTTPException(422,'Nhóm không hợp lệ')
 for k,v in payload.model_dump().items():setattr(e,k,v.strip() if isinstance(v,str) else v)
 db.commit();return entry_view(db,e)
class AddPayload(BaseModel):
 listing_id:int
 group_id:str
@router.post('')
def add_catalog(payload:AddPayload,db:Session=Depends(get_db)):
 l=db.get(WebsiteListing,payload.listing_id)
 if not l or l.site!='ulink':raise HTTPException(404,'Không tìm thấy sản phẩm ULINK')
 if payload.group_id not in {g['id'] for g in groups()}:raise HTTPException(422,'Nhóm không hợp lệ')
 existing=db.scalar(select(CatalogEntry).where(CatalogEntry.listing_id==l.id))
 if existing:return entry_view(db,existing)
 e=CatalogEntry(listing_id=l.id,reference=f'WEB-{l.id}',group_id=payload.group_id,enabled=True)
 db.add(e);db.commit();return entry_view(db,e)
@router.get('/export.pdf')
def export_pdf(db:Session=Depends(get_db)):
 from app.services.ulink_catalog import build_catalog
 with TemporaryDirectory() as tmp:
  output=Path(tmp)/'ULINK-Catalog.pdf';build_catalog(db,output)
  return Response(output.read_bytes(),media_type='application/pdf',headers={'Content-Disposition':'attachment; filename="ULINK-Catalog.pdf"'})

from app.api.v1.catalog_studio import router as studio_router
router.include_router(studio_router)
