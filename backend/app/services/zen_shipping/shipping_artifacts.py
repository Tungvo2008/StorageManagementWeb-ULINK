"""Retain provider-bound labels and merge pages in frozen box order."""
import hashlib,io,os,re,tempfile,urllib.request
from pathlib import Path
from urllib.parse import urlsplit
from pypdf import PdfReader,PdfWriter

def allowed(url):
 parsed=urlsplit(url)
 return parsed.scheme=='https' and parsed.port in (None,443) and not parsed.username and not parsed.password and (parsed.hostname=='deliver.goshippo.com' or parsed.hostname=='shippo-delivery.s3.amazonaws.com')
class SafeRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,request,fp,code,msg,headers,newurl):
  if not allowed(newurl):raise ValueError('LABEL_REDIRECT_NOT_ALLOWED')
  return super().redirect_request(request,fp,code,msg,headers,newurl)
def download(url):
 if not allowed(url):raise ValueError('LABEL_ORIGIN_NOT_ALLOWED')
 with urllib.request.build_opener(SafeRedirect()).open(url,timeout=25) as response:content=response.read(10*1024*1024+1)
 if not 1<=len(content)<=10*1024*1024:raise ValueError('LABEL_SIZE_LIMIT')
 return content

def merge_labels(job,directory,fetch=download):
 if job['state']!='TRANSACTIONS_VERIFIED':raise ValueError('VERIFIED_TRANSACTIONS_REQUIRED')
 labels=job['plan']['labels'];transactions=(job.get('receipt') or {}).get('_verified_transactions') or []
 keyed={row['business_key']:row for row in transactions}
 if len(keyed)!=len(transactions) or set(keyed)!={label['business_key'] for label in labels}:raise ValueError('ARTIFACT_TRANSACTION_SET_MISMATCH')
 writer=PdfWriter();mapping=[];seen=set()
 for index,label in enumerate(labels):
  transaction=keyed[label['business_key']]
  if transaction['transaction_id'] in seen or transaction['box_id']!=label['box_id']:raise ValueError('ARTIFACT_BOX_TRANSACTION_MISMATCH')
  seen.add(transaction['transaction_id'])
  content=fetch(transaction['label_url'])
  if not content.startswith(b'%PDF-') or len(content)>10*1024*1024:raise ValueError('INVALID_PROVIDER_LABEL_PDF')
  reader=PdfReader(io.BytesIO(content))
  if reader.is_encrypted or len(reader.pages)!=1:raise ValueError('LABEL_MUST_HAVE_ONE_PAGE')
  page=reader.pages[0];dimensions=sorted([float(page.mediabox.width),float(page.mediabox.height)])
  if abs(dimensions[0]-288)>3 or abs(dimensions[1]-432)>3:raise ValueError('LABEL_NOT_4X6')
  writer.add_page(page)
  mapping.append({'box_id':label['box_id'],'box_code':label['box_code'],'transaction_id':transaction['transaction_id'],
   'tracking_number':transaction['tracking_number'],'page':index+1,'label_sha256':hashlib.sha256(content).hexdigest()})
 output=io.BytesIO();writer.write(output);merged=output.getvalue()
 if len(merged)>30*1024*1024:raise ValueError('MERGED_LABEL_LIMIT')
 digest=hashlib.sha256(merged).hexdigest();root=Path(directory);root.mkdir(parents=True,exist_ok=True,mode=0o700)
 target=root/(digest+'.pdf')
 fd,name=tempfile.mkstemp(prefix='.labels-',dir=root)
 try:
  os.fchmod(fd,0o600)
  with os.fdopen(fd,'wb') as stream:stream.write(merged);stream.flush();os.fsync(stream.fileno())
  os.replace(name,target)
 finally:
  if os.path.exists(name):os.unlink(name)
 return {'artifact_verified':True,'artifact':{'type':'document','path':str(target),'caption':'Nhãn vận chuyển '+str(job['plan']['batch_code'])},
  'sha256':digest,'page_count':len(mapping),'box_tracking_pages':mapping,
  'verification':'Authenticated transaction/rate/shipment binding + downloaded provider PDF + 4x6/page checks; not OCR tracking proof'}
