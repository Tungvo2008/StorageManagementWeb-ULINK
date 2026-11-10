"""Optional private idempotency receipts committed with the existing business row.
Existing web/API requests without X-Zen-Operation-Id keep their normal contract.
"""
import hashlib,json,re
from datetime import datetime,timezone
from fastapi import APIRouter,Depends,HTTPException,Request
from sqlalchemy import Column,Integer,String,DateTime,UniqueConstraint,select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session
from app.db.base import Base
from app.api.deps import get_db,get_current_user
from pydantic import BaseModel,ConfigDict,ValidationError
from typing import Literal,Any

class ZenOperation(Base):
    __tablename__='zen_operation_receipts'
    id=Column(Integer,primary_key=True)
    scope=Column(String(64),nullable=False)
    operation_id=Column(String(64),nullable=False)
    resource=Column(String(32),nullable=False)
    payload_hash=Column(String(64),nullable=False)
    resource_id=Column(Integer,nullable=True)
    created_at=Column(DateTime(timezone=True),nullable=False,default=lambda:datetime.now(timezone.utc))
    __table_args__=(UniqueConstraint('scope','operation_id',name='uq_zen_scope_operation'),)


def operation_identity(request):
    key=request.headers.get('x-zen-operation-id')
    if key is None:return None
    if not re.fullmatch(r'op_[a-f0-9]{48}',key):raise HTTPException(400,'INVALID_ZEN_OPERATION_ID')
    authorization=request.headers.get('authorization','')
    api_key=request.headers.get('x-api-key','')
    bot_key=request.headers.get('x-bot-key','')
    if not authorization and not api_key and not bot_key:raise HTTPException(403,'ZEN_AUTH_SCOPE_REQUIRED')
    # Credentials are never written to the ledger or response.
    scope=hashlib.sha256(json.dumps([authorization,api_key,bot_key],separators=(',',':')).encode()).hexdigest()
    return scope,key


def reserve(request,db,resource,payload):
    identity=operation_identity(request)
    if identity is None:return None
    scope,key=identity
    encoded=payload.model_dump(mode='json') if hasattr(payload,'model_dump') else payload
    fingerprint=hashlib.sha256(json.dumps(encoded,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    # This first DML obtains SQLite's writer lock. Reservation and domain changes
    # either commit together or roll back together, including process failure.
    db.execute(insert(ZenOperation).values(scope=scope,operation_id=key,resource=resource,payload_hash=fingerprint)
        .on_conflict_do_nothing(index_elements=['scope','operation_id']))
    receipt=db.scalar(select(ZenOperation).where(ZenOperation.scope==scope,ZenOperation.operation_id==key))
    if receipt.resource!=resource or receipt.payload_hash!=fingerprint:
        raise HTTPException(409,'ZEN_OPERATION_IDENTITY_CONFLICT')
    if receipt.resource_id is not None:return receipt.resource_id
    db.info['zen_operation_ticket']=receipt
    return None


def complete(db,resource,resource_id):
    receipt=db.info.pop('zen_operation_ticket',None)
    if receipt is None:return
    if receipt.resource!=resource or not isinstance(resource_id,int) or isinstance(resource_id,bool) or resource_id<=0:
        raise RuntimeError('ZEN_RECEIPT_RESOURCE_MISMATCH')
    receipt.resource_id=resource_id
    db.flush()


def replay(db,model,resource_id):
    row=db.get(model,resource_id)
    if row is None:raise HTTPException(410,'ZEN_OPERATION_RESOURCE_REMOVED_NO_REPLAY')
    return row

router=APIRouter(prefix='/zen-operations',tags=['internal-operation-receipts'])

@router.get('/contract')
def contract():
    return {'version':1,'durable_atomic_receipts':True,
        'resources':['customer','inventory_receipt','inventory_issue','invoice'],
        'header':'X-Zen-Operation-Id'}

@router.get('/{operation_id}')
def status(operation_id:str,request:Request,db:Session=Depends(get_db)):
    if request.headers.get('x-zen-operation-id')!=operation_id:raise HTTPException(400,'ZEN_OPERATION_ID_REQUIRED')
    identity=operation_identity(request)
    if identity is None:raise HTTPException(403,'ZEN_AUTH_SCOPE_REQUIRED')
    scope,key=identity
    receipt=db.scalar(select(ZenOperation).where(ZenOperation.scope==scope,ZenOperation.operation_id==key))
    if receipt is None:raise HTTPException(404,'ZEN_OPERATION_NOT_FOUND')
    if receipt.resource_id is None:raise HTTPException(503,'ZEN_OPERATION_RECEIPT_NOT_COMMITTED')
    return {'operation_id':key,'resource':receipt.resource,'resource_id':receipt.resource_id,
        'payload_hash':receipt.payload_hash,'state':'COMMITTED'}

class ExecuteOperation(BaseModel):
    model_config=ConfigDict(extra='forbid')
    resource:Literal['customer','inventory_receipt','inventory_issue','invoice']
    payload:dict

def validate_payload(schema,payload):
    try:return schema.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(422,{'code':'INVALID_BUSINESS_PAYLOAD','fields':[list(error['loc']) for error in exc.errors()]}) from None

@router.post('/{operation_id}/execute',status_code=201)
def execute(operation_id:str,body:ExecuteOperation,request:Request,
            db:Session=Depends(get_db),current_user:Any=Depends(get_current_user)):
    # Versioned entry point: an old backend returns 404 without mutating anything,
    # rather than silently ignoring the idempotency header on a legacy route.
    if request.headers.get('x-zen-operation-id')!=operation_id:raise HTTPException(400,'ZEN_OPERATION_ID_REQUIRED')
    operation_identity(request)
    if body.resource=='customer':
        from app.api.v1.customers import create_customer
        from app.schemas.customer import CustomerCreate,CustomerRead
        row=create_customer(validate_payload(CustomerCreate,body.payload),request=request,db=db)
        return CustomerRead.model_validate(row).model_dump(mode='json')
    if body.resource in ('inventory_receipt','inventory_issue'):
        from app.api.v1.inventory import create_receipt,create_issue
        from app.schemas.inventory import InventoryReceiptCreate,InventoryIssueCreate,InventoryReceiptRead,InventoryIssueRead
        receipt=body.resource=='inventory_receipt'
        payload=validate_payload(InventoryReceiptCreate if receipt else InventoryIssueCreate,body.payload)
        row=(create_receipt if receipt else create_issue)(payload,request=request,db=db,current_user=current_user)
        return (InventoryReceiptRead if receipt else InventoryIssueRead).model_validate(row).model_dump(mode='json')
    from app.api.v1.invoices import create_manual_invoice
    from app.schemas.invoice import InvoiceManualCreate,InvoiceRead
    row=create_manual_invoice(validate_payload(InvoiceManualCreate,body.payload),request=request,db=db,current_user=current_user)
    return InvoiceRead.model_validate(row).model_dump(mode='json')
