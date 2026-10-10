# User Requirements Specification (URS)

**System:** Pharma Electronic Batch Record (eBR)
**Plant:** Sahyadri Pharma Ltd., Pune (**fictional**, for demonstration only)
**Product:** Paracetamol Tablets IP 500 mg (master record MBR-PCM500 v1.0)
**Version:** 1.0

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| URS-001 | Users shall log in with a unique username and password. Failed logins shall be recorded. No function other than login shall be available without authentication. | Must |
| URS-002 | The system shall support the roles **Operator**, **QA** and **Admin**, and restrict functions by role (operators execute; only QA reviews, resolves deviations and releases). | Must |
| URS-003 | The system shall hold an approved, read-only **master batch record (MBR)** for paracetamol tablets with the stages Dispensing, Granulation, Compression, Coating and Packing, each with written instructions. | Must |
| URS-004 | Each MBR step shall define its process parameters with limits (low / high) and, where applicable, a target and unit. | Must |
| URS-005 | Creating a batch shall generate an executable batch record from the MBR, with a unique batch number and a status lifecycle: Created → In progress → Ready for QA → Released / Rejected. | Must |
| URS-006 | Steps shall be executed in the MBR sequence. A step shall not start until all earlier steps are completed. | Must |
| URS-007 | Operators shall enter actual values for each parameter. A step can be completed only when all its values have been entered. | Must |
| URS-008 | An entered value outside its limits shall automatically create a **deviation** linked to the batch, step, parameter and value. | Must |
| URS-009 | A deviation shall be resolved by QA only, with a classification (minor / major / critical), a documented impact assessment and an e-signature. A batch with an open deviation shall not be released. | Must |
| URS-010 | Critical steps (Dispensing, Compression, Packing) shall require an **electronic signature** by re-entering the password, with a stated meaning: "Performed by" and, from a *different* user, "Verified by". Failed signatures shall be recorded. | Must |
| URS-011 | The system shall keep a complete **audit trail** of every change (create, change, status change, signature, login): who, when, old value, new value and reason. Changing an entered value shall require a reason. The audit trail shall be read-only and tamper-evident. | Must |
| URS-012 | Before batch release, QA shall have a **review-by-exception** page that shows only deviations (with summary counts), and allows QA to release (with e-signature "Approved for release") or reject the batch. | Must |

## Out of scope

Integration with ERP/LIMS/equipment, material genealogy, weighing-scale interfaces, and formal computer-system validation. This is a fictional demonstration system and is not intended for real GMP use.
