"""Private business-data exploration: real SQLite read-only connection and authorizer.
No model-supplied filesystem path, PRAGMA, extension, schema write or auth-table read.
"""
import json,sqlite3,time
from contextlib import closing
from pathlib import Path
from fastapi import APIRouter,HTTPException
from pydantic import BaseModel,Field,ConfigDict

TABLES=frozenset('''products categories customers customer_product_prices product_images
invoices invoice_lines invoice_payments sale_orders sale_order_lines stock_movements
inventory_batches inventory_receipts inventory_receipt_lines inventory_issues inventory_issue_lines
cargo_batches cargo_bills cargo_boxes cargo_statements grocery_inbound_batches grocery_inbound_items
grocery_packaging_runs grocery_raw_materials grocery_raw_receipts grocery_repack_logs
amazon_box_capacities amazon_box_types amazon_product_mappings
showcase_items storefront_inquiries storefront_lead_events storefront_lead_states storefront_quotes
towel_web_content towel_web_media website_catalog_entries website_categories website_listing_media
website_listing_translations website_listings website_page_blocks'''.split())
FUNCTIONS=frozenset('''abs avg char coalesce concat concat_ws count date datetime dense_rank first_value floor
format glob group_concat hex ifnull iif instr json json_array json_array_length json_each json_extract
json_group_array json_group_object json_object json_quote json_type json_valid julianday lag last_value lead
length like likelihood likely lower ltrim max min nullif printf rank replace round row_number rtrim
sign strftime substr substring sum time timediff total trim typeof unicode unixepoch unlikely upper'''.split())
DB=Path('/app/storage.db')
class Query(BaseModel):
 model_config=ConfigDict(extra='forbid')
 sql:str=Field(min_length=1,max_length=20000)
 parameters:list[str|int|float|bool|None]=Field(default_factory=list,max_length=100)
 max_rows:int=Field(default=100,ge=1,le=200)

def connect(path):
 db=sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True,timeout=2)
 db.execute('PRAGMA query_only=ON');db.row_factory=sqlite3.Row
 return db

def schema(path):
 with closing(connect(path)) as db:
  available={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  result=[]
  for table in sorted(TABLES&available):
   result.append({'table':table,'columns':[{'name':r[1],'type':r[2],'required':bool(r[3]),'primary_key':bool(r[5])} for r in db.execute('PRAGMA table_info("'+table+'")')],
    'foreign_keys':[{'column':r[3],'table':r[2],'target_column':r[4]} for r in db.execute('PRAGMA foreign_key_list("'+table+'")') if r[2] in TABLES]})
 return {'read_only':True,'tables':result,'query_max_rows':200,'query_timeout_seconds':3}

def query(path,request):
 db=connect(path);deadline=time.monotonic()+3
 def authorize(action,arg1,arg2,database,trigger):
  if action==sqlite3.SQLITE_READ:return sqlite3.SQLITE_OK if database in ('main',None) and arg1 in TABLES else sqlite3.SQLITE_DENY
  if action==sqlite3.SQLITE_FUNCTION:return sqlite3.SQLITE_OK if str(arg2 or arg1).lower() in FUNCTIONS else sqlite3.SQLITE_DENY
  if action in (sqlite3.SQLITE_SELECT,sqlite3.SQLITE_RECURSIVE):return sqlite3.SQLITE_OK
  return sqlite3.SQLITE_DENY
 db.set_authorizer(authorize);db.set_progress_handler(lambda:time.monotonic()>deadline,1000)
 try:
  cursor=db.execute(request.sql,request.parameters)
  if cursor.description is None:raise ValueError('READ_QUERY_REQUIRED')
  rows=cursor.fetchmany(request.max_rows+1);columns=[d[0] for d in cursor.description]
  values=[list(row) for row in rows[:request.max_rows]]
  result={'read_completed':True,'columns':columns,'rows':values,'truncated':len(rows)>request.max_rows,'returned_rows':len(values),'observed_at_unix':time.time()}
  if len(json.dumps(result,ensure_ascii=False,allow_nan=False).encode())>1024*1024:raise ValueError('DATA_RESULT_TOO_LARGE_NARROW_QUERY')
  return result
 finally:db.close()

router=APIRouter(prefix='/zen-data',tags=['private-business-data'])
@router.get('/schema')
def get_schema():return schema(DB)
@router.post('/query')
def run_query(request:Query):
 try:return query(DB,request)
 except (sqlite3.Error,ValueError,TypeError) as exc:
  code='QUERY_TIMEOUT_OR_REJECTED' if isinstance(exc,sqlite3.OperationalError) and 'interrupted' in str(exc) else 'READ_QUERY_REJECTED'
  # Return actionable SQL schema errors, not SQL parameter values or credentials.
  detail=str(exc)[:200] if isinstance(exc,sqlite3.Error) else type(exc).__name__
  raise HTTPException(400,{'code':code,'detail':detail}) from None
