import json,hashlib
from pathlib import Path
from PIL import Image
from urllib.parse import urlparse,unquote
P=Path('/app/exports/pdp-enrichment-20261115');P.mkdir(exist_ok=True)
rows=json.load(open(P/'before-private.json'));out=[]
for row in rows:
 for m in row['vi']['images']:
  filename=unquote(Path(urlparse(m['image_url']).path).name);f=Path('/app/assets/product-images')/filename
  r={'sku':row['sku'],'media_id':m['id'],'filename':filename,'is_primary':m['is_primary']}
  try:
   with Image.open(f) as im:r.update(width=im.width,height=im.height,format=im.format,bytes=f.stat().st_size,sha256=hashlib.sha256(f.read_bytes()).hexdigest())
  except Exception as e:r['error']=str(e)
  out.append(r)
(P/'media-audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));print(json.dumps({'media':len(out),'broken':sum('error' in x for x in out),'bytes':sum(x.get('bytes',0) for x in out)}))
