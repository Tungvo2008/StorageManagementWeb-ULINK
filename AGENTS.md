# Project Guidelines & Rules

Refer to detailed rules in `.agents/rules/trust_cargo_rules.md`.

### Core Trust Cargo Operation Principles:
1. **Trust Cargo Paper Bills:** Any receipt/bill with the Trust Cargo form is a **MARKET** bill (`billing_type = "MARKET"`, market = `World Market`), NEVER `DIRECT`.
2. **Batch Closure:** Keep cargo batches `OPEN` while user sends items progressively. Only finalize when user explicitly says done.
3. **UPS Label Generation:**
   - Always choose `UPS Ground` (never Saver).
   - Box size: 72 pack (`16x28`).
   - Always include tracking number in notification upon creation.

4. - **Thảo Trần là Hub duy nhất:** Thùng có nhãn Thảo Trần luôn là Thùng Hub (`is_hub=True`, `hub_consignee_name="Thảo Trần"`), các bill chụp kèm tự động gom vào thùng Thảo Trần.
