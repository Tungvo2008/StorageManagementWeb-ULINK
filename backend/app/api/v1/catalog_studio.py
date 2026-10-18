import copy,json,re
from pathlib import Path
from tempfile import TemporaryDirectory
from datetime import datetime,timezone
from fastapi import APIRouter,Depends,HTTPException,UploadFile,File
from fastapi.responses import Response
from pydantic import BaseModel,Field
from sqlalchemy import Column,Integer,String,Text,select
from sqlalchemy.orm import Session
from app.db.base import Base
from app.api.deps import get_db
from app.services.catalog_settings import DEFAULTS
router=APIRouter(prefix='/studio')
class CatalogProfile(Base):
 __tablename__='website_catalog_profiles'
 id=Column(Integer,primary_key=True)
 name=Column(String(150),nullable=False)
 settings=Column(Text,nullable=False)
 updated_at=Column(String(64),nullable=False)
class ProfilePayload(BaseModel):
 name:str=Field(min_length=1,max_length=150)

 def model_post_init(self,__context):
  self.name=self.name.strip()
  if not self.name:raise ValueError('Tên cấu hình không được trống')
 settings:dict

def validated(raw):
 if len(json.dumps(raw,ensure_ascii=False))>1500000:raise HTTPException(422,'Cấu hình quá lớn')
 c=copy.deepcopy(DEFAULTS)
 for k,v in raw.items():
  if k not in DEFAULTS:raise HTTPException(422,'Trường cấu hình không hợp lệ: '+k)
  if k in ['customer_id','entry_ids','groups','overrides','labels','steps']:c[k]=v;continue
  expected=type(DEFAULTS[k])
  if not isinstance(v,expected):raise HTTPException(422,'Sai kiểu dữ liệu: '+k)
  if isinstance(v,str) and len(v)>1500:raise HTTPException(422,'Nội dung quá dài: '+k)
  c[k]=v
 for k in ['brand_color','paper_color','pale_color','text_color']:
  if not re.fullmatch(r'#[0-9a-fA-F]{6}',c[k]):raise HTTPException(422,'Màu cần dạng #RRGGBB')
 if c['product_layout'] not in ['editorial','grid'] or c['grid_density'] not in ['comfortable','compact']:raise HTTPException(422,'Mẫu sản phẩm / mật độ lưới không hợp lệ')
 if c['locale'] not in ['vi','en'] or c['image_fit'] not in ['contain','cover'] or c['availability'] not in ['all','in_stock','out_of_stock'] or c['sort_mode'] not in ['catalog','selection','name','brand']:raise HTTPException(422,'Tùy chọn không hợp lệ')
 if c['entry_ids'] is not None and (not isinstance(c['entry_ids'],list) or len(c['entry_ids'])>2000 or any(type(x)!=int or x<1 for x in c['entry_ids'])):raise HTTPException(422,'Danh sách sản phẩm không hợp lệ')
 if c['customer_id'] is not None and (type(c['customer_id'])!=int or c['customer_id']<1):raise HTTPException(422,'Khách hàng không hợp lệ')
 if not isinstance(c['groups'],list) or len(c['groups'])>100:raise HTTPException(422,'Tối đa 100 nhóm')
 ids=set()
 for g in c['groups']:
  if not isinstance(g,dict) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,32}',str(g.get('id',''))) or g['id'] in ids or not str(g.get('name','')).strip():raise HTTPException(422,'Mã / tên nhóm không hợp lệ hoặc trùng')
  ids.add(g['id'])
  for k,v in g.items():
   if k not in ['id','name','name_en','intro','banner_images','hero_image'] or (k!='banner_images' and (not isinstance(v,str) or len(v)>1500)):raise HTTPException(422,'Thông tin nhóm không hợp lệ')
  if 'banner_images' in g and (not isinstance(g['banner_images'],list) or len(g['banner_images'])>3):raise HTTPException(422,'Tối đa 3 ảnh đầu nhóm')
 if not isinstance(c['overrides'],dict) or len(c['overrides'])>2000:raise HTTPException(422,'Nội dung sản phẩm không hợp lệ')
 for key,o in c['overrides'].items():
  if not str(key).isdigit() or not isinstance(o,dict):raise HTTPException(422,'Nội dung sản phẩm không hợp lệ')
  for k,v in o.items():
   if k not in ['name','brand','image_url','unit_size','case_pack','minimum_order','print_description','reference','group_id','price','country_of_origin','upc','badges'] or not isinstance(v,str) or len(v)>1000:raise HTTPException(422,'Trường sản phẩm không hợp lệ')
 if not isinstance(c['labels'],dict) or any(k not in DEFAULTS['labels'] or not isinstance(v,str) or len(v)>150 for k,v in c['labels'].items()):raise HTTPException(422,'Nhãn không hợp lệ')
 c['labels']={**DEFAULTS['labels'],**c['labels']}
 if not isinstance(c['steps'],list) or len(c['steps'])>3 or any(not isinstance(s,dict) or set(s)!={'title','body'} or any(not isinstance(v,str) or len(v)>400 for v in s.values()) for s in c['steps']):raise HTTPException(422,'Tối đa 3 bước, gồm tiêu đề và nội dung')
 # Local managed images only. Reject arbitrary paths/remote fetches early.
 from app.services.catalog_settings import DEFAULTS as _
 images=[c['logo_image'],c['cover_image']]+[g.get('hero_image','') for g in c['groups']]+[v for g in c['groups'] for v in g.get('banner_images',[])]+[o['image_url'] for o in c['overrides'].values() if o.get('image_url')]
 for url in images:
  if not isinstance(url,str) or len(url)>2048 or (url and '/product-images/' not in url):raise HTTPException(422,'Ảnh phải được tải vào thư viện ERP')
 return c

def view(p):return {'id':p.id,'name':p.name,'settings':json.loads(p.settings),'updated_at':p.updated_at}
@router.get('')
def load(db:Session=Depends(get_db)):
 from app.api.v1.catalog_admin import groups
 defaults=copy.deepcopy(DEFAULTS);defaults['groups']=groups()
 return {'defaults':defaults,'profiles':[view(p) for p in db.scalars(select(CatalogProfile).order_by(CatalogProfile.id)).all()]}
@router.post('/profiles')
def create(payload:ProfilePayload,db:Session=Depends(get_db)):
 p=CatalogProfile(name=payload.name.strip(),settings=json.dumps(validated(payload.settings),ensure_ascii=False),updated_at=datetime.now(timezone.utc).isoformat());db.add(p);db.commit();return view(p)
@router.put('/profiles/{profile_id}')
def save(profile_id:int,payload:ProfilePayload,db:Session=Depends(get_db)):
 p=db.get(CatalogProfile,profile_id)
 if not p:raise HTTPException(404,'Không tìm thấy cấu hình')
 p.name=payload.name.strip();p.settings=json.dumps(validated(payload.settings),ensure_ascii=False);p.updated_at=datetime.now(timezone.utc).isoformat();db.commit();return view(p)
class ExportPayload(BaseModel):
 settings:dict
@router.post('/pdf')
def pdf(payload:ExportPayload,db:Session=Depends(get_db)):
 from app.services.ulink_catalog import build_catalog
 c=validated(payload.settings)
 with TemporaryDirectory() as tmp:
  output=Path(tmp)/'catalog.pdf'
  try:build_catalog(db,output,settings=c)
  except ValueError as e:raise HTTPException(422,str(e))
  return Response(output.read_bytes(),media_type='application/pdf',headers={'Content-Disposition':'inline; filename="ULINK-Catalog.pdf"'})

@router.get('/sources')
def sources(db:Session=Depends(get_db)):
 from app.db.models import Product,ShowcaseItem
 return [{'kind':'product','id':p.id,'name':p.name,'code':p.sku} for p in db.scalars(select(Product).where(Product.is_active==True)).all()]+[{'kind':'showcase','id':p.id,'name':p.name,'code':p.code} for p in db.scalars(select(ShowcaseItem).where(ShowcaseItem.is_active==True)).all()]
class LinkPayload(BaseModel):
 kind:str
 source_id:int
 group_id:str
@router.post('/link')
def link_source(payload:LinkPayload,db:Session=Depends(get_db)):
 from app.db.models import Product,ShowcaseItem,WebsiteListing,WebsiteListingMedia
 from app.api.v1.catalog_admin import CatalogEntry,entry_view,groups
 if payload.kind not in ['product','showcase']:raise HTTPException(422,'Nguồn không hợp lệ')
 if payload.group_id not in {g['id'] for g in groups()}:raise HTTPException(422,'Nhóm gốc không hợp lệ')
 model=Product if payload.kind=='product' else ShowcaseItem
 source=db.get(model,payload.source_id)
 if not source or not source.is_active:raise HTTPException(404,'Không có sản phẩm đang hoạt động')
 col=WebsiteListing.product_id if payload.kind=='product' else WebsiteListing.showcase_id
 listing=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',col==source.id))
 if not listing:
  listing=WebsiteListing(site='ulink',product_id=source.id if payload.kind=='product' else None,showcase_id=source.id if payload.kind=='showcase' else None,is_published=False,sort_order=0)
  db.add(listing);db.flush()
  if source.image_url:db.add(WebsiteListingMedia(listing_id=listing.id,image_url=source.image_url,alt_text=source.name,is_primary=True,sort_order=0))
 e=db.scalar(select(CatalogEntry).where(CatalogEntry.listing_id==listing.id))
 if not e:
  e=CatalogEntry(listing_id=listing.id,reference=f'WEB-{listing.id}',group_id=payload.group_id,enabled=True);db.add(e)
 db.commit();return entry_view(db,e)

@router.post('/images')
async def upload_catalog_image(file: UploadFile = File(...)):
 """Keep transparency for logos/cutouts; never overwrite a source asset."""
 from io import BytesIO
 from uuid import uuid4
 from PIL import Image,ImageOps,UnidentifiedImageError
 data=await file.read(8*1024*1024+1)
 if not data or len(data)>8*1024*1024:raise HTTPException(400,'Ảnh tối đa 8 MB')
 try:
  with Image.open(BytesIO(data)) as source:
   if source.width*source.height>40000000:raise HTTPException(400,'Kích thước ảnh quá lớn')
   image=ImageOps.exif_transpose(source);image.thumbnail((2400,2400))
   alpha=image.mode=='RGBA' or (image.mode=='P' and 'transparency' in image.info)
   folder=Path(__file__).resolve().parents[3]/'assets'/'product-images';folder.mkdir(parents=True,exist_ok=True)
   filename='catalog-studio-'+uuid4().hex+('.png' if alpha else '.jpg')
   if alpha:image.convert('RGBA').save(folder/filename,'PNG')
   else:image.convert('RGB').save(folder/filename,'JPEG',quality=92,optimize=True)
 except (UnidentifiedImageError,OSError,ValueError):raise HTTPException(400,'File ảnh không hợp lệ')
 return {'url':'/api/v1/public/product-images/'+filename}
