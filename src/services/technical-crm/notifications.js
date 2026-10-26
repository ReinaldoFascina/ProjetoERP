import { db } from "../../database/db.js";
const DEFAULT_SUBJECT='[RESistemas] {{protocol}} - {{event}}';
const DEFAULT_BODY='<p>Chamado <strong>{{protocol}}</strong></p><p>{{message}}</p>';
function render(template,data){return String(template||'').replace(/{{(\w+)}}/g,(_,key)=>data[key]??'');}
export async function queueTicketNotifications(client,{companyId,branchId,ticketId,eventCode,message}){
 const rule=(await client.query(`SELECT * FROM technical_crm_notification_rules WHERE company_id=$1 AND branch_id=$2 AND event_code=$3 AND enabled=TRUE`,[companyId,branchId,eventCode])).rows[0];
 if(!rule)return 0;
 const ticket=(await client.query(`SELECT t.*,u.email assigned_email,g.email group_email FROM tickets t LEFT JOIN users u ON u.id=t.assigned_user_id LEFT JOIN technical_crm_groups g ON g.id=t.assigned_group_id WHERE t.id=$1 AND t.company_id=$2 AND t.branch_id=$3`,[ticketId,companyId,branchId])).rows[0];
 if(!ticket)return 0;
 const recipients=new Set();
 if(rule.notify_requester&&ticket.requester_email)recipients.add(ticket.requester_email);
 if((rule.notify_assigned_user||rule.notify_stage_owner)&&ticket.assigned_email)recipients.add(ticket.assigned_email);
 if(rule.notify_assigned_group&&ticket.group_email)recipients.add(ticket.group_email);
 const data={protocol:ticket.protocol,event:eventCode,message};
 for(const email of recipients)await client.query(`INSERT INTO technical_crm_email_outbox(company_id,branch_id,ticket_id,event_code,recipient_email,subject,body_html) VALUES($1,$2,$3,$4,$5,$6,$7)`,[companyId,branchId,ticketId,eventCode,email,render(rule.subject_template||DEFAULT_SUBJECT,data),render(rule.body_template||DEFAULT_BODY,data)]);
 return recipients.size;
}
export async function listNotificationRules(companyId,branchId){return (await db.query(`SELECT * FROM technical_crm_notification_rules WHERE company_id=$1 AND branch_id=$2 ORDER BY event_code`,[companyId,branchId])).rows;}
