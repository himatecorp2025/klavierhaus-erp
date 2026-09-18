"use strict";
// Canonical manual piano creation. Both entry points share this transaction.
const crypto = require('node:crypto');
const clean = (value,max=2000)=>String(value??'').replace(/\u0000/g,'').trim().slice(0,max);
const fault = (code,status=400,details)=>Object.assign(new Error(code),{code,status,details});
function createPianoMasterData({db,ensurePianoBrand,ensurePianoModel,lookup}) {
  const one=(sql,...args)=>db.prepare(sql).get(...args);
  const run=(sql,...args)=>db.prepare(sql).run(...args);
  const read=id=>one(`SELECT p.*,cp.location_name,cp.piano_location_address FROM pianos p
    LEFT JOIN client_pianos cp ON cp.piano_id=p.id AND cp.client_id=p.owner_contact_id WHERE p.id=?`,id);
  function create(body,forcedClientId=null) {
    return db.transaction(()=>{
      const ownerId=clean(forcedClientId||body.owner_contact_id,100);
      const owner=one('SELECT * FROM contacts WHERE id=?',ownerId);
      if(!owner)throw fault('PIANO_OWNER_REQUIRED');
      if(!clean(body.brand,200)||!clean(body.model,200))throw fault('PIANO_CORE_FIELDS_REQUIRED');
      const serial=clean(body.serial_no,200);
      const duplicate=serial&&one('SELECT id FROM pianos WHERE lower(trim(serial_no))=lower(?)',serial);
      if(duplicate)throw fault('PIANO_SERIAL_ALREADY_EXISTS',409,{existing_piano_id:duplicate.id});
      const brand=ensurePianoBrand(clean(body.brand,200)),model=ensurePianoModel(brand,clean(body.model,200));
      const reference=lookup?lookup({serial,brand,model}):{};
      const key=clean(body.id,100)||'P-'+crypto.randomUUID();
      const year=body.build_year!==''&&body.build_year!=null?Number(body.build_year):reference.build_year||null;
      if(year!==null&&(!Number.isInteger(year)||year<1700||year>2100))throw fault('PIANO_YEAR_INVALID');
      const cm=body.size_cm||reference.size_cm||null,inch=body.size_in||body.size_inch||reference.size_inch||null;
      const size=clean(body.size_display||reference.size_display||[cm?`${cm} cm`:'',inch?`(${inch})`:''].filter(Boolean).join(' '));
      const address=clean(body.same_as_client_address===true?owner.address:(body.piano_location_address??body.location));
      const name=clean(body.location_name,500);
      const estimate=Number(body.estimated_value||0);
      if(!Number.isFinite(estimate)||estimate<0)throw fault('PIANO_VALUE_INVALID');
      run(`INSERT INTO pianos(id,brand,model,serial_no,finish,build_year,size_cm,size_in,size_display,size_length,
        ownership,ownership_type,display_name,owner_contact_id,location,estimated_value,status,notes,external_reference,owner_resolution)
        VALUES(?,?,?,?,?,?,?,?,?,?,'Customer owned','Customer owned',?,?,?,?,?,?,?,'MATCHED_CLIENT')`,
        key,brand,model,serial,clean(body.finish,200),year,cm,inch,size,clean(body.size_length||size),
        `${brand} ${model}`,ownerId,address,estimate,'Active',clean(body.notes,10000),clean(body.external_reference,200)||null);
      run('INSERT INTO client_pianos(id,client_id,piano_id,location_name,piano_location_address) VALUES(?,?,?,?,?)',
        'CP-'+crypto.randomUUID(),ownerId,key,name,address);
      run('UPDATE contacts SET has_piano=1,updated_at=CURRENT_TIMESTAMP WHERE id=?',ownerId);
      return read(key);
    })();
  }
  function linkOwned(clientId,pianoId) {
    return db.transaction(()=>{
      if(!one('SELECT id FROM contacts WHERE id=?',clientId))throw fault('WORKFLOW_CLIENT_REQUIRED',404);
      const piano=one('SELECT * FROM pianos WHERE id=?',pianoId);
      if(!piano)throw fault('WORKFLOW_PIANO_REQUIRED',404);
      // Repair only a missing owner relationship. Never transfer an instrument.
      if(piano.owner_contact_id!==clientId)throw fault('PIANO_OWNER_MISMATCH',409);
      run('INSERT OR IGNORE INTO client_pianos(id,client_id,piano_id,piano_location_address) VALUES(?,?,?,?)',
        'CP-'+crypto.randomUUID(),clientId,pianoId,piano.location||'');
      run('UPDATE contacts SET has_piano=1,updated_at=CURRENT_TIMESTAMP WHERE id=?',clientId);
      return read(pianoId);
    })();
  }
  return {create,linkOwned,read};
}
module.exports={createPianoMasterData};
