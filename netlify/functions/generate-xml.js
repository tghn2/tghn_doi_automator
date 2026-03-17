// netlify/functions/generate-xml.js
const { create } = require('xmlbuilder2');

exports.handler = async function(event){
  try {
    const body = JSON.parse(event.body || '{}');
    const { book = {}, chapters = [], registrant = 'WEB-FORM', doiPrefix='10.48060', doiSuffixBase='tghn' } = body;

    const d = new Date();
    const pad = (n,l=2)=>String(n).padStart(l,'0');
    const timestamp = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${String(d.getMilliseconds()).padStart(3,'0')}`;
    const batchId = `batch-${Math.random().toString(36).slice(2,9)}-${Date.now().toString(36)}`;

    const root = create({ version:'1.0', encoding:'utf-8' })
      .ele('doi_batch', {
        xmlns: 'http://www.crossref.org/schema/4.4.2',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        version: '4.4.2',
        'xsi:schemaLocation': 'http://www.crossref.org/schema/4.4.2 http://www.crossref.org/schema/deposit/crossref4.4.2.xsd'
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
    const bookNode = bodyNode.ele('book', { book_type:'other' });
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
            contr.ele('person_name', { sequence: i===0 ? 'first' : 'additional', contributor_role:'author' })
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
      if(ch.jats_abstract){
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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/xml' },
      body: xml
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};