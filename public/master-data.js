/* Shared client picker and native, stacked master-data dialogs. UI12. */
window.MasterData = (() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tr=(en,hu)=>typeof bi==='function'?bi(en,hu):en;
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().trim();
  let sequence=0;
  function clientPicker(host,{name='client_id',label=tr('Client','\u00dcgyf\u00e9l'),items=[],value='',onSelect=()=>{},allowCreate=true}={}) {
    const uid='md-client-'+(++sequence);
    let records=[...items],chosen=null,active=-1,matches=[],creating=false;
    host.classList.add('md-client-picker');
    host.innerHTML=`<label for="${uid}">${esc(label)}</label><input id="${uid}" type="search" role="combobox" aria-autocomplete="list" aria-controls="${uid}-results" aria-expanded="false" autocomplete="off" required placeholder="${esc(tr('Name, email, phone or address','N\u00e9v, e-mail, telefon vagy c\u00edm'))}"><input type="hidden" name="${esc(name)}"><div class="md-client-menu" hidden><div id="${uid}-results" role="listbox"></div><p data-client-empty role="status" hidden></p>${allowCreate?`<button type="button" data-new-client>+ ${tr('Add new client','\u00daj \u00fcgyf\u00e9l felvitele')}</button>`:''}</div>`;
    const input=host.querySelector('[role=combobox]'),hidden=host.querySelector('input[type=hidden]'),menu=host.querySelector('.md-client-menu'),list=host.querySelector('[role=listbox]'),empty=host.querySelector('[data-client-empty]');
    const invalid=()=>input.setCustomValidity(hidden.value?'':tr('Select a client from the results or create a new client.','V\u00e1lassz \u00fcgyfelet a tal\u00e1latokb\u00f3l, vagy hozz l\u00e9tre \u00fajat.'));
    function hide(){menu.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
    function set(client,notify=true){chosen=client||null;hidden.value=client?.id||'';input.value=client?.name||'';invalid();hide();if(notify){onSelect(chosen);hidden.dispatchEvent(new Event('change',{bubbles:true}));}}
    function render(){
      const query=norm(input.value);matches=records.filter(c=>norm([c.name,c.email,c.phone,c.address].join(' ')).includes(query)).slice(0,30);active=-1;
      list.innerHTML=matches.map((c,i)=>`<button id="${uid}-option-${i}" type="button" role="option" aria-selected="${chosen?.id===c.id}" data-client-index="${i}"><strong>${esc(c.name)}</strong><small>${esc([c.phone,c.email,c.address].filter(Boolean).join(' \u00b7 '))}</small></button>`).join('');
      empty.hidden=matches.length>0;empty.textContent=tr('No matching client.','Nincs megfelel\u0151 \u00fcgyf\u00e9ltal\u00e1lat.');menu.hidden=false;input.setAttribute('aria-expanded','true');input.removeAttribute('aria-activedescendant');
    }
    input.addEventListener('input',()=>{chosen=null;hidden.value='';invalid();onSelect(null);hidden.dispatchEvent(new Event('change',{bubbles:true}));render();});
    input.addEventListener('focus',render);
    input.addEventListener('click',()=>{if(menu.hidden)render();});
    host.addEventListener('focusout',()=>setTimeout(()=>{if(!host.contains(document.activeElement))hide();},0));
    list.addEventListener('pointerdown',event=>event.preventDefault());
    list.addEventListener('click',event=>{const option=event.target.closest('[data-client-index]');if(option){set(matches[Number(option.dataset.clientIndex)]);input.focus();hide();}});
    input.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopPropagation();hide();return;}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();if(menu.hidden)render();if(!matches.length)return;
        active=(active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;
        list.querySelectorAll('[role=option]').forEach((button,i)=>button.classList.toggle('is-active',i===active));
        input.setAttribute('aria-activedescendant',`${uid}-option-${active}`);list.children[active]?.scrollIntoView({block:'nearest'});
      }
      if(event.key==='Enter'&&!menu.hidden){event.preventDefault();if(active>=0)set(matches[active]);}
    });
    host.querySelector('[data-new-client]')?.addEventListener('click',async()=>{
      if(creating)return;creating=true;hide();
      try {const client=await open('contacts',null,{prefill:{name:input.value.trim()}});if(client){records.push(client);set(client);}}
      finally{creating=false;input.focus();hide();}
    });
    set(records.find(c=>c.id===value),false);
    return {set, input, get selected(){return chosen;},setItems(next){records=[...next];if(hidden.value&&!records.some(c=>c.id===hidden.value))set(null);},focus(){input.focus();}};
  }
  function message(error){
    const map={PIANO_OWNER_REQUIRED:tr('Select a client / owner.','V\u00e1lassz \u00fcgyfelet / tulajdonost.'),PIANO_CORE_FIELDS_REQUIRED:tr('Brand and model are required.','A m\u00e1rka \u00e9s a modell k\u00f6telez\u0151.'),PIANO_SERIAL_ALREADY_EXISTS:tr('This serial number is already registered.','Ez a gy\u00e1ri sz\u00e1m m\u00e1r szerepel a nyilv\u00e1ntart\u00e1sban.'),PIANO_OWNER_MISMATCH:tr('This piano belongs to a different client. No ownership was changed.','Ez a zongora m\u00e1s \u00fcgyf\u00e9lhez tartozik. Nem t\u00f6rt\u00e9nt tulajdonosv\u00e1lt\u00e1s.')};
    return map[error?.message]||error?.message||String(error);
  }
  // The same field builder, behavior and saver are used from every entry point.
  function open(kind,row=null,options={}) {
    return new Promise(resolve=>{
      const initial={...(options.prefill||{}),...(row||{})},dialog=document.createElement('dialog'),uid='md-dialog-'+(++sequence),focus=document.activeElement;
      let busy=false,finished=false;
      dialog.className='md-dialog';dialog.dataset.masterKind=kind;dialog.setAttribute('data-ui-contract','UI12');dialog.setAttribute('aria-labelledby',uid+'-title');
      const title=kind==='contacts'?tr(row?'Edit client':'Add client',row?'\u00dcgyf\u00e9l szerkeszt\u00e9se':'\u00daj \u00fcgyf\u00e9l'):tr(row?'Edit piano':'Add piano',row?'Zongora szerkeszt\u00e9se':'\u00daj zongora');
      dialog.innerHTML=`<header><h2 id="${uid}-title">${esc(title)}</h2><button type="button" data-md-cancel aria-label="${esc(tr('Close','Bez\u00e1r\u00e1s'))}">\u00d7</button></header><div class="md-error" role="alert" tabindex="-1" hidden></div><form>${entityFormFieldsMarkup(kind,row,initial)}<div class="actions"><button type="button" class="ghost-btn" data-md-cancel>${tr('Cancel','M\u00e9gse')}</button><button type="submit">${tr('Save','Ment\u00e9s')}</button></div></form>`;
      const form=dialog.querySelector('form'),errorBox=dialog.querySelector('.md-error');
      function finish(result){if(finished)return;finished=true;if(typeof activeAdminDatePicker!=='undefined'&&dialog.contains(activeAdminDatePicker?.input))adminDatePickerClose();dialog.close();dialog.remove();focus?.focus?.();resolve(result);const callback=result?options.onSaved:options.onCancelled;if(typeof callback==='function')Promise.resolve(callback(result)).catch(error=>typeof showError==='function'&&showError(error));}
      const cancel=()=>{if(!busy)finish(null);};
      dialog.querySelectorAll('[data-md-cancel]').forEach(button=>button.addEventListener('click',cancel));
      dialog.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();cancel();});
      // Native dialogs occupy the top layer above the still-open workflow dialog.
      document.body.append(dialog);dialog.showModal();
      const ready=Promise.resolve(kind==='pianos'?setupPianoFormBehavior(row,initial,form):setupContactFormBehavior(row,form)).then(()=>{if(dialog.isConnected&&typeof applyLanguageToDOM==='function')applyLanguageToDOM(form);});
      ready.catch(error=>{errorBox.textContent=message(error);errorBox.hidden=false;});
      form.addEventListener('submit',async event=>{
        event.preventDefault();event.stopPropagation();if(busy)return;await ready.catch(()=>{});
        if(!form.reportValidity())return;
        if(kind==='pianos'&&!form.querySelector('[name=owner_contact_id]')?.value){errorBox.textContent=message(new Error('PIANO_OWNER_REQUIRED'));errorBox.hidden=false;return;}
        busy=true;dialog.setAttribute('aria-busy','true');form.querySelector('[type=submit]').disabled=true;errorBox.hidden=true;
        try {const saved=await saveEntityFormRecord(kind,row,form);finish(saved);}
        catch(error){errorBox.textContent=message(error);errorBox.hidden=false;errorBox.focus();}
        finally{busy=false;dialog.setAttribute('aria-busy','false');form.querySelector('[type=submit]').disabled=false;}
      });
      form.querySelector('input:not([type=hidden]),textarea')?.focus();
    });
  }
  return {clientPicker,open,message};
})();
