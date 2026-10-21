"""Gourmet editorial template: geometry fixed; all content supplied by linked records/settings."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
import copy,html,io,math,json
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph,KeepInFrame
from reportlab.lib.styles import ParagraphStyle
from sqlalchemy import select
from app.db.models import WebsiteListing,Product
from app.api.v1.storefront import _render_website_listing
from app.services.catalog_settings import DEFAULTS
A=Path(__file__).resolve().parents[2]/'assets'/'catalog'
def managed_image(url):
 if not url:return None
 path=unquote(urlsplit(url).path)
 if '/product-images/' not in path:return None
 p=A.parent/'product-images'/Path(path).name
 return str(p) if p.is_file() else None

def build_catalog(db,output,group_id=None,section_only=False,settings=None):
 from app.api.v1.catalog_admin import CatalogEntry,groups as get_groups
 cfg=copy.deepcopy(DEFAULTS)
 if settings:cfg.update(settings)
 cfg['labels']={**DEFAULTS['labels'],**cfg.get('labels',{})};L=cfg['labels']
 if section_only:cfg.update(show_cover=False,show_contents=False,show_closing=False)
 is_grid=cfg.get('product_layout','editorial')=='grid'
 grid_rows=4 if cfg.get('grid_density')=='compact' else 3
 groups=cfg.get('groups') or get_groups();group_by={g['id']:g for g in groups}
 selected=cfg['entry_ids'];selected_set=set(selected) if selected is not None else None
 if selected==[]:raise ValueError('Chưa chọn sản phẩm để xuất')
 prices={}
 if cfg['customer_id']:
  from app.db.models import CustomerProductPrice
  prices={p.product_id:p.price for p in db.scalars(select(CustomerProductPrice).where(CustomerProductPrice.customer_id==cfg['customer_id'])).all() if p.price is not None}
 products=[];seen_products=set()
 for e in db.scalars(select(CatalogEntry).order_by(CatalogEntry.group_id,CatalogEntry.sort_order,CatalogEntry.id)).all():
  if selected_set is not None:
   if e.id not in selected_set:continue
  elif not e.enabled:continue
  l=db.get(WebsiteListing,e.listing_id)
  if not l or l.site!='ulink' or (not l.is_published and not cfg['include_unpublished']):continue
  item=_render_website_listing(db,l,cfg['locale'])
  if not item:continue
  p=item.model_dump(mode='json');stock=db.get(Product,l.product_id) if l.product_id else None
  p.update(entry_id=e.id,code=e.reference,group_id=e.group_id,brand=e.brand or p.get('brand') or '',unit_size=e.unit_size or p.get('unit_size') or '',case_pack=e.case_pack or str(p.get('case_pack') or ''),minimum_order=e.minimum_order,print_description=e.print_description)
  p['price']=prices.get(l.product_id,stock.unit_price if stock else p.get('unit_price'))
  for k,v in cfg['overrides'].get(str(e.id),{}).items():p['code' if k=='reference' else k]=v
  if group_id and p['group_id']!=group_id:continue
  if p['group_id'] not in group_by:raise ValueError('Nhóm của sản phẩm chưa có trong cấu hình: '+p['name'])
  if cfg['brand_filter'] and p['brand'].casefold()!=cfg['brand_filter'].casefold():continue
  if cfg['availability']=='in_stock' and not p['is_in_stock']:continue
  if cfg['availability']=='out_of_stock' and p['is_in_stock']:continue
  # One row per canonical listing and pack specification, even after imports.
  identity=(l.id,str(p.get('unit_size') or '').strip().casefold(),str(p.get('case_pack') or '').strip().casefold())
  if identity in seen_products:continue
  seen_products.add(identity)
  p['image']=managed_image(p.get('image_url'));products.append(p)
 if not products:raise ValueError('Không có sản phẩm phù hợp với lựa chọn / bộ lọc')
 if cfg['sort_mode']=='selection' and selected is not None:products.sort(key=lambda p:selected.index(p['entry_id']))
 elif cfg['sort_mode'] in ['name','brand']:products.sort(key=lambda p:str(p.get(cfg['sort_mode']) or '').casefold())
 groups=[g for g in groups if any(p['group_id']==g['id'] for p in products)]
 # Contents pagination and all page numbers are computed from the selected data.
 toc_chunks=[groups[i:i+19] for i in range(0,len(groups),19)] if cfg['show_contents'] else []
 page_no=1+int(cfg['show_cover'])+len(toc_chunks);batches=[];starts={}
 for g in groups:
  rows=[p for p in products if p['group_id']==g['id']];starts[g['id']]=page_no
  capacity=3*grid_rows if is_grid else 4
  first=(6 if is_grid else 3) if cfg['show_banner'] else capacity
  chunks=[rows[:first]]+[rows[i:i+capacity] for i in range(first,len(rows),capacity)]
  for i,chunk in enumerate(chunks):batches.append((g,chunk,i+1,len(chunks)));page_no+=1
 total=page_no-1+int(cfg['show_closing'])
 for n in ['Regular','Bold','Medium']:
  if n not in pdfmetrics.getRegisteredFontNames():pdfmetrics.registerFont(TTFont(n,str(A/('BeVietnamPro-'+n+'.ttf'))))
 O=Path(output);O.parent.mkdir(parents=True,exist_ok=True)
 W,H=595.28,841.89;INK=cfg['text_color'];GREEN=cfg['brand_color'];PALE=cfg['pale_color'];CREAM=cfg['paper_color'];MUTED='#777C70'
 c=canvas.Canvas(str(O),pagesize=(W,H),pageCompression=1);c.setTitle(cfg['title']);c.setAuthor(cfg['company'])
 product_image_paths={p['image'] for p in products if p.get('image')}
 cache={};logo=(managed_image(cfg['logo_image']) if cfg['logo_image'] else str(A/'logo.png')) if cfg['show_logo'] else None
 def text(x,y,value,size=10,font='Regular',color=None,width=None):
  value=str(value or '');color=color or INK
  if width:
   measured=pdfmetrics.stringWidth(value,font,size)
   if measured>width:size=max(6,size*width/measured)
   if pdfmetrics.stringWidth(value,font,size)>width:
    # Keep long configurable labels in their own box, never overprint a neighbour.
    return para(x,y+size,width,value,size,font,color,height=size*2.5,leading=size*1.15)
  c.setFillColor(HexColor(color));c.setFont(font,size);c.drawString(x,y,value)
 def para(x,top,width,value,size=9,font='Regular',color=None,height=100,leading=None,align=0):
  value=html.escape(str(value or '')).replace('\n','<br/>')
  if not value:return 0
  initial=size
  while True:
   style=ParagraphStyle('body',fontName=font,fontSize=size,leading=(leading or initial*1.45)*size/initial,textColor=HexColor(color or INK),alignment=align,splitLongWords=True)
   paragraph=Paragraph(value,style);_,h=paragraph.wrap(width,height)
   if h<=height+.01:break
   size-=.2
   if size<6.8:raise ValueError('Nội dung quá dài cho khung của mẫu: '+html.unescape(value[:90])+' — hãy rút gọn nội dung hoặc tắt bớt trường.')
  paragraph.drawOn(c,x,top-h);return h
 def centered(top,width,value,size=10,font='Regular',color=None,height=32):
  return para((W-width)/2,top,width,value,size,font,color,height=height,align=1)
 def box(x,y,w,h,color):c.setFillColor(HexColor(color));c.rect(x,y,w,h,fill=1,stroke=0)
 def line(x,y,x2,y2):c.setStrokeColor(HexColor('#D5DDD2'));c.setLineWidth(.5);c.line(x,y,x2,y2)
 def img(path,x,y,w,h,fit=None):
  if not path:return
  if path not in cache:
   with Image.open(path) as source:
    im=source.copy();iw,ih=im.size;im.thumbnail((750,750) if is_grid and max(w,h)<250 else (1400,1400),Image.Resampling.LANCZOS);s=io.BytesIO()
    if path in product_image_paths and (im.mode in ['RGBA','LA'] or 'transparency' in im.info):
     rgba=im.convert('RGBA');paper=Image.new('RGB',rgba.size,CREAM);paper.paste(rgba,mask=rgba.getchannel('A'));paper.save(s,format='JPEG',quality=92,subsampling=0,optimize=True)
    elif im.mode=='RGBA':im.save(s,format='PNG')
    else:im.convert('RGB').save(s,format='JPEG',quality=90)
    s.seek(0);cache[path]=(ImageReader(s),iw,ih)
  reader,iw,ih=cache[path];scale=max(w/iw,h/ih) if (fit or cfg['image_fit'])=='cover' else min(w/iw,h/ih)
  c.saveState();clip=c.beginPath();clip.rect(x,y,w,h);c.clipPath(clip,stroke=0);c.drawImage(reader,x+(w-iw*scale)/2,y+(h-ih*scale)/2,iw*scale,ih*scale,mask='auto');c.restoreState()
 def page_background():box(0,0,W,H,CREAM)
 def finish_page():
  c.showPage()
  if c.getPageNumber()<=total:page_background()
 def footer():
  line(28,48,567,48);img(logo,28,11,42,30,'contain');text(80,30,cfg['email'],8,width=365);text(80,16,' | '.join(v for v in [cfg['website'],cfg['phone']] if v),7.2,color=MUTED,width=365)
  if cfg['show_page_numbers']:text(485,30,f'{L["page"]} {c.getPageNumber()} / {total}',7.5,width=82)
  text(485,16,cfg['edition'],6.5,color=MUTED,width=82)
 def header(g,part,parts):
  img(logo,28,774,61,43,'contain');text(109,804,f'{L["group"]} {g["id"]} / {cfg["footer_text"]}',7.5,'Medium',GREEN,405)
  h=para(109,789,405,g['name'].upper(),19,'Bold',height=47,leading=24);text(109,789-h-15,g.get('name_en',''),7.4,color=MUTED,width=405);line(28,715,567,715)
 def product_row(p,top):
  if p['image']:img(p['image'],28,top-118,107,120)
  else:box(28,top-118,107,120,'#F4F5EF');para(40,top-50,83,L['missing_image'],7.5,color=MUTED,height=45)
  h=para(150,top,241,p['name'],10.8,'Bold',height=40,leading=14)
  text(150,top-h-13,group_by[p['group_id']].get('name_en',''),6.7,'Medium',MUTED,241)
  if cfg['show_description']:para(150,top-h-23,238,p.get('print_description') or p.get('short_description') or p.get('description') or '',8.4,height=64,leading=12)
  text(414,top-10,L['ordering'],6.9,'Bold',GREEN,152);info=[]
  for key in ['brand','unit_size','case_pack','minimum_order','price','origin','upc','availability','badges']:
   if not cfg.get('show_'+key,False):continue
   if key=='price':v=str(p['price'])+' '+str(p.get('currency') or '') if p.get('price') not in [None,''] else L['pending']
   elif key=='availability':v=L['in_stock'] if p['is_in_stock'] else L['on_request']
   elif key=='origin':v=p.get('country_of_origin') or L['pending']
   elif key=='badges':v=', '.join(p.get('badges') or []) if isinstance(p.get('badges'),list) else p.get('badges','')
   else:v=p.get(key) or L['pending']
   if v:info.append((L.get(key,key)+': '+str(v)) if key!='badges' else str(v))
  para(414,top-25,152,('\n' if len(info)>4 else '\n\n').join(info),7.8,height=98,leading=11)
  base=top-132;box(150,base-4,417,19,PALE);box(150,base-4,2,19,GREEN)
  if cfg['show_reference']:
   text(158,base+2,L['reference'],6.4,'Medium',MUTED,82)
   reference=str(p['code']);long_reference=pdfmetrics.stringWidth(reference,'Bold',8)>155
   # Long references get the remaining strip; the optional CTA is not printed over them.
   ref_width=310 if long_reference else 155
   text(247,base+2,reference,7 if long_reference else 8,'Bold',width=ref_width)
   if not long_reference:text(414,base+2,L['quote'],6.4,'Medium',GREEN,145)
  else:text(158,base+2,L['quote'],6.4,'Medium',GREEN,400)
  if top>220:line(28,base-13,567,base-13)
 def product_grid(rows,top,row_count):
  # Fixed A4 three-column geometry; every product comes from canonical data.
  gap_x=13;gap_y=12;cell_w=(539-2*gap_x)/3;cell_h=(top-68-(row_count-1)*gap_y)/row_count
  for i,p in enumerate(rows):
   col=i%3;row=i//3;x=28+col*(cell_w+gap_x);y=top-row*(cell_h+gap_y);base=y-cell_h
   # Match product photo size on opening and continuation pages for a given density.
   image_h=(699-68-(grid_rows-1)*12)/grid_rows-78
   if p['image']:img(p['image'],x+7,y-image_h,cell_w-14,image_h,'contain')
   else:
    box(x+7,y-image_h,cell_w-14,image_h,PALE)
    para(x+18,y-image_h/2+7,cell_w-36,L['missing_image'],7,color=MUTED,height=26,align=1)
   name_top=y-image_h-8
   para(x+5,name_top,cell_w-10,p['name'],8.7,'Bold',height=29,leading=11)
   details=[]
   if cfg['show_brand'] and p.get('brand') and str(p['brand']).casefold() not in p['name'].casefold():details.append(p['brand'])
   if cfg['show_unit_size'] and p.get('unit_size'):details.append(str(p['unit_size']))
   if cfg['show_case_pack'] and p.get('case_pack'):details.append(str(p['case_pack'])+' / '+('thùng' if cfg['locale']=='vi' else 'case'))
   if cfg['show_minimum_order'] and p.get('minimum_order'):details.append('MOQ '+str(p['minimum_order']))
   if cfg['show_price'] and p.get('price') not in [None,'']:details.append(str(p['price'])+' '+str(p.get('currency') or 'USD'))
   if cfg['show_origin'] and p.get('country_of_origin'):details.append(str(p['country_of_origin']))
   if cfg['show_upc'] and p.get('upc'):details.append('UPC '+str(p['upc']))
   if cfg['show_availability']:details.append(L['in_stock'] if p['is_in_stock'] else L['on_request'])
   if cfg['show_badges'] and p.get('badges'):details.extend(p['badges'] if isinstance(p['badges'],list) else [str(p['badges'])])
   # Short facts only; no filler paragraphs or repeated pending-field labels.
   para(x+5,name_top-31,cell_w-10,' · '.join(details),7,color=MUTED,height=20,leading=9)
   c.setStrokeColor(HexColor('#D8D7C9'));c.setLineWidth(.5);c.line(x+5,base+14,x+cell_w-5,base+14)
   box(x+5,base+12,17,2,'#A88D54')
   if cfg['show_reference']:text(x+5,base+2,p['code'],6.9,'Bold',GREEN,cell_w-10)
   if col<2:
    c.setStrokeColor(HexColor('#E5E0D4'));c.setLineWidth(.4);c.line(x+cell_w+gap_x/2,base+24,x+cell_w+gap_x/2,y-4)
 page_background()
 if cfg['show_cover']:
  # Full photographic cover; text stays vector and content comes from profile settings.
  box(0,0,W,H,'#FFFFFF')
  cover=managed_image(cfg['cover_image'])
  if cover:img(cover,0,0,W,H,'cover')
  else:
   photo=next((managed_image(g.get('hero_image')) for g in groups if managed_image(g.get('hero_image'))),None)
   img(photo,0,18,W,514,'cover')
  vector_logo=A/'ulink-logo-vector.json'
  if logo and vector_logo.exists() and not cfg['logo_image']:
   vector=json.loads(vector_logo.read_text());scale=min(184/vector['width'],130/vector['height'])
   c.saveState();c.translate((W-vector['width']*scale)/2,701+vector['height']*scale);c.scale(scale,-scale)
   for layer in vector['paths']:
    path=c.beginPath()
    for cmd,pts in layer['commands']:
     if cmd=='M':path.moveTo(*pts)
     elif cmd=='L':path.lineTo(*pts)
     elif cmd=='C':path.curveTo(*pts)
     elif cmd=='Z':path.close()
    c.setFillColor(HexColor(layer['fill']));c.drawPath(path,fill=1,stroke=0,fillMode=0)
   c.restoreState()
  else:img(logo,(W-184)/2,701,184,130,'contain')
  c.setStrokeColor(HexColor('#008532'));c.setLineWidth(.7);c.line(175,693,278,693);c.line(317,693,420,693)
  # Two restrained vector leaves, matching the reference's small divider.
  c.setFillColor(HexColor('#008532'))
  for flip in [-1,1]:
   c.saveState();c.translate(W/2,688);c.scale(flip,1);leaf=c.beginPath();leaf.moveTo(0,0);leaf.curveTo(13,1,17,9,15,16);leaf.curveTo(4,14,0,8,0,0);c.drawPath(leaf,fill=1,stroke=0);c.restoreState()
  centered(682,520,cfg['title'],69,'Bold','#008532',height=85)
  # Native font outlines in PDF: balanced spacing, never rasterized lettering.
  heading=str(cfg['subtitle']);size=50;tracking=4.5
  while size>12 and pdfmetrics.stringWidth(heading,'Regular',size)+tracking*max(0,len(heading)-1)>495:size-=.5
  width=pdfmetrics.stringWidth(heading,'Regular',size)+tracking*max(0,len(heading)-1)
  c.saveState();t=c.beginText((W-width)/2,575);t.setFont('Regular',size);t.setCharSpace(tracking);t.setFillColor(HexColor('#141B15'));t.textOut(heading);c.drawText(t);c.restoreState()
  centered(558,520,cfg['cover_tagline'],10.2,'Medium','#366445',height=21)
  centered(58,535,cfg['company']+'  |  '+cfg['edition'],8.8,'Bold','#008532',height=15)
  centered(43,535,'  •  '.join(v for v in [cfg['website'],cfg['email'],cfg['phone']] if v),8,'Medium',height=15)
  centered(28,535,cfg['address'],7.5,'Regular',MUTED,height=14)
  finish_page()
 for chunk in toc_chunks:
  img(logo,28,763,71,50,'contain');para(117,805,440,cfg['contents_title'],22,'Bold',height=43);text(117,752,cfg['edition'],8,'Medium',MUTED,430)
  para(28,729,537,cfg['contents_intro'],10,height=52);y=660
  for g in chunk:
   text(28,y,g['id'],10,'Bold',GREEN,30);text(63,y,g['name'],10.5,'Medium',width=360);text(435,y,str(sum(p['group_id']==g['id'] for p in products))+' '+L['items'],8,color=MUTED,width=90);text(540,y,starts[g['id']],10,'Bold');c.linkRect('','group-'+g['id'],(28,y-8,566,y+17),relative=0,thickness=0);line(28,y-12,567,y-12);y-=27
  para(28,122,536,cfg['disclaimer'],8,color=MUTED,height=60);footer();finish_page()
 for g,rows,part,parts in batches:
  if part==1:c.bookmarkPage('group-'+g['id']);c.addOutlineEntry(g['name'],'group-'+g['id'],level=0)
  if part==1 and cfg['show_banner']:
   hero=managed_image(g.get('hero_image'))
   if hero:img(hero,0,H-211,W,211,'cover')
   else:
    box(0,H-211,W,211,PALE)
    if any(g.get('banner_images') or []):chosen=[managed_image(v) for v in g['banner_images']]
    else:chosen=[p['image'] for p in products if p['group_id']==g['id'] and p['image']][:3]
    chosen=[v for v in chosen if v]
    for i,path in enumerate(chosen):img(path,i*W/len(chosen)+20,H-201,W/len(chosen)-40,175)
   box(0,H-214,W,3,'#BAA780')
   box(0,H-56,184,22,GREEN);text(22,H-49,f'{cfg["footer_text"]} / {g["id"]}',8,'Medium','#FBF8F0',160)
   h=para(28,613,430,g['name'].upper(),21,'Bold',GREEN,height=50,leading=26)
   para(28,613-h-10,539,g.get('intro',cfg['group_intro']),9,height=max(20,613-h-10-530))
   tops=[520,370,220]
  else:header(g,part,parts);tops=[699,544,389,234]
  if is_grid:product_grid(rows,520 if part==1 and cfg['show_banner'] else 699,2 if part==1 and cfg['show_banner'] else grid_rows)
  else:
   for p,top in zip(rows,tops):product_row(p,top)
  footer();finish_page()
 if cfg['show_closing']:
  box(0,0,W,H,PALE);img(logo,28,746,94,67,'contain');para(28,718,539,cfg['closing_title'],31,'Bold',height=54);para(28,661,539,cfg['closing_subtitle'],31,'Bold',GREEN,54)
  para(28,603,504,cfg['closing_intro'],12,height=90);y=470
  for i,step in enumerate(cfg['steps']):
   text(28,y,f'{i+1:02}',26,'Bold',GREEN);para(84,y+15,470,step['title'],12,'Bold',height=30);para(84,y-18,470,step['body'],10,height=50);line(28,y-65,567,y-65);y-=110
  box(28,65,539,99,GREEN);text(44,139,cfg['website'],19,'Bold','#FFFFFF',505);text(44,111,' | '.join(v for v in [cfg['email'],cfg['phone']] if v),10,color='#FFFFFF',width=505);text(44,89,cfg['address'],9,color='#FFFFFF',width=505)
  if cfg['contact_url'].startswith(('https://','http://')):c.linkURL(cfg['contact_url'],(28,65,567,164),relative=0)
  footer();finish_page()
 c.save();assert c.getPageNumber()-1==total
 return {'entries':len(products),'pages':total,'missing_images':sum(not p['image'] for p in products)}
