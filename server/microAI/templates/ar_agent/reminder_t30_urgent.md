---
name: AR reminder — T+30 urgent
agent: ar_agent
trigger: Invoice 30 days overdue
slots: [client_name, contact_name, invoice_number, amount, original_due_date, days_overdue, payment_details, sender_name]
output: markdown
---

Subject: URGENT — Invoice {{invoice_number}} {{days_overdue}} days overdue

Hi {{contact_name}},

Invoice {{invoice_number}} for {{amount}} (due {{original_due_date}}) is now {{days_overdue}} days overdue. This requires your immediate attention.

Please arrange payment today or contact me directly to discuss. Continued non-payment may affect our ability to continue service delivery.

Payment details:
{{payment_details}}

{{sender_name}}
Eendigo
