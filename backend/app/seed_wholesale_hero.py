from sqlalchemy import select
from app.db.models import WebsitePageBlock
from app.db.session import SessionLocal
with SessionLocal() as db:
 for lang,body in [('vi','Mua sỉ hàng Việt, đưa hàng sang Mỹ hoặc vận hành bán hàng tại Mỹ. ULINK trực tiếp hỗ trợ nguồn hàng, FDA & US Agent, vận chuyển, kho bãi và fulfillment.'),('en','Buy Vietnamese goods wholesale, bring products to the US or run your US sales operations. ULINK directly supports sourcing, FDA & US Agent, shipping, warehousing and fulfillment.')]:
  b=db.scalar(select(WebsitePageBlock).where(WebsitePageBlock.site=='ulink',WebsitePageBlock.page=='home',WebsitePageBlock.block_key=='hero',WebsitePageBlock.locale==lang));assert b
  b.body=body
 db.commit()
 print('Wholesale included in bilingual homepage CMS copy')
