"""Remove three initial generic filler listings from Ulink; retain ERP records."""
from sqlalchemy import select
from app.db.models import ShowcaseItem,WebsiteListing
from app.db.session import SessionLocal
CODES=['FOD-FISH-SAUCE','PKG-BAG-WM','ART-STATUE-01']
with SessionLocal() as db:
 for code in CODES:
  s=db.scalar(select(ShowcaseItem).where(ShowcaseItem.code==code));assert s,code
  l=db.scalar(select(WebsiteListing).where(WebsiteListing.site=='ulink',WebsiteListing.showcase_id==s.id));assert l,code
  l.is_published=False
  print('Unpublished',code,s.name)
 db.commit()
