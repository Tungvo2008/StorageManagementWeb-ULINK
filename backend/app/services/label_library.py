"""Authenticated print library. Reads verified shipping jobs; never purchases labels."""
import hashlib, io, json, re, sqlite3, os, tempfile
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.api.deps import get_db
from app.services import zen_shipping  # load existing vendored PDF dependency
from pypdf import PdfReader

router = APIRouter(prefix='/zen-shipping/print-labels')
ROOT = Path('/app/exports/zen-shipping')
ARCHIVE = ROOT / 'print-library'

def archived():
    rows = []
    if ARCHIVE.exists():
        for p in ARCHIVE.glob('*.json'):
            try:
                d = json.loads(p.read_text())
                if re.fullmatch(r'[a-f0-9]{64}', d['id']) and (ARCHIVE / (d['id']+'.pdf')).is_file(): rows.append(d)
            except (ValueError, KeyError, OSError): continue
    return rows

def entries(db):
    rows = []
    with sqlite3.connect(str(db.get_bind().url.database)) as con:
        jobs = con.execute("SELECT id,plan,receipt,updated FROM zen_shipping_jobs WHERE state='ARTIFACTS_VERIFIED'").fetchall()
    for ident, raw, receipt, updated in jobs:
        plan, receipt = json.loads(raw), json.loads(receipt or '{}')
        artifact = receipt.get('_artifact') or {}
        path = Path((artifact.get('artifact') or {}).get('path') or '')
        if not path.is_file() or path.resolve().parent != ROOT.resolve(): continue
        labels = plan.get('labels', [])
        rows.append({'id': ident, 'kind': 'FBM' if plan.get('kind') else 'Trust Cargo', 'title': plan.get('batch_code', ident),
            'created_at': updated, 'pages': artifact.get('page_count'), 'tracking': [r['tracking_number'] for r in artifact.get('box_tracking_pages', [])],
            'recipients': [str(l.get('reference') or l.get('address_to', {}).get('name') or '') for l in labels], 'sha256': artifact.get('sha256'), '_path': str(path)})
    legacy = ROOT / 'legacy-cargo.json'
    if legacy.is_file():
        data=json.loads(legacy.read_text())
        for batch_id,d in data.get('batches',{}).items():
            digest=d.get('sha256','')
            if not re.fullmatch(r'[a-f0-9]{64}',digest): continue
            path=ROOT/'legacy'/(digest+'.pdf')
            if path.is_file(): rows.append({'id':'legacy-'+str(batch_id),'kind':'Lưu trữ','title':'Cargo cũ — lô '+str(batch_id),'created_at':path.stat().st_mtime,'pages':d.get('label_count'),'tracking':list(d.get('tracking',{}).values()),'recipients':[],'sha256':digest,'_path':str(path)})
    for d in archived():
        rows.append({**d, '_path': str(ARCHIVE / (d['id']+'.pdf'))})
    return sorted(rows, key=lambda r: r.get('created_at', 0), reverse=True)

@router.get('')
def listing(db: Session = Depends(get_db)):
    return {'items': [{k:v for k,v in r.items() if not k.startswith('_')} for r in entries(db)]}

@router.get('/{ident}/file.pdf')
def pdf(ident: str, db: Session = Depends(get_db)):
    row = next((r for r in entries(db) if r['id'] == ident), None)
    if not row: raise HTTPException(404, 'Label not found')
    path = Path(row['_path'])
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']: raise HTTPException(409, 'Label file changed')
    return FileResponse(path, media_type='application/pdf', filename=re.sub(r'[^\w.-]', '-', row['title'])+'.pdf', content_disposition_type='inline', headers={'Cache-Control':'private, no-store'})

@router.post('')
async def register(file: UploadFile = File(...), title: str = Form(...), kind: str = Form('Khác'), tracking: str = Form(''), recipients: str = Form('')):
    """Zen registers labels produced outside the standard Cargo/FBM pipeline."""
    content = await file.read(30*1024*1024+1)
    if len(content)>30*1024*1024 or not content.startswith(b'%PDF-'): raise HTTPException(400,'PDF required, maximum 30 MB')
    try:
        reader=PdfReader(io.BytesIO(content))
        if reader.is_encrypted or not 1<=len(reader.pages)<=500: raise ValueError()
    except Exception: raise HTTPException(400,'Invalid label PDF')
    import time
    digest=hashlib.sha256(content).hexdigest(); ARCHIVE.mkdir(parents=True, exist_ok=True)
    target=ARCHIVE/(digest+'.json')
    if target.exists(): return json.loads(target.read_text())
    row={'id':digest,'sha256':digest,'title':title[:180],'kind':kind[:40],'tracking':[s.strip() for s in tracking.split(',') if s.strip()], 'recipients':[recipients[:1000]] if recipients else [], 'pages':len(reader.pages),'created_at':time.time()}
    for path, data in [(ARCHIVE/(digest+'.pdf'), content), (target, json.dumps(row,ensure_ascii=False).encode())]:
        fd,tmp=tempfile.mkstemp(dir=ARCHIVE)
        with os.fdopen(fd,'wb') as stream: stream.write(data)
        os.replace(tmp,path)
    return row
