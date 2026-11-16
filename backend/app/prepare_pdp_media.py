import json,hashlib
from pathlib import Path
from PIL import Image,ImageOps
P=Path('/app/exports/pdp-enrichment-20261115');root=Path('/app/assets/product-images');rows=json.load(open(P/'media-audit.json'));result=[]
for r in rows:
 if 'error' in r or r['bytes']<150000:continue
 source=root/r['filename'];name='pdp-'+r['sha256'][:20]+'.webp';target=root/name
 if not target.exists():
  with Image.open(source) as im:
   im=ImageOps.exif_transpose(im);im.thumbnail((1600,1600),Image.Resampling.LANCZOS)
   if im.mode not in ['RGB','RGBA']:im=im.convert('RGBA' if 'transparency' in im.info else 'RGB')
   im.save(target,'WEBP',quality=95,method=6)
 if target.stat().st_size>=r['bytes']*.9:continue
 result.append({**r,'new_filename':name,'new_bytes':target.stat().st_size})
(P/'optimized-media.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({'prepared':len(result),'before':sum(x['bytes'] for x in result),'after':sum(x['new_bytes'] for x in result)}))
