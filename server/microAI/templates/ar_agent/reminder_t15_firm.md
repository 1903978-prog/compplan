---
name: AR reminder — T+15 firm
agent: ar_agent
trigger: Invoice 15 days overdue
slots: [client_name, contact_name, invoice_number, amount, original_due_date, days_overdue, payment_details, sender_name]
output: markdown
---

Subject: Invoice {{invoice_number}} — {{days_overdue}} days overdue

Hi {{contact_name}},

I'm following up on invoice {{invoice_number}} for {{amount}}, which was due on {{original_due_date}} and remains outstanding.

Could you please confirm the expected payment date? If there's a query on the invoice, let me know and we'll resolve it quickly.

Payment details:
{{payment_details}}

Thank you for your prompt attention.

{{sender_name}}
Eendigo
