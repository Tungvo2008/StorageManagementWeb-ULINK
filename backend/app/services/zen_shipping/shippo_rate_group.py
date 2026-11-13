"""Grouped rate-based transactions for Shippo UPS master accounts.
One ERP job/PDF; each purchase has its own persisted non-repeatable send intent.
"""
import json,re,time
from decimal import Decimal
from .shippo_batch import ShippoBatch

class RateGroup(ShippoBatch):
 def create(self,job_id,carrier_account):
  job=self.get(job_id)
  if job['state']!='PREPARED':return job
  if not re.fullmatch(r'[a-f0-9]{32}',carrier_account):raise ValueError('EXPLICIT_CARRIER_ACCOUNT_REQUIRED')
  plan=job['plan']
  if plan['service']!='ups_ground' or plan['label_file_type']!='PDF_4x6':raise ValueError('SHIPPING_SERVICE_CONFLICT')
  if not self.transition(job_id,'PREPARED','CREATE_SENT'):return self.get(job_id)
  remote={'metadata':job_id,'_purchase_mode':'rates_v1','_local_identity_complete':True,'default_carrier_account':carrier_account,'batch_shipments':{'results':[]},'object_results':{}}
  try:
   for label in plan['labels']:
    shipment=self.provider.request('POST','/shipments/',{'address_from':plan['origin'],'address_to':label['address_to'],'parcels':[label['parcel']],'carrier_accounts':[carrier_account],'async':False,'metadata':label['business_key'],'extra':{'reference_1':label['reference']}})
    if not re.fullmatch(r'[a-f0-9]{32}',str(shipment.get('object_id',''))):raise ValueError('INVALID_SHIPMENT_ID')
    rates=[r for r in shipment.get('rates',[]) if r.get('carrier_account')==carrier_account and str(r.get('provider','')).casefold()=='ups' and (r.get('servicelevel')or{}).get('token')=='ups_ground' and r.get('currency')=='USD' and Decimal(str(r.get('amount','-1'))).is_finite() and Decimal(str(r.get('amount','-1')))>=0]
    if not rates:raise ValueError('UPS_GROUND_RATE_UNAVAILABLE')
    rate=min(rates,key=lambda r:Decimal(str(r['amount'])))
    if not re.fullmatch(r'[a-f0-9]{32}',str(rate.get('object_id',''))):raise ValueError('INVALID_RATE_ID')
    remote['batch_shipments']['results'].append({'metadata':label['business_key'],'carrier_account':carrier_account,'servicelevel_token':'ups_ground','shipment':shipment['object_id'],'rate':rate['object_id'],'amount':str(rate['amount']),'transaction':None,'send_state':'UNSENT'})
    with self.db() as db:db.execute('UPDATE zen_shipping_jobs SET receipt=?,updated=? WHERE id=? AND state=?',(json.dumps(remote),time.time(),job_id,'CREATE_SENT'))
  except Exception:raise # No paid request happened; retain partial rate preparation.
  self.transition(job_id,'CREATE_SENT','VALIDATED',receipt=remote)
  return self.get(job_id)
 def observe(self,job_id):
  job=self.get(job_id);remote=job['receipt'] or {}
  if remote.get('_purchase_mode')!='rates_v1':return super().observe(job_id)
  if job['state'] in ('VALIDATED','TRANSACTIONS_VERIFIED','ARTIFACTS_VERIFIED'):return job
  if job['state']=='CREATE_SENT':return job
  receipt_before=json.dumps(remote)
  rows=remote['batch_shipments']['results'];success=failed=0
  for row in rows:
   if row.get('transaction'):
    tx=self.provider.request('GET','/transactions/'+row['transaction']+'/')
    if tx.get('object_id')!=row['transaction']:raise ValueError('TRANSACTION_IDENTITY_MISMATCH')
    row['status']=tx.get('status');row['messages']=tx.get('messages',[])
    if tx.get('status')=='SUCCESS':success+=1
    elif tx.get('status')=='ERROR':failed+=1
  remote['_local_transaction_ids']=[r['transaction'] for r in rows if r.get('transaction')]
  remote['object_results']={'purchase_succeeded':success,'purchase_failed':failed}
  state='PURCHASE_RETURNED' if success==len(job['plan']['labels']) else 'PARTIAL' if failed or any(r.get('send_state')=='UNSENT' for r in rows) else 'PURCHASING'
  with self.db() as db:db.execute('UPDATE zen_shipping_jobs SET state=?,receipt=?,updated=? WHERE id=? AND state=? AND receipt=?',(state,json.dumps(remote),time.time(),job_id,job['state'],receipt_before))
  return self.get(job_id)
 def purchase(self,job_id,expected_plan_sha):
  job=self.get(job_id);remote=job['receipt']or{}
  if remote.get('_purchase_mode')!='rates_v1':raise ValueError('LEGACY_INSTALABEL_JOB_REQUIRES_RECONCILIATION')
  if job['plan_sha']!=expected_plan_sha:raise ValueError('PURCHASE_PLAN_CHANGED')
  if job['state']!='VALIDATED':return self.observe(job_id)
  if not self.transition(job_id,'VALIDATED','PURCHASE_SENT'):return self.observe(job_id)
  rows=remote['batch_shipments']['results']
  for row in rows:
   row['send_state']='SENT'
   with self.db() as db:db.execute('UPDATE zen_shipping_jobs SET receipt=?,updated=? WHERE id=?',(json.dumps(remote),time.time(),job_id))
   try:tx=self.provider.request('POST','/transactions/',{'rate':row['rate'],'label_file_type':'PDF_4x6','async':False,'metadata':job_id+':'+row['metadata']})
   except Exception:return self.observe(job_id) # Lost ACK: never resend this rate.
   tid=tx.get('object_id')
   if not re.fullmatch(r'[a-f0-9]{32}',str(tid or '')):return self.observe(job_id)
   row['transaction']=tid;row['send_state']='RECEIVED';row['status']=tx.get('status');row['messages']=tx.get('messages',[])
   with self.db() as db:db.execute('UPDATE zen_shipping_jobs SET receipt=?,updated=? WHERE id=?',(json.dumps(remote),time.time(),job_id))
   if tx.get('status')=='ERROR':break
  return self.observe(job_id)
