"""One native Shippo batch per frozen plan. Persistent one-way send boundaries.
External calls never hold a DB transaction; lost purchase ACK only permits GET.
"""
import hashlib,json,re,sqlite3,time,uuid
from contextlib import contextmanager
from pathlib import Path

class ShippoBatch:
 def __init__(self,database,provider):
  self.path=Path(database);existed=self.path.exists();self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);self.provider=provider
  with self.db() as db:
   db.execute('CREATE TABLE IF NOT EXISTS zen_shipping_jobs (id TEXT PRIMARY KEY,batch_key TEXT NOT NULL UNIQUE,plan_sha TEXT NOT NULL,plan TEXT NOT NULL,state TEXT NOT NULL,remote_id TEXT,receipt TEXT,updated REAL NOT NULL)')
   db.execute('CREATE TABLE IF NOT EXISTS zen_shipping_claims (business_key TEXT PRIMARY KEY,job_id TEXT NOT NULL)')
  if not existed:self.path.chmod(0o600)
 @contextmanager
 def db(self):
  db=sqlite3.connect(self.path,timeout=5);db.row_factory=sqlite3.Row;db.execute('PRAGMA synchronous=FULL')
  try:
   with db:yield db
  finally:db.close()
 def get(self,job_id):
  with self.db() as db:row=db.execute('SELECT * FROM zen_shipping_jobs WHERE id=?',(job_id,)).fetchone()
  if not row:raise ValueError('SHIPPING_JOB_NOT_FOUND')
  return {**dict(row),'plan':json.loads(row['plan']),'receipt':json.loads(row['receipt']) if row['receipt'] else None}
 def prepare(self,plan):
  # Recompute instead of trusting a caller-supplied fingerprint.
  content={k:v for k,v in plan.items() if k!='plan_sha256'}
  fingerprint=hashlib.sha256(json.dumps(content,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
  if plan.get('plan_sha256')!=fingerprint:raise ValueError('PLAN_HASH_MISMATCH')
  keys=[row['business_key'] for row in plan['labels']]
  if not keys or len(keys)>100 or len(set(keys))!=len(keys):raise ValueError('PLAN_LABELS_INVALID')
  kind=plan.get('kind','cargo')
  if kind not in ('cargo','fbm'):raise ValueError('SHIPPING_KIND_NOT_REVIEWED')
  key=kind+':'+str(plan['batch_id']);job_id='ship_'+uuid.uuid4().hex
  with self.db() as db:
   db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT id,plan_sha FROM zen_shipping_jobs WHERE batch_key=?',(key,)).fetchone()
   if old:
    if old['plan_sha']!=fingerprint:raise ValueError('FROZEN_BATCH_PLAN_CONFLICT')
    return old['id']
   db.execute('INSERT INTO zen_shipping_jobs VALUES(?,?,?,?,?,NULL,NULL,?)',(job_id,key,fingerprint,json.dumps(plan), 'PREPARED',time.time()))
   for business_key in keys:db.execute('INSERT INTO zen_shipping_claims VALUES(?,?)',(business_key,job_id))
  return job_id
 def transition(self,job_id,expected,state,receipt=None,remote_id=None):
  with self.db() as db:
   changed=db.execute('UPDATE zen_shipping_jobs SET state=?,receipt=COALESCE(?,receipt),remote_id=COALESCE(?,remote_id),updated=? WHERE id=? AND state=?',
    (state,json.dumps(receipt) if receipt is not None else None,remote_id,time.time(),job_id,expected)).rowcount
  return changed==1
 def create(self,job_id,carrier_account):
  job=self.get(job_id)
  if job['state']!='PREPARED':return self.get(job_id)
  if not re.fullmatch(r'[a-f0-9]{32}',carrier_account):raise ValueError('EXPLICIT_CARRIER_ACCOUNT_REQUIRED')
  plan=job['plan']
  if plan['service']!='ups_ground' or plan['label_file_type']!='PDF_4x6':raise ValueError('SHIPPING_SERVICE_CONFLICT')
  payload={'default_carrier_account':carrier_account,'default_servicelevel_token':'ups_ground','label_filetype':'PDF_4x6','metadata':job_id,
   'batch_shipments':[{'metadata':label['business_key'],'carrier_account':carrier_account,'servicelevel_token':'ups_ground',
    'shipment':{'address_from':plan['origin'],'address_to':label['address_to'],'parcels':[label['parcel']],
     'metadata':label['business_key'],'extra':{'reference_1':label['reference']}}} for label in plan['labels']]}
  if not self.transition(job_id,'PREPARED','CREATE_SENT'):return self.get(job_id)
  try:remote=self.provider.request('POST','/batches/',payload)
  except Exception:return self.get(job_id) # No duplicate create, even after restart.
  remote_id=remote.get('object_id')
  if not isinstance(remote_id,str) or not re.fullmatch(r'[a-f0-9]{32}',remote_id):return self.get(job_id)
  self.transition(job_id,'CREATE_SENT','CREATED',receipt=remote,remote_id=remote_id)
  return self.get(job_id)
 def observe(self,job_id):
  job=self.get(job_id)
  # A durable verified receipt is historical evidence, not a fresh provider poll.
  # Never downgrade it or discard its PDF/proof from a later async batch view.
  if job['state'] in ('TRANSACTIONS_VERIFIED','ARTIFACTS_VERIFIED'):return job
  if not job['remote_id']:return job
  remote=self.provider.request('GET','/batches/'+job['remote_id']+'/')
  if remote.get('object_id')!=job['remote_id'] or remote.get('metadata')!=job_id:raise ValueError('REMOTE_BATCH_IDENTITY_MISMATCH')
  rows=(remote.get('batch_shipments') or {}).get('results',[])
  # Never accept a paginated subset or an incomplete async result as all labels.
  complete=not (remote.get('batch_shipments') or {}).get('next') and len(rows)==len(job['plan']['labels'])
  by_key={row.get('metadata'):row for row in rows}
  expected={row['business_key'] for row in job['plan']['labels']}
  exact=complete and set(by_key)==expected and len(by_key)==len(rows)
  if exact and any(row.get('servicelevel_token') not in (None,'','ups_ground') for row in rows):raise ValueError('REMOTE_BATCH_SERVICE_MISMATCH')
  remote['_local_identity_complete']=exact
  remote['_local_transaction_ids']=[row.get('transaction') for row in rows if row.get('transaction')]
  state=job['state']
  # Observations may advance state but can never reopen a purchase send boundary.
  if state=='CREATED' and remote.get('status')=='VALID' and exact:state='VALIDATED'
  if state in ('PURCHASE_SENT','PURCHASING','PARTIAL','PURCHASE_RETURNED','TRANSACTIONS_VERIFIED','ARTIFACTS_VERIFIED'):
   state='PURCHASING'
   counts=remote.get('object_results') or {}
   if exact and counts.get('purchase_succeeded')==len(expected) and len(remote['_local_transaction_ids'])==len(expected):state='PURCHASE_RETURNED'
   elif counts.get('purchase_failed',0)>0:state='PARTIAL'
  with self.db() as db:db.execute('UPDATE zen_shipping_jobs SET state=?,receipt=?,updated=? WHERE id=? AND state=?',
    (state,json.dumps(remote),time.time(),job_id,job['state']))
  return self.get(job_id)
 def purchase(self,job_id,expected_plan_sha):
  job=self.get(job_id)
  if job['plan_sha']!=expected_plan_sha:raise ValueError('PURCHASE_PLAN_CHANGED')
  if job['state'] in ('TRANSACTIONS_VERIFIED','ARTIFACTS_VERIFIED'):return job
  if job['state']!='VALIDATED':return self.observe(job_id)
  # Authorization belongs to the service caller; this method must only run for
  # an explicitly authorized business action, never as a status/read endpoint.
  if not self.transition(job_id,'VALIDATED','PURCHASE_SENT'):return self.get(job_id)
  try:self.provider.request('POST','/batches/'+job['remote_id']+'/purchase/',{})
  except Exception:return self.get(job_id)
  return self.observe(job_id)
 def verify_transactions(self,job_id):
  from decimal import Decimal
  job=self.observe(job_id)
  if job['state'] not in ('PURCHASE_RETURNED','TRANSACTIONS_VERIFIED','ARTIFACTS_VERIFIED'):return job
  remote=job['receipt'] or {};rows=(remote.get('batch_shipments') or {}).get('results',[])
  expected={label['business_key']:label for label in job['plan']['labels']}
  if not remote.get('_local_identity_complete'):raise ValueError('BATCH_IDENTITY_INCOMPLETE')
  transactions=[];ids=set();total=Decimal('0')
  def identifier(value):
   value=value.get('object_id') if isinstance(value,dict) else value
   if not isinstance(value,str) or not re.fullmatch(r'[a-f0-9]{32}',value):raise ValueError('PROVIDER_OBJECT_ID_INVALID')
   return value
  def address_matches(actual,wanted):
   def normalize(value):return ' '.join(str(value or '').casefold().split())
   for key in ('name','company','street1','street2','city','state','country'):
    if normalize(actual.get(key))!=normalize(wanted.get(key)):return False
   return str(actual.get('zip','')).replace('-','')[:5]==str(wanted.get('zip','')).replace('-','')[:5]
  for row in rows:
   label=expected[row['metadata']];transaction_id=identifier(row['transaction']);shipment_id=identifier(row['shipment'])
   if transaction_id in ids:raise ValueError('DUPLICATE_TRANSACTION_IN_BATCH')
   ids.add(transaction_id)
   transaction=self.provider.request('GET','/transactions/'+transaction_id+'/')
   if transaction.get('object_id')!=transaction_id or transaction.get('status')!='SUCCESS':raise ValueError('TRANSACTION_NOT_SUCCESSFUL')
   if not re.fullmatch(r'1Z[A-Z0-9]{16}',str(transaction.get('tracking_number') or '')) or not transaction.get('label_url'):raise ValueError('LABEL_OR_TRACKING_MISSING')
   rate_id=identifier(transaction.get('rate'));rate=self.provider.request('GET','/rates/'+rate_id+'/')
   if rate.get('object_id')!=rate_id or identifier(rate.get('shipment'))!=shipment_id:raise ValueError('TRANSACTION_RATE_SHIPMENT_MISMATCH')
   if str(rate.get('provider','')).casefold()!='ups' or (rate.get('servicelevel') or {}).get('token')!='ups_ground' or rate.get('currency')!='USD':raise ValueError('PURCHASED_SERVICE_MISMATCH')
   amount=Decimal(str(rate.get('amount')))
   if not amount.is_finite() or amount<0:raise ValueError('PURCHASE_AMOUNT_INVALID')
   shipment=self.provider.request('GET','/shipments/'+shipment_id+'/')
   if shipment.get('object_id')!=shipment_id or shipment.get('metadata')!=label['business_key']:raise ValueError('SHIPMENT_BOX_MISMATCH')
   if not address_matches(shipment.get('address_from') or {},job['plan']['origin']) or not address_matches(shipment.get('address_to') or {},label['address_to']):raise ValueError('PURCHASE_ADDRESS_MISMATCH')
   parcels=shipment.get('parcels') or []
   if len(parcels)!=1:raise ValueError('PURCHASE_PARCEL_COUNT_MISMATCH')
   for field in ('length','width','height','weight'):
    if Decimal(str(parcels[0].get(field)))!=Decimal(str(label['parcel'][field])):raise ValueError('PURCHASE_PARCEL_MISMATCH')
   if parcels[0].get('mass_unit')!='lb' or parcels[0].get('distance_unit')!='in':raise ValueError('PURCHASE_UNIT_MISMATCH')
   total+=amount
   transactions.append({'box_id':label['box_id'],'business_key':label['business_key'],'transaction_id':transaction_id,
    'shipment_id':shipment_id,'tracking_number':transaction['tracking_number'],'label_url':transaction['label_url'],'amount':str(amount),'currency':'USD'})
  if len(transactions)!=len(expected):raise ValueError('TRANSACTION_COUNT_MISMATCH')
  remote['_verified_transactions']=transactions;remote['_verified_total_usd']=str(total)
  with self.db() as db:db.execute('UPDATE zen_shipping_jobs SET state=?,receipt=?,updated=? WHERE id=? AND state=?',
   ('TRANSACTIONS_VERIFIED' if job['state']!='ARTIFACTS_VERIFIED' else 'ARTIFACTS_VERIFIED',json.dumps(remote),time.time(),job_id,job['state']))
  return self.get(job_id)
