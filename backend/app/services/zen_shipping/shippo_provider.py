"""Shippo transport: explicit origin, unchanged FBM parcel, strict UPS Ground.
Purchase POST has no automatic retry; callers must persist intent before invoking.
"""
import json,urllib.request
from decimal import Decimal
from pathlib import Path

DEFAULT_PARCEL={'length':'10','width':'8','height':'6','distance_unit':'in','weight':'8','mass_unit':'lb'}
class Shippo:
 def __init__(self,key_file,origin,request=None,key_provider=None):
  self.key_file=Path(key_file);self.origin=self.address(origin);self.request_impl=request;self.key_provider=key_provider
 @staticmethod
 def address(value):
  if not isinstance(value,dict):raise ValueError('EXPLICIT_SHIPPING_ADDRESS_REQUIRED')
  output={key:str(value.get(key) or '').strip() for key in ('name','company','street1','street2','city','state','zip','country','phone','email')}
  if not all(output[key] for key in ('name','street1','city','state','zip','country')):raise ValueError('COMPLETE_SHIPPING_ADDRESS_REQUIRED')
  return {key:value for key,value in output.items() if value}
 def request(self,method,path,payload=None):
  if self.request_impl:return self.request_impl(method,path,payload)
  key=self.key_provider() if self.key_provider else self.key_file.read_text().strip()
  if not key.startswith(('shippo_live_','shippo_test_')):raise ValueError('SHIPPO_KEY_INVALID')
  req=urllib.request.Request('https://api.goshippo.com'+path,method=method,
   data=json.dumps(payload).encode() if payload is not None else None,
   headers={'Authorization':'ShippoToken '+key,'Content-Type':'application/json','Shippo-API-Version':'2018-02-08'})
  with urllib.request.urlopen(req,timeout=25) as response:
   raw=response.read(2*1024*1024+1)
   if len(raw)>2*1024*1024:raise ValueError('SHIPPO_RESPONSE_TOO_LARGE')
   return json.loads(raw)
 def quote(self,destination,order_id,parcel=None):
  data=self.request('POST','/shipments/',{'address_from':self.origin,'address_to':self.address(destination),
   'parcels':[dict(parcel or DEFAULT_PARCEL)],'async':False,'metadata':order_id})
  rates=[row for row in data.get('rates',[]) if str(row.get('provider','')).casefold()=='ups'
   and (row.get('servicelevel') or {}).get('token')=='ups_ground' and row.get('currency')=='USD'
   and row.get('object_id') and Decimal(str(row.get('amount','-1')))>=0]
  if not rates:raise ValueError('SHIPPO_UPS_GROUND_UNAVAILABLE_NO_PURCHASE')
  rate=min(rates,key=lambda row:Decimal(str(row['amount'])))
  return {'provider':'shippo','shipment_id':data['object_id'],'rate_id':rate['object_id'],
   'amount':str(rate['amount']),'currency':'USD','service':'UPS Ground','order_id':order_id,
   'parcel':dict(parcel or DEFAULT_PARCEL),'test':data.get('test')}
 def purchase_once(self,quote):
  # A network failure here is UNKNOWN, never an instruction to retry this POST.
  return self.request('POST','/transactions/',{'rate':quote['rate_id'],'label_file_type':'PDF_4x6',
   'async':False,'metadata':quote['order_id']})
 def transaction(self,transaction_id):
  import re
  if not re.fullmatch(r'[a-f0-9]{32}',transaction_id):raise ValueError('SHIPPO_TRANSACTION_ID_INVALID')
  return self.request('GET','/transactions/'+transaction_id+'/')
