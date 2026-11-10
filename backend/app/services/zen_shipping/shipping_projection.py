"""Project verified cargo tracking into ERP atomically; never buy or overwrite labels."""
import re

def project_cargo_tracking(service,job):
 if job['plan'].get('kind','cargo')!='cargo':return {'applicable':False}
 if job['state']!='ARTIFACTS_VERIFIED':raise ValueError('VERIFIED_LABEL_ARTIFACT_REQUIRED')
 plan=job['plan'];labels=plan['labels'];rows=(job.get('receipt') or {}).get('_verified_transactions') or []
 wanted={label['box_id']:label for label in labels};proof={row['box_id']:row for row in rows}
 if len(wanted)!=len(labels) or len(proof)!=len(rows) or set(wanted)!=set(proof):raise ValueError('TRACKING_PROJECTION_IDENTITY_MISMATCH')
 tracking=[row.get('tracking_number') for row in rows]
 if len(set(tracking))!=len(tracking) or any(not re.fullmatch(r'1Z[A-Z0-9]{16}',str(value or '')) for value in tracking):raise ValueError('TRACKING_PROJECTION_INVALID')
 with service.db() as db:
  db.execute('BEGIN IMMEDIATE')
  batch=db.execute('SELECT batch_code FROM cargo_batches WHERE id=?',(plan['batch_id'],)).fetchone()
  if not batch or batch['batch_code']!=plan['batch_code']:raise ValueError('ERP_BATCH_IDENTITY_CHANGED')
  actual=db.execute('SELECT id,box_code,tracking_number FROM cargo_boxes WHERE batch_id=?',(plan['batch_id'],)).fetchall()
  if {row['id'] for row in actual}!=set(wanted):raise ValueError('ERP_BOX_SET_CHANGED')
  for row in actual:
   label=wanted[row['id']];receipt=proof[row['id']]
   if row['box_code']!=label['box_code'] or receipt['business_key']!=label['business_key']:raise ValueError('ERP_BOX_IDENTITY_CHANGED')
   if row['tracking_number'] and row['tracking_number']!=receipt['tracking_number']:raise ValueError('ERP_TRACKING_CONFLICT_NO_OVERWRITE')
  for row in actual:
   db.execute('UPDATE cargo_boxes SET tracking_number=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (tracking_number IS NULL OR tracking_number=\'\')',(proof[row['id']]['tracking_number'],row['id']))
  return {'applicable':True,'state':'VERIFIED','verified_box_count':len(actual),'batch_id':plan['batch_id']}


def cargo_tracking_status(service,job):
 """Read-only projection check: artifacts can exist while ERP still needs repair."""
 if job['plan'].get('kind','cargo')!='cargo':return {'applicable':False}
 if job['state']!='ARTIFACTS_VERIFIED':return {'applicable':True,'state':'PENDING'}
 plan=job['plan'];wanted={r['box_id']:r for r in plan['labels']}
 proof={r['box_id']:r for r in (job.get('receipt') or {}).get('_verified_transactions',[])}
 with service.db() as db:
  batch=db.execute('SELECT batch_code FROM cargo_batches WHERE id=?',(plan['batch_id'],)).fetchone()
  rows=db.execute('SELECT id,box_code,tracking_number FROM cargo_boxes WHERE batch_id=?',(plan['batch_id'],)).fetchall()
 if not batch or batch['batch_code']!=plan['batch_code'] or set(wanted)!=set(proof) or {r['id'] for r in rows}!=set(wanted):return {'applicable':True,'state':'CONFLICT','error':'ERP_IDENTITY_CHANGED'}
 pending=False
 for row in rows:
  expected=proof[row['id']].get('tracking_number')
  if row['box_code']!=wanted[row['id']]['box_code'] or not expected or (row['tracking_number'] and row['tracking_number']!=expected):return {'applicable':True,'state':'CONFLICT','error':'ERP_TRACKING_CONFLICT_NO_OVERWRITE'}
  pending=pending or not row['tracking_number']
 return {'applicable':True,'state':'PENDING' if pending else 'VERIFIED','verified_box_count':0 if pending else len(rows)}
