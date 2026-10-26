import { db } from "../../database/db.js";
export async function generateProtocol(client=db){
 const row=(await client.query(`SELECT nextval('technical_protocol_seq') seq,TO_CHAR(CURRENT_DATE,'YYYYMMDD') day`)).rows[0];
 return `AT-${row.day}-${String(row.seq).padStart(8,'0')}`;
}
