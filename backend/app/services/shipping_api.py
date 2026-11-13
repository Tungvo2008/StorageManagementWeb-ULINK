"""Private shipping service. Business state belongs here, never in a model loop."""
import io,json,sqlite3,time
from decimal import Decimal
from pathlib import Path
from fastapi import APIRouter,Depends,HTTPException
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel,ConfigDict,Field
from sqlalchemy import select
from sqlalchemy.orm import Session,joinedload
from app.api.deps import get_db,get_current_user
from app.core.config import settings
from app.db.models import CargoBatch,CargoBox
from app.api.v1.trust_cargo import export_shipping_labels,ExportShippingLabelsRequest
from app.services.zen_shipping.shippo_provider import Shippo
from app.services.zen_shipping.shippo_batch import ShippoBatch
from app.services.zen_shipping.shipping_plan import prepare_batch,labels_from_export
from app.services.zen_shipping.shipping_legacy import check_legacy

ORIGIN_FILE=Path(__file__).parent/'zen_shipping/origin.json'
ARTIFACT_DIR=Path('/app/exports/zen-shipping')
router=APIRouter(prefix='/zen-shipping',tags=['private-shipping'])
class Parcel(BaseModel):
 model_config=ConfigDict(extra='forbid')
 weight_lbs:float=Field(gt=0,le=150,allow_inf_nan=False)
 length_in:float=Field(gt=0,le=108,allow_inf_nan=False)
 width_in:float=Field(gt=0,le=108,allow_inf_nan=False)
 height_in:float=Field(gt=0,le=108,allow_inf_nan=False)
class Prepare(BaseModel):
 model_config=ConfigDict(extra='forbid')
 batch_id:int=Field(gt=0)
 expected_box_count:int=Field(gt=0,le=100)
 measurements:dict[str,Parcel]
class Create(BaseModel):
 model_config=ConfigDict(extra='forbid')
 carrier_account:str|None=Field(default=None,pattern=r'^[a-f0-9]{32}$')
class Purchase(BaseModel):
 model_config=ConfigDict(extra='forbid')
 plan_sha256:str=Field(pattern=r'^[a-f0-9]{64}$')
 max_total_usd:float=Field(gt=0,allow_inf_nan=False)

def engine(db):
 token=getattr(settings,'SHIPPO_API_TOKEN','')
 if not token:raise HTTPException(503,'SHIPPO_NOT_CONFIGURED')
 if not ORIGIN_FILE.is_file():raise HTTPException(503,'SHIPPING_ORIGIN_NOT_CONFIGURED')
 origin_config=json.loads(ORIGIN_FILE.read_text())
 origin=origin_config.get('origin',origin_config)
 provider=Shippo('',origin,key_provider=lambda:token)
 from app.services.zen_shipping.shippo_rate_group import RateGroup
 return RateGroup(Path(db.get_bind().url.database).resolve(),provider)
def summary(job):
 receipt=job.get('receipt') or {}
 return {'job_id':job['id'],'state':job['state'],'plan_sha256':job['plan_sha'],'batch_id':job['plan']['batch_id'],
  'box_count':len(job['plan']['labels']),'provider_batch_id':job['remote_id'],
  'purchase_mode':receipt.get('_purchase_mode','legacy_instalabel'),'transaction_errors':[{'business_key':row.get('metadata'),'transaction_id':row.get('transaction'),'messages':row.get('messages',[])} for row in (receipt.get('batch_shipments')or{}).get('results',[]) if row.get('status') in ('ERROR','TRANSACTION_FAILED')],
  'transactions':receipt.get('_verified_transactions',[]),'verified_total_usd':receipt.get('_verified_total_usd'),
  'artifact':receipt.get('_artifact'),'automatic_retry_allowed':False,
  'detail':'PURCHASE_RETURNED means provider count only; completion needs transaction and file verification.'}
def safe(function):
 try:return function()
 except HTTPException:raise
 except (ValueError,KeyError,sqlite3.Error) as exc:raise HTTPException(409,{'code':str(exc)[:160] if isinstance(exc,ValueError) else type(exc).__name__}) from None

@router.get('/contract')
def contract():return {'version':1,'provider':'shippo','native_batch':False,'grouped_job':True,'purchase_mode':'rate_transactions','durable_purchase_intent':True,'service':'ups_ground','label_filetype':'PDF_4x6'}

async def current_cargo_plan(request:Prepare,db:Session,user,origin):
 batch=db.scalar(select(CargoBatch).options(joinedload(CargoBatch.boxes).joinedload(CargoBox.bills),joinedload(CargoBatch.bills)).where(CargoBatch.id==request.batch_id))
 if not batch or len(batch.boxes)!=request.expected_box_count:raise HTTPException(409,'EXACT_BATCH_BOX_COUNT_REQUIRED')
 # The ERP source must not already point to labels from any provider.
 if any(box.tracking_number for box in batch.boxes):raise HTTPException(409,'EXISTING_LABELS_REQUIRE_RECONCILIATION')
 # Owner-mandated fixed purchase preset; ERP weight remains business data.
 measurements={str(box.id):{'weight_lbs':8,'length_in':10,'width_in':8,'height_in':6} for box in batch.boxes}
 # Reuse the production exporter's receiver, company and reference formatting.
 exported=export_shipping_labels(ExportShippingLabelsRequest(batch_id=batch.id,box_count=request.expected_box_count,weight_lbs=8,format='xlsx'),db=db,user=user)
 content=bytearray()
 async for chunk in exported.body_iterator:
  content.extend(chunk)
  if len(content)>10*1024*1024:raise HTTPException(409,'EXPORT_SIZE_LIMIT')
 snapshot={'id':batch.id,'batch_code':batch.batch_code,'boxes':[{'id':box.id,'box_code':box.box_code} for box in batch.boxes],
           'unassigned_bills':[bill.id for bill in batch.bills if bill.box_id is None]}
 plan=safe(lambda:prepare_batch(snapshot,labels_from_export(bytes(content)),measurements,origin))
 return plan

@router.post('/jobs')
async def prepare(request:Prepare,db:Session=Depends(get_db),user=Depends(get_current_user)):
 service=engine(db)
 plan=await current_cargo_plan(request,db,user,service.provider.origin)
 safe(lambda:check_legacy(plan,json.loads(ORIGIN_FILE.read_text())))
 job_id=safe(lambda:service.prepare(plan))
 return summary(service.get(job_id))

@router.post('/jobs/{job_id}/create')
def create(job_id:str,request:Create,db:Session=Depends(get_db)):
 service=engine(db)
 carrier=request.carrier_account
 if not carrier:
  if not ORIGIN_FILE.is_file():raise HTTPException(503,'DEFAULT_UPS_ACCOUNT_NOT_CONFIGURED')
  carrier=json.loads(ORIGIN_FILE.read_text()).get('carrier_account')
  import re
  if not isinstance(carrier,str) or not re.fullmatch(r'[a-f0-9]{32}',carrier):raise HTTPException(503,'DEFAULT_UPS_ACCOUNT_NOT_CONFIGURED')
 account=service.provider.request('GET','/carrier_accounts/'+carrier+'/')
 if account.get('carrier')!='ups' or account.get('active') is not True:raise HTTPException(409,'ACTIVE_UPS_ACCOUNT_REQUIRED')
 return safe(lambda:summary(service.create(job_id,carrier)))

@router.get('/jobs/{job_id}')
def status(job_id:str,db:Session=Depends(get_db)):
 service=engine(db)
 job=safe(lambda:service.get(job_id))
 job=job if job['state']=='ARTIFACTS_VERIFIED' else safe(lambda:service.observe(job_id))
 from app.services.zen_shipping.shipping_projection import cargo_tracking_status
 return {**summary(job),'erp_tracking':safe(lambda:cargo_tracking_status(service,job))}

@router.post('/jobs/{job_id}/purchase')
async def purchase(job_id:str,request:Purchase,db:Session=Depends(get_db),user=Depends(get_current_user)):
 if not ORIGIN_FILE.is_file() or json.loads(ORIGIN_FILE.read_text()).get('purchases_enabled') is not True:raise HTTPException(409,'SHIPPING_PURCHASE_ACTIVATION_PENDING')
 service=engine(db);job=safe(lambda:service.get(job_id))
 if job['plan_sha']!=request.plan_sha256:raise HTTPException(409,'PLAN_CHANGED')
 safe(lambda:check_legacy(job['plan'],json.loads(ORIGIN_FILE.read_text())))
 if job['state'] in ('TRANSACTIONS_VERIFIED','ARTIFACTS_VERIFIED'):return summary(job)
 if job['state']!='VALIDATED':return await run_in_threadpool(lambda:safe(lambda:summary(service.observe(job_id))))
 if job['plan'].get('kind')=='fbm':
  from app.services.zen_shipping.shipping_fbm_plan import prepare_fbm
  config=json.loads(ORIGIN_FILE.read_text());plan=job['plan']
  fresh=await run_in_threadpool(lambda:safe(lambda:prepare_fbm(plan['batch_id'],plan['labels'][0]['address_to'],lookup_amazon_order(plan['batch_id'],config),plan['origin'],config['legacy_guard']['captured_at'])))
  if fresh['plan_sha256']!=job['plan_sha']:raise HTTPException(409,'AMAZON_ORDER_CHANGED')
 else:
  labels=job['plan']['labels']
  if any(any(Decimal(str(label['parcel'].get(k,0)))!=v for k,v in {'weight':8,'length':10,'width':8,'height':6}.items()) for label in labels):raise HTTPException(409,'FIXED_PARCEL_REQUIRED_10X8X6_8LB')
  measurements={str(label['box_id']):{'weight_lbs':label['parcel']['weight'],'length_in':label['parcel']['length'],'width_in':label['parcel']['width'],'height_in':label['parcel']['height']} for label in labels}
  fresh_request=Prepare(batch_id=job['plan']['batch_id'],expected_box_count=len(labels),measurements=measurements)
  fresh=await current_cargo_plan(fresh_request,db,user,service.provider.origin)
  if fresh['plan_sha256']!=job['plan_sha']:raise HTTPException(409,'CARGO_SOURCE_CHANGED_REVIEW_ORIGINAL_JOB')
 total=await run_in_threadpool(quote_total,service,job)
 if total>Decimal(str(request.max_total_usd)):raise HTTPException(409,'TOTAL_EXCEEDS_AUTHORIZED_LIMIT')
 return await run_in_threadpool(lambda:safe(lambda:summary(service.purchase(job_id,request.plan_sha256))))

@router.post('/jobs/{job_id}/verify')
def verify(job_id:str,db:Session=Depends(get_db)):
 service=engine(db);job=safe(lambda:service.get(job_id))
 if job['state']!='ARTIFACTS_VERIFIED':job=safe(lambda:service.verify_transactions(job_id))
 if job['state']=='ARTIFACTS_VERIFIED':
  from app.services.zen_shipping.shipping_projection import project_cargo_tracking
  return {**summary(job),'erp_tracking':safe(lambda:project_cargo_tracking(service,job))}
 if job['state']!='TRANSACTIONS_VERIFIED':return summary(job)
 from app.services.zen_shipping.shipping_artifacts import merge_labels
 artifact=safe(lambda:merge_labels(job,ARTIFACT_DIR))
 receipt={**job['receipt'],'_artifact':artifact}
 service.transition(job_id,'TRANSACTIONS_VERIFIED','ARTIFACTS_VERIFIED',receipt=receipt)
 job=service.get(job_id)
 from app.services.zen_shipping.shipping_projection import project_cargo_tracking
 return {**summary(job),'erp_tracking':safe(lambda:project_cargo_tracking(service,job))}

@router.get('/jobs/{job_id}/label.pdf')
def label(job_id:str,db:Session=Depends(get_db)):
 service=engine(db);job=safe(lambda:service.get(job_id))
 artifact=(job.get('receipt') or {}).get('_artifact') or {}
 path=Path((artifact.get('artifact') or {}).get('path') or '')
 if job['state']!='ARTIFACTS_VERIFIED' or not path.is_file() or path.resolve().parent!=ARTIFACT_DIR.resolve():raise HTTPException(409,'VERIFIED_LABEL_FILE_UNAVAILABLE')
 import hashlib
 if hashlib.sha256(path.read_bytes()).hexdigest()!=artifact.get('sha256'):raise HTTPException(409,'LABEL_FILE_CHANGED')
 return FileResponse(path,media_type='application/pdf',filename='labels-'+job['plan']['batch_code']+'.pdf')

def quote_total(service,job):
 # Read the selected carrier rate for every original shipment.
 total=Decimal('0');remote=job['receipt'];rows=remote['batch_shipments']['results']
 if remote.get('_purchase_mode')=='rates_v1':
  for row in rows:
   rate=service.provider.request('GET','/rates/'+row['rate']+'/')
   if rate.get('object_id')!=row['rate'] or rate.get('carrier_account')!=row['carrier_account'] or str(rate.get('provider','')).casefold()!='ups' or (rate.get('servicelevel')or{}).get('token')!='ups_ground' or rate.get('currency')!='USD':raise HTTPException(409,'RATE_IDENTITY_MISMATCH')
   amount=Decimal(str(rate['amount']))
   if not amount.is_finite() or amount<0:raise HTTPException(409,'INVALID_RATE')
   total+=amount
  return total

 for row in rows:
  shipment=service.provider.request('GET','/shipments/'+row['shipment']+'/')
  rates=[rate for rate in shipment.get('rates',[]) if rate.get('carrier_account')==(row.get('carrier_account') or remote.get('default_carrier_account'))
         and str(rate.get('provider','')).casefold()=='ups' and (rate.get('servicelevel') or {}).get('token')=='ups_ground' and rate.get('currency')=='USD']
  if not rates:
   # Shippo batch-created shipments may omit rate objects. Obtain an unpaid
   # rate preview for the exact frozen label and configured carrier account.
   label=next((label for label in job['plan']['labels'] if label['business_key']==row.get('metadata')),None)
   if not label:raise HTTPException(409,'QUOTE_LABEL_IDENTITY_MISMATCH')
   carrier=row.get('carrier_account') or remote.get('default_carrier_account')
   preview=service.provider.request('POST','/shipments/',{'address_from':job['plan']['origin'],'address_to':label['address_to'],'parcels':[label['parcel']],'carrier_accounts':[carrier],'async':False,'metadata':'quote:'+job['id']+':'+str(label['box_id'])})
   rates=[rate for rate in preview.get('rates',[]) if rate.get('carrier_account')==carrier and str(rate.get('provider','')).casefold()=='ups' and (rate.get('servicelevel') or {}).get('token')=='ups_ground' and rate.get('currency')=='USD']
  if not rates:raise HTTPException(409,'UPS_GROUND_RATE_UNAVAILABLE')
  amount=min(Decimal(str(rate['amount'])) for rate in rates)
  if not amount.is_finite() or amount<0:raise HTTPException(409,'INVALID_RATE')
  total+=amount
 return total

@router.get('/batches/{batch_id}/job')
def by_batch(batch_id:int,db:Session=Depends(get_db)):
 service=engine(db)
 with service.db() as connection:row=connection.execute('SELECT id FROM zen_shipping_jobs WHERE batch_key=?',('cargo:'+str(batch_id),)).fetchone()
 if not row:raise HTTPException(404,'SHIPPING_JOB_NOT_FOUND')
 return summary(service.get(row['id']))

@router.get('/jobs/{job_id}/quote')
def quote(job_id:str,db:Session=Depends(get_db)):
 service=engine(db);job=safe(lambda:service.observe(job_id))
 if job['state']!='VALIDATED':raise HTTPException(409,'BATCH_NOT_READY_FOR_QUOTE')
 total=safe(lambda:quote_total(service,job))
 return {**summary(job),'quoted_total_usd':str(total),'quoted_at_unix':time.time(),'purchase_performed':False}


class FbmPrepare(BaseModel):
 model_config=ConfigDict(extra='forbid')
 order_id:str=Field(pattern=r'^[0-9]{3}-[0-9]{7}-[0-9]{7}$')
 address:dict[str,str]

@router.post('/fbm/jobs')
def prepare_fbm_job(request:FbmPrepare,db:Session=Depends(get_db)):
 from app.services.zen_shipping.shipping_fbm_plan import prepare_fbm
 config=json.loads(ORIGIN_FILE.read_text())
 order=lookup_amazon_order(request.order_id,config)
 service=engine(db)
 plan=safe(lambda:prepare_fbm(request.order_id,request.address,order,service.provider.origin,(config.get('legacy_guard') or {}).get('captured_at')))
 safe(lambda:check_legacy(plan,config))
 return summary(service.get(safe(lambda:service.prepare(plan))))

@router.get('/orders/{order_id}/job')
def fbm_job(order_id:str,db:Session=Depends(get_db)):
 import re
 if not re.fullmatch(r'[0-9]{3}-[0-9]{7}-[0-9]{7}',order_id):raise HTTPException(400,'EXACT_ORDER_ID_REQUIRED')
 service=engine(db)
 with service.db() as connection:row=connection.execute('SELECT id FROM zen_shipping_jobs WHERE batch_key=?',('fbm:'+order_id,)).fetchone()
 if not row:raise HTTPException(404,'SHIPPING_JOB_NOT_FOUND')
 return summary(service.get(row['id']))


def lookup_amazon_order(order_id,config):
 import urllib.request
 keyfile=Path(config.get('amazon_order_key_file') or '')
 if not keyfile.is_file():raise HTTPException(503,'AMAZON_ORDER_AUTH_NOT_CONFIGURED')
 remote=urllib.request.Request('http://amazon-shipping-amazon-shipping-1:5688/orders/'+order_id,headers={'Authorization':'Bearer '+keyfile.read_text().strip()})
 try:
  with urllib.request.urlopen(remote,timeout=12) as response:raw=response.read(1024*1024+1)
  if len(raw)>1024*1024:raise ValueError()
  return json.loads(raw)
 except Exception:raise HTTPException(409,'AMAZON_ORDER_LOOKUP_UNVERIFIED') from None


def legacy_cargo_receipt(batch_id):
 manifest=ARTIFACT_DIR/'legacy-cargo.json'
 if not manifest.is_file():raise HTTPException(404,'LEGACY_RECEIPT_NOT_ARCHIVED')
 row=(json.loads(manifest.read_text()).get('batches') or {}).get(str(batch_id))
 if not row:raise HTTPException(404,'LEGACY_RECEIPT_NOT_ARCHIVED')
 # This is retained evidence, not a fresh assertion about payment/refund state.
 return {**row,'provider':'pirateship','purchase_performed':False,'payment_verified':False,'automatic_retry_allowed':False}

def legacy_cargo_file(batch_id):
 import re,hashlib
 row=legacy_cargo_receipt(batch_id);digest=row.get('sha256','')
 if not re.fullmatch(r'[a-f0-9]{64}',digest):raise HTTPException(409,'LEGACY_ARTIFACT_PROOF_INVALID')
 path=ARTIFACT_DIR/'legacy'/(digest+'.pdf')
 if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise HTTPException(409,'LEGACY_ARTIFACT_MISSING_OR_CHANGED')
 return row,path

@router.get('/legacy/cargo/{batch_id}')
def legacy_cargo(batch_id:int):
 row,path=legacy_cargo_file(batch_id)
 return row

@router.get('/legacy/cargo/{batch_id}/label.pdf')
def legacy_cargo_pdf(batch_id:int):
 row,path=legacy_cargo_file(batch_id)
 return FileResponse(path,media_type='application/pdf',filename='pirateship-cargo-'+str(batch_id)+'.pdf')
