import asyncio,io
from PIL import Image
from fastapi import UploadFile
from app.api.v1.catalog_studio import upload_catalog_image
async def main():
 s=io.BytesIO();Image.new('RGBA',(2,2),(0,255,0,0)).save(s,'PNG');s.seek(0)
 result=await upload_catalog_image(UploadFile(filename='transparent-test.png',file=s))
 from pathlib import Path
 p=Path('/app/assets/product-images')/result['url'].split('/')[-1]
 with Image.open(p) as im:assert im.mode=='RGBA' and im.getpixel((0,0))[3]==0
 p.unlink();print('Transparent logo upload PASS')
asyncio.run(main())
