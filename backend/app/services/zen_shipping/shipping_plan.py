"""Freeze a verified batch into provider-neutral label inputs; never buy labels."""
import hashlib,json,math
from decimal import Decimal

def positive(value,field):
 if isinstance(value,bool):raise ValueError('INVALID_'+field)
 try:number=Decimal(str(value))
 except Exception:raise ValueError('INVALID_'+field) from None
 if not number.is_finite() or number<=0:raise ValueError('MISSING_OR_INVALID_'+field)
 return format(number.normalize(),'f')

def prepare_batch(batch,labels,measurements,origin):
 """labels are rows from the existing verified exporter, not model inventions.
 measurements keyed by exact box_id must come from confirmed business data/input.
 """
 from .shippo_provider import Shippo
 origin=Shippo.address(origin)
 if not isinstance(batch,dict) or not batch.get('id') or not batch.get('batch_code'):raise ValueError('EXACT_BATCH_REQUIRED')
 boxes=sorted(batch.get('boxes',[]),key=lambda row:row['id'])
 if not boxes or batch.get('unassigned_bills'):raise ValueError('BATCH_INCOMPLETE')
 if len(labels)!=len(boxes):raise ValueError('LABEL_COUNT_MISMATCH')
 ids=[str(box['id']) for box in boxes]
 if len(set(ids))!=len(ids) or set(measurements)!=set(ids):raise ValueError('EXACT_BOX_MEASUREMENTS_REQUIRED')
 result=[];keys=set()
 for box,label in zip(boxes,labels):
  key=str(batch['batch_code'])+'-'+str(box['box_code'])
  if key in keys or label.get('order_id')!=key:raise ValueError('BOX_LABEL_IDENTITY_MISMATCH')
  keys.add(key);values=measurements[str(box['id'])]
  weight=positive(values.get('weight_lbs'),'WEIGHT_LBS')
  if Decimal(weight)>150:raise ValueError('UPS_WEIGHT_OUT_OF_RANGE')
  parcel={'weight':weight,'mass_unit':'lb','distance_unit':'in'}
  for field in ('length','width','height'):parcel[field]=positive(values.get(field+'_in'),field.upper()+'_IN')
  destination=Shippo.address(label.get('address_to'))
  # Preserve shipment label details and original box identity across providers.
  if label.get('company'):destination['company']=str(label['company'])
  result.append({'business_key':'cargo:'+key,'box_id':box['id'],'box_code':box['box_code'],
   'address_to':destination,'parcel':parcel,'reference':str(label.get('reference') or key)})
 content={'batch_id':batch['id'],'batch_code':batch['batch_code'],'origin':origin,'service':'ups_ground',
          'label_file_type':'PDF_4x6','labels':result}
 content['plan_sha256']=hashlib.sha256(json.dumps(content,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
 return content

def labels_from_export(content):
 """Consume the existing shipping export, preserving receiver/company/stamps."""
 import io,zipfile
 from openpyxl import load_workbook
 with zipfile.ZipFile(io.BytesIO(content)) as archive:
  if sum(entry.file_size for entry in archive.infolist())>30*1024*1024:raise ValueError('EXPORT_EXPANSION_LIMIT')
 book=load_workbook(io.BytesIO(content),read_only=True,data_only=False)
 try:
  if book.sheetnames!=['PirateShip Labels']:raise ValueError('EXPORT_SHEET_CHANGED')
  rows=list(book.active.iter_rows(values_only=True))
  headers=['Order ID','Full Name','Company','Address Line 1','Address Line 2','City','State','Zip','Country','Weight (lbs)','Rubber Stamp 1']
  if not rows or list(rows[0])!=headers or not 1<=len(rows)-1<=100:raise ValueError('EXPORT_SHAPE_CHANGED')
  labels=[]
  for row in rows[1:]:
   if len(row)!=len(headers) or any(isinstance(v,str) and v.startswith('=') for v in row):raise ValueError('EXPORT_ROW_INVALID')
   labels.append({'order_id':str(row[0]),'address_to':{'name':row[1],'street1':row[3],'street2':row[4] or '',
    'city':row[5],'state':row[6],'zip':str(row[7]),'country':row[8]},'company':row[2] or '',
    'reference':row[10] or str(row[0])})
  return labels
 finally:book.close()
