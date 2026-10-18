from sqlalchemy import select
from app.db.models import WebsitePageBlock
from app.db.session import SessionLocal
with SessionLocal() as db:
 for lang,title,body in [('vi','Hàng Việt sang Mỹ.\nKinh doanh cùng ULINK.','Từ nguồn hàng, FDA & US Agent đến vận chuyển, kho bãi và fulfillment. ULINK trực tiếp đồng hành cùng người Việt kinh doanh ở hai thị trường.'),('en','Vietnam to America.\nBuild with ULINK.','From sourcing and FDA & US Agent support to shipping, warehousing and fulfillment. ULINK directly supports Vietnamese businesses across both markets.')]:
  b=db.scalar(select(WebsitePageBlock).where(WebsitePageBlock.site=='ulink',WebsitePageBlock.page=='home',WebsitePageBlock.block_key=='hero',WebsitePageBlock.locale==lang))
  if not b:b=WebsitePageBlock(site='ulink',page='home',block_key='hero',locale=lang,is_published=True);db.add(b)
  b.title=title;b.body=body;b.cta_label='Để ULINK liên hệ tư vấn' if lang=='vi' else 'Request a callback'
 db.commit()
 print('Updated bilingual homepage hero; CMS editing preserved')
