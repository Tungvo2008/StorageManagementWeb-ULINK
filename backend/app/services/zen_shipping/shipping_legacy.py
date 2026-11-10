"""Provider migration boundary. Missing tracking never proves no previous purchase."""
import json
from pathlib import Path

def check_legacy(plan,config):
 guard=config.get('legacy_guard')
 if not isinstance(guard,dict) or guard.get('version')!=1:
  raise ValueError('LEGACY_LABEL_RECONCILIATION_NOT_CONFIGURED')
 if plan.get('kind')=='fbm':
  from datetime import datetime,timezone
  def date(v):
   try:d=datetime.fromisoformat(str(v).replace('Z','+00:00'))
   except (ValueError,TypeError):raise ValueError('FBM_MIGRATION_DATE_REQUIRED') from None
   return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)
  if date(plan.get('order_purchase_date'))<=date(guard.get('captured_at')):raise ValueError('LEGACY_FBM_ORDER_REQUIRES_ORIGINAL_LABEL_RECONCILIATION')
  return
 if plan.get('kind','cargo')!='cargo':raise ValueError('SHIPPING_KIND_NOT_REVIEWED')
 batch_id=plan.get('batch_id')
 if not isinstance(batch_id,int) or isinstance(batch_id,bool):raise ValueError('EXACT_CARGO_ID_REQUIRED')
 cutoff=guard.get('cargo_id_high_watermark')
 if not isinstance(cutoff,int):raise ValueError('LEGACY_LABEL_CUTOFF_INVALID')
 if batch_id>cutoff:return
 decision=(guard.get('cargo_decisions') or {}).get(str(batch_id)) or {}
 if decision.get('state')!='VERIFIED_NO_PURCHASE':
  raise ValueError('LEGACY_LABELS_REQUIRE_ORIGINAL_RECEIPT_RECONCILIATION')
 # A decision applies to one exact frozen plan, never a blanket old-batch bypass.
 if decision.get('plan_sha256')!=plan.get('plan_sha256') or not decision.get('evidence_sha256'):
  raise ValueError('LEGACY_RECONCILIATION_PLAN_MISMATCH')
