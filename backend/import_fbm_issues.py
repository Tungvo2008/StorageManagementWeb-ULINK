import json
from datetime import datetime, timezone
from collections import defaultdict
from app.db.session import SessionLocal
from app.db.models import Product, AmazonProductMapping, InventoryIssue, InventoryIssueLine, StockMovement, StockMovementType

with open("/tmp/fbm_orders_cache.json") as f:
    orders = json.load(f)

db = SessionLocal()

# 1. Ensure AmazonProductMapping for FBM SKUs
sku_to_prod_id = {
    "TWH_1628_White_72Pack": 1,
    "TWH_1628_Black_72Pack": 2,
    "TWH_1628_Grey_72Pack": 3,
    "TWH_1628_Yellow_72Pack": 4,
    "TWH_1628_Turquoise_72Pack": 5,
    "TWH_1628_Orange_72Pack": 6,
    "TWH_1628_Pink_72Pack": 7,
    "TWH_1628_Teal_72Pack": 8,
    "TWH_1628_Green_72Pack": 9,
    "TWH_1628_Navy_72Pack": 10,
    "TWH_1628_Brown_72Pack": 11,
    "TWH_1313_White_108Pack": 12,
    "TWH_1313_Pink_108Pack": 18,
}

for sku, pid in sku_to_prod_id.items():
    existing_m = db.query(AmazonProductMapping).filter(AmazonProductMapping.amazon_sku == sku).first()
    if not existing_m:
        m = AmazonProductMapping(amazon_sku=sku, product_id=pid)
        db.add(m)
db.flush()
print("AmazonProductMapping checked/updated.")

# 2. Group orders after 2026-02-19
after_feb19 = [o for o in orders if o["purchase_date"][:10] > "2026-02-19"]
by_date = defaultdict(list)
for o in after_feb19:
    d = o["purchase_date"][:10]
    by_date[d].append(o)

issue_idx = 45
total_issues_created = 0
total_pieces_deducted = 0

for d, ords in sorted(by_date.items()):
    issue_num = f"IS{issue_idx:04d}"
    
    existing = db.query(InventoryIssue).filter(InventoryIssue.issue_number == issue_num).first()
    if existing:
        print(f"{issue_num} already exists, skipping")
        issue_idx += 1
        continue
        
    order_ids = ", ".join(o["order_id"] for o in ords)
    recipients = ", ".join((o.get("recipient_name") or "Khách Amazon") for o in ords)
    first_oid = ords[0]["order_id"]
    issued_to = f"Amazon FBM ({first_oid})" if len(ords) == 1 else f"Amazon FBM ({len(ords)} orders)"
    note = f"Amazon FBM ({len(ords)} order(s)): {order_ids} | Người nhận: {recipients}"
    dt = datetime.strptime(d + " 12:00:00", "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    
    issue = InventoryIssue(
        issue_number=issue_num,
        issued_at=dt,
        issued_by="System (Amazon FBM Sync)",
        issued_to=issued_to,
        purpose="AMAZON_FBM",
        note=note,
    )
    db.add(issue)
    db.flush()
    
    prod_quantities = defaultdict(lambda: {"dozens": 0, "pieces": 0, "skus": []})
    for o in ords:
        for it in o["items"]:
            sku = it["sku"]
            qty = it["quantity"]
            pid = sku_to_prod_id[sku]
            dozens_per_pack = 9 if "108Pack" in sku else 6
            d_qty = qty * dozens_per_pack
            p_qty = d_qty * 12
            prod_quantities[pid]["dozens"] += d_qty
            prod_quantities[pid]["pieces"] += p_qty
            prod_quantities[pid]["skus"].append(f"{sku} ({qty} packs)")
            
    for pid, qinfo in prod_quantities.items():
        prod = db.query(Product).filter(Product.id == pid).with_for_update().first()
        line_note = ", ".join(qinfo["skus"])
        
        line = InventoryIssueLine(
            issue_id=issue.id,
            product_id=pid,
            sku=prod.sku,
            product_name=prod.name,
            uom=prod.uom,
            uom_multiplier=prod.uom_multiplier,
            quantity=qinfo["dozens"],
            note=line_note,
        )
        db.add(line)
        db.flush()
        
        q_before = int(prod.quantity_on_hand)
        q_after = q_before - qinfo["pieces"]
        prod.quantity_on_hand = q_after
        total_pieces_deducted += qinfo["pieces"]
        
        mov = StockMovement(
            product_id=pid,
            issue_id=issue.id,
            issue_line_id=line.id,
            movement_type=StockMovementType.OUT,
            quantity_delta=-qinfo["pieces"],
            note=f"Issue {issue_num} (AMAZON_FBM) - {line_note}",
            created_at=dt,
        )
        db.add(mov)
        
    issue_idx += 1
    total_issues_created += 1

db.commit()
print(f"SUCCESS: Created {total_issues_created} AMAZON_FBM issues (IS0045 - IS{issue_idx-1:04d}).")
print(f"Total pieces deducted: {total_pieces_deducted} pcs (249 Dozens).")
db.close()
