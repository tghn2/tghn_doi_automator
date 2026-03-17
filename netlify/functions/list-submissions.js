// netlify/functions/list-submissions.js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async function(){
  try {
    const { data } = await supabase.from('submissions').select('id, batch_id, timestamp, registrant, status, created_at, created_by').order('created_at', { ascending:false }).limit(200);
    return { statusCode: 200, body: JSON.stringify({ submissions: data }) };
  } catch(err){
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};