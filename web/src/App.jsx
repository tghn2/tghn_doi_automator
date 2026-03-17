import React, { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { supabase } from './supabaseClient';

export default function App(){
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState([]);
  const [bookTitle, setBookTitle] = useState('');
  const [chapters, setChapters] = useState([]);
  const [xmlPreview, setXmlPreview] = useState('');
  const [submissions, setSubmissions] = useState([]);

  useEffect(()=>{
    (async ()=>{
      const { data } = await supabase.auth.getSession();
      setUser(data?.session?.user || null);
      supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user || null);
      });
      fetchSubs();
    })();
  }, []);

  async function signIn(){
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) return alert('Login error: ' + error.message);
    const { data } = await supabase.auth.getSession();
    setUser(data?.session?.user || null);
  }

  async function signOut(){
    await supabase.auth.signOut();
    setUser(null);
  }

  function parseCsv(){
    Papa.parse(csvText, { header:true, skipEmptyLines:true, complete: (res) => {
      setRows(res.data);
    }});
  }

  function addRowAsChapter(i){
    const r = rows[i];
    const ch = {
      title: r.title || r.Title || r['resource title'] || '',
      resource: r.url || r.URL || r.resource || '',
      contributors: []
    };
    setChapters(prev=>[...prev, ch]);
  }

  async function generateXmlPreview(){
    const payload = { book: { title: bookTitle, publication_date: { year: new Date().getFullYear() } }, chapters, registrant: 'WEB-FORM' };
    const res = await fetch('/.netlify/functions/generate-xml', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
    const text = await res.text();
    setXmlPreview(text);
  }

  async function saveSubmission(){
    if(!user) return alert('Please sign in as admin to save submissions');
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    const payload = { book: { title: bookTitle, publication_date: { year: new Date().getFullYear() } }, chapters, registrant: 'WEB-FORM' };
    const r = await fetch('/.netlify/functions/save-submission', {
      method:'POST',
      headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if(j.error) alert('Save error: ' + j.error);
    else alert('Saved submission: ' + j.submission.id);
    fetchSubs();
  }

  async function fetchSubs(){
    const r = await fetch('/.netlify/functions/list-submissions');
    const j = await r.json();
    setSubmissions(j.submissions || []);
  }

  async function submitToCrossref(id){
    if(!user) return alert('Please sign in as admin to submit to Crossref');
    const token = (await supabase.auth.getSession()).data?.session?.access_token;
    const r = await fetch('/.netlify/functions/submit-crossref', {
      method:'POST',
      headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ submissionId: id })
    });
    const j = await r.json();
    if(j.error) alert('Submit error: ' + (j.error));
    else alert('Crossref response: ' + (j.response || JSON.stringify(j)));
    fetchSubs();
  }

  return (
    <div style={{ fontFamily:'system-ui', padding:20 }}>
      <h2>Crossref DOI App</h2>

      <div style={{ marginBottom: 16 }}>
        {!user ? (
          <div>
            <h3>Admin sign in</h3>
            <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} /><br/>
            <input placeholder="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} /><br/>
            <button onClick={signIn}>Sign in</button>
          </div>
        ) : (
          <div>
            <div>Signed in as: {user.email} <button onClick={signOut}>Sign out</button></div>
          </div>
        )}
      </div>

      <section style={{ marginBottom:12 }}>
        <h3>Paste CSV rows</h3>
        <textarea rows={6} style={{ width:'100%' }} value={csvText} onChange={e=>setCsvText(e.target.value)} />
        <div style={{ marginTop:8 }}>
          <button onClick={parseCsv}>Parse CSV</button>
        </div>

        <div>
          <h4>Parsed rows</h4>
          {rows.map((r,i)=> (
            <div key={i}>
              <strong>{r.title || r.Title || '(no title)'}</strong> — <button onClick={()=>addRowAsChapter(i)}>Add as chapter</button>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBottom:12 }}>
        <h3>Book (hub)</h3>
        <input style={{ width:'60%' }} placeholder="Book title" value={bookTitle} onChange={e=>setBookTitle(e.target.value)} />
      </section>

      <section style={{ marginBottom:12 }}>
        <h3>Chapters</h3>
        {chapters.map((c,i)=>(<div key={i}>{i+1}. {c.title} — {c.resource}</div>))}
      </section>

      <div style={{ marginBottom:12 }}>
        <button onClick={generateXmlPreview}>Generate XML Preview</button>
        <button onClick={saveSubmission} style={{ marginLeft:8 }}>Save (assign DOIs)</button>
      </div>

      <section style={{ marginBottom:12 }}>
        <h3>XML Preview</h3>
        <pre style={{ whiteSpace:'pre-wrap', background:'#f7f7f7', padding:10 }}>{xmlPreview}</pre>
      </section>

      <section>
        <h3>Saved submissions</h3>
        {submissions.map(s=>(
          <div key={s.id} style={{ border:'1px solid #ddd', padding:8, marginBottom:8 }}>
            <div><strong>{s.batch_id}</strong> — {s.registrant} — {s.status}</div>
            <div><button onClick={()=>submitToCrossref(s.id)}>Submit to Crossref (test)</button></div>
          </div>
        ))}
      </section>
    </div>
  );
}