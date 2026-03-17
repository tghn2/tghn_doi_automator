// netlify/functions/submit-crossref.js
const axios = require('axios');
const FormData = require('form-data');
const { supabase, verifyAdmin } = require('./_auth-check');

exports.handler = async function(event){
  try {
    // admin check
    const authCheck = await verifyAdmin(event);
    if(!authCheck.ok){
      return { statusCode: authCheck.status || 401, body: JSON.stringify({ error: authCheck.message }) };
    }
    const adminUser = authCheck.user;

    const { submissionId, endpointOverride } = JSON.parse(event.body || '{}');
    if(!submissionId) return { statusCode: 400, body: JSON.stringify({ error: 'submissionId is required' }) };

    const CROSSREF_ENDPOINT = endpointOverride || process.env.CROSSREF_ENDPOINT;
    const CROSSREF_USERNAME = process.env.CROSSREF_USERNAME;
    const CROSSREF_PASSWORD = process.env.CROSSREF_PASSWORD;

    if(!CROSSREF_ENDPOINT || !CROSSREF_USERNAME || !CROSSREF_PASSWORD) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Crossref credentials or endpoint not configured in env' }) };
    }

    // load submission
    const { data: sub } = await supabase.from('submissions').select('*').eq('id', submissionId).single();
    if(!sub) return { statusCode: 404, body: JSON.stringify({ error: 'submission not found' }) };

    const xml = sub.xml || '';

    // send as multipart/form-data (works for many Crossref endpoints)
    const form = new FormData();
    // Crossref test servlet may expect login fields; include them
    form.append('operation', 'doMDUpload');
    form.append('login_id', CROSSREF_USERNAME);
    form.append('login_passwd', CROSSREF_PASSWORD);
    form.append('fname', Buffer.from(xml), { filename: `${sub.batch_id || 'deposit'}.xml`, contentType: 'text/xml' });

    const resp = await axios.post(CROSSREF_ENDPOINT, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 120000
    });

    const status = (CROSSREF_ENDPOINT && CROSSREF_ENDPOINT.includes('test')) ? 'submitted_test' : 'submitted_live';
    await supabase.from('submissions').update({ status, crossref_response: resp.data }).eq('id', submissionId);

    return { statusCode: 200, body: JSON.stringify({ ok:true, response: String(resp.data) }) };
  } catch(err){
    console.error(err);
    try {
      const { submissionId } = JSON.parse(event.body || '{}');
      if(submissionId) await supabase.from('submissions').update({ status: 'failed', crossref_response: { error: String(err?.message || err) } }).eq('id', submissionId);
    } catch(e){}
    return { statusCode: 500, body: JSON.stringify({ error: err?.message || err }) };
  }
};