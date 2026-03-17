// netlify/functions/save-submission.js
const { create } = require('xmlbuilder2');
const { supabase, verifyAdmin } = require('./_auth-check');

function pad(n,len=2){ return String(n).padStart(len,'0'); }
function crossrefTimestamp(d=new Date()){
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${String(d.getMilliseconds()).padStart(3,'0')}`;
}

exports.handler = async function(event){
  try {
    // authorise admin
    const authCheck = await verifyAdmin(event);
    if(!authCheck.ok) {
      return { statusCode: authCheck.status || 401, body: JSON.stringify({ error: authCheck.message }) };
    }
    const adminUser = authCheck.user;

    const body = JSON.parse(event.body || '{}');
    const { book = {}, chapters = [], registrant='WEB-FORM', doiPrefix='10.48060', doiSuffixBase='tghn' } = body;

    // compute how many new DOIs needed
    let needCount = 0;
    if(!book.doi) needCount += 1;
    for(const ch of chapters) if(!ch.doi) needCount += 1;

    if(needCount > 0) {
      // call RPC allocate_suffixes
      const { data:range, error:rpcErr } = await supabase.rpc('allocate_suffixes', { n: needCount });
      if(rpcErr) throw rpcErr;
      if(!range || !range.length) throw new Error('allocate_suffixes returned no range');
      const start = Number(range[0].start);
      let next = start;

      if(!book.doi) {
        book.doi = `${doiPrefix}/${doiSuffixBase}.${next++}`;
      }
      for(const ch of chapters){
        if(!ch.doi) {
          ch.doi = `${doiPrefix}/${doiSuffixBase}.${next++}`;
        }
      }
    }

    const timestamp = crossrefTimestamp(new Date());
    const batchId = `batch-${Math.random().toString(36).slice(2,9)}-${Date.now().toString(36)}`;

    // build xml with assigned DOIs
    const root = create({ version:'1.0', encoding:'utf-8' })
      .ele('doi_batch', {
        xmlns: 'http://www.crossref.org/schema/4.4.2',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        version: '4.4.2',
        'xsi:schemaLocation':'http://www.crossref.org/schema/4.4.2 http://www.crossref.org/schema/deposit/crossref4.4.2.xsd'
      });

    root.ele('head')
      .ele('doi_batch_id').txt(batchId).up()
      .ele('timestamp').txt(timestamp).up()
      .ele('depositor')
        .ele('depositor_name').txt(registrant).up()
        .ele('email_address').txt('').up()
      .up()
      .ele('registrant').txt(registrant).up()
    .up();

    const bodyNode = root.ele('body');
    const bookNode = bodyNode.ele('book', { book_type: 'other' });
    const bm = bookNode.ele('book_metadata');
    bm.ele('titles').ele('title').txt(book.title || '').up().up();
    if(book.publication_date){
      const pd = bm.ele('publication_date', { media_type: book.publication_date.media_type || 'online' });
      if(book.publication_date.month) pd.ele('month').txt(String(book.publication_date.month)).up();
      if(book.publication_date.day) pd.ele('day').txt(String(book.publication_date.day)).up();
      if(book.publication_date.year) pd.ele('year').txt(String(book.publication_date.year)).up();
      pd.up();
    }
    if(book.doi) bm.ele('doi_data').ele('doi').txt(book.doi).up().ele('resource').txt(book.url || '').up().up();

    for(const ch of chapters){
      const ci = bookNode.ele('content_item', { component_type:'chapter' });
      if((ch.contributors||[]).length){
        const contr = ci.ele('contributors');
        for(const [i,p] of (ch.contributors||[]).entries()){
          if(p.type === 'person'){
            contr.ele('person_name', { sequence: i===0 ? 'first':'additional', contributor_role:'author' })
              .ele('given_name').txt(p.given || '').up()
              .ele('surname').txt(p.surname || '').up()
            .up();
          } else {
            contr.ele('organization', { sequence:'additional', contributor_role:'author' }).txt(p.name || p.org || '').up();
          }
        }
        contr.up();
      }
      ci.ele('titles').ele('title').txt(ch.title || '').up().up();
      if(ch.jats_abstract) {
        ci.ele('jats:abstract', {'xml:lang': ch.abstract_lang || 'en'}).ele('jats:p').txt(ch.jats_abstract).up().up();
      }
      if(ch.publication_date){
        const pd = ci.ele('publication_date', { media_type: ch.publication_date.media_type || 'online' });
        if(ch.publication_date.month) pd.ele('month').txt(String(ch.publication_date.month)).up();
        if(ch.publication_date.day) pd.ele('day').txt(String(ch.publication_date.day)).up();
        if(ch.publication_date.year) pd.ele('year').txt(String(ch.publication_date.year)).up();
        pd.up();
      }
      if(ch.isTranslationOf){
        const pr = ci.ele('program', { xmlns:'http://www.crossref.org/relations.xsd' });
        pr.ele('related_item').ele('description').txt('Translation of another work').up()
          .ele('intra_work_relation', { 'relationship-type':'isTranslationOf', 'identifier-type':'doi' }).txt(ch.isTranslationOf).up().up();
        pr.up();
      }
      if(ch.doi) ci.ele('doi_data').ele('doi').txt(ch.doi).up().ele('resource').txt(ch.resource || '').up().up();
      ci.up();
    }

    const xml = root.end({ prettyPrint:true });

    // persist book (upsert by doi if present)
    let bookRecord;
    if(book.doi){
      const { data: existing } = await supabase.from('books').select('*').eq('doi', book.doi).limit(1).maybeSingle();
      if(existing){
        await supabase.from('books').update({
          title: book.title,
          url: book.url,
          publisher_name: book.publisher_name,
          publication_year: book.publication_date?.year || null,
          metadata: book
        }).eq('id', existing.id);
        bookRecord = existing;
      } else {
        const { data: b } = await supabase.from('books').insert({
          title: book.title,
          doi: book.doi,
          url: book.url,
          publisher_name: book.publisher_name,
          publication_year: book.publication_date?.year || null,
          metadata: book
        }).select('*').single();
        bookRecord = b;
      }
    } else {
      const { data: b } = await supabase.from('books').insert({
        title: book.title,
        doi: book.doi || null,
        url: book.url,
        publisher_name: book.publisher_name,
        publication_year: book.publication_date?.year || null,
        metadata: book
      }).select('*').single();
      bookRecord = b;
    }

    // persist chapters
    for(const ch of chapters){
      if(ch.doi){
        const { data: chExisting } = await supabase.from('chapters').select('*').eq('doi', ch.doi).limit(1).maybeSingle();
        if(chExisting){
          await supabase.from('chapters').update({
            book_id: bookRecord.id,
            title: ch.title,
            doi: ch.doi,
            resource_url: ch.resource || '',
            metadata: ch
          }).eq('id', chExisting.id);
        } else {
          await supabase.from('chapters').insert({
            book_id: bookRecord.id,
            title: ch.title,
            doi: ch.doi,
            resource_url: ch.resource || '',
            metadata: ch
          });
        }
      } else {
        await supabase.from('chapters').insert({
          book_id: bookRecord.id,
          title: ch.title,
          doi: ch.doi || null,
          resource_url: ch.resource || '',
          metadata: ch
        });
      }
    }

    const { data: submission } = await supabase.from('submissions').insert({
      book_id: bookRecord.id,
      batch_id: batchId,
      timestamp: timestamp,
      registrant: registrant,
      doi_prefix: doiPrefix,
      doi_suffix_base: doiSuffixBase,
      xml: xml,
      status: 'saved',
      created_by: adminUser.id
    }).select('*').single();

    return { statusCode: 200, body: JSON.stringify({ success: true, submission }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err?.message || err }) };
  }
};