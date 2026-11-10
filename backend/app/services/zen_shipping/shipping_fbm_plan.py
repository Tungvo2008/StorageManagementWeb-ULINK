"""Freeze a single verified Amazon order using preserved FBM parcel defaults."""
import hashlib,json,re
from datetime import datetime,timezone
from .shippo_provider import Shippo

def prepare_fbm(order_id,address,order,origin,migration_started_at):
 if not re.fullmatch(r'[0-9]{3}-[0-9]{7}-[0-9]{7}',order_id):raise ValueError('EXACT_AMAZON_ORDER_ID_REQUIRED')
 if order.get('amazon_order_id')!=order_id or order.get('order_status')!='Unshipped':raise ValueError('EXACT_UNSHIPPED_ORDER_NOT_VERIFIED')
 def timestamp(value):
  try:d=datetime.fromisoformat(str(value).replace('Z','+00:00'))
  except (ValueError,TypeError):raise ValueError('ORDER_PURCHASE_DATE_REQUIRED') from None
  return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)
 if timestamp(order.get('purchase_date'))<=timestamp(migration_started_at):raise ValueError('LEGACY_FBM_ORDER_REQUIRES_ORIGINAL_LABEL_RECONCILIATION')
 destination=Shippo.address(address)
 norm=lambda v:re.sub(r'\s+',' ',str(v or '').strip()).casefold()
 if (not all(order.get(k) for k in ('city','state','postal_code')) or norm(destination['city'])!=norm(order['city'])
  or norm(destination['state'])!=norm(order['state']) or re.sub(r'\D','',destination['zip'])[:5]!=re.sub(r'\D','',str(order['postal_code']))[:5]
  or destination['country']!=str(order.get('country_code') or 'US').upper()):raise ValueError('ORDER_DESTINATION_MISMATCH_OR_INCOMPLETE')
 # If Amazon supplies full address data, enforce it; restricted-address orders
 # still require the user's explicit complete destination plus geography match.
 for source,target in [('address_line_1','street1'),('address_line_2','street2')]:
  if order.get(source) and norm(order[source])!=norm(destination.get(target)):raise ValueError('ORDER_STREET_MISMATCH')
 content={'kind':'fbm','batch_id':order_id,'batch_code':order_id,'origin':Shippo.address(origin),'service':'ups_ground','label_file_type':'PDF_4x6',
  'order_purchase_date':order['purchase_date'],'labels':[{'business_key':'fbm:'+order_id,'box_id':order_id,'box_code':order_id,'address_to':destination,
   'parcel':{'length':'10','width':'8','height':'6','weight':'8','distance_unit':'in','mass_unit':'lb'},'reference':order_id}]}
 content['plan_sha256']=hashlib.sha256(json.dumps(content,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
 return content
