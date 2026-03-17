// netlify/functions/_auth-check.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if(!SUPABASE_URL || !SUPABASE_KEY){
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variables');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * verifyAdmin(event)
 * - expects Authorization: Bearer <access_token> header
 * - returns { ok:true, user } if the token maps to a user that is admin
 * - or { ok:false, status, message } on failure
 */
async function verifyAdmin(event) {
  const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if(!token) return { ok:false, status:401, message:'Authorization token missing' };

  // get user from access token using server (service_role) client
  const { data, error } = await supabase.auth.getUser(token);
  if(error || !data || !data.user) {
    return { ok:false, status:401, message: error?.message || 'Invalid token' };
  }
  const user = data.user;

  // 1) quick env-based check
  if(process.env.ADMIN_EMAIL && user.email && user.email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()){
    return { ok:true, user };
  }

  // 2) check admins table
  try {
    const { data: adminRec, error: qErr } = await supabase.from('admins').select('supabase_user_id,email').eq('supabase_user_id', user.id).limit(1).maybeSingle();
    if(qErr) {
      // query error - deny, but include message
      return { ok:false, status:500, message: 'Admin lookup error: ' + qErr.message };
    }
    if(adminRec && adminRec.supabase_user_id) return { ok:true, user };
  } catch(e){
    return { ok:false, status:500, message: 'Admin lookup exception: ' + e.message };
  }

  return { ok:false, status:403, message:'User not authorized' };
}

module.exports = { supabase, verifyAdmin };