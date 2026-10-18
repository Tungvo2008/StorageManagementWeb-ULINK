#!/usr/bin/env python3
"""Run: PYTHONPATH=/app python scripts/export_ulink_catalog.py --output exports/ULINK-Catalog.pdf"""
import argparse
from pathlib import Path
from app.db.session import SessionLocal
from app.services.ulink_catalog import build_catalog
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',default='/app/exports/ULINK-Catalog.pdf');a=p.parse_args()
 with SessionLocal() as db:print(build_catalog(db,Path(a.output)))
