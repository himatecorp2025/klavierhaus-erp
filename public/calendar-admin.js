"use strict";
// Google Calendar setup is an explicitly administrator-controlled operation.
// No passwords or Google access tokens are ever passed to this page.
async function renderStaffCalendarAdminPanel() {
  const shell=document.querySelector(".system-integrations-v6-shell");
  if(!shell)return;
  shell.querySelector("#staffCalendarAdminPanel")?.remove();
  const panel=document.createElement("section");panel.id="staffCalendarAdminPanel";panel.className="panel";
  const title=document.createElement("h2");title.textContent=tr("Employee calendars – connection checklist","Munkatársi naptárak – csatlakoztatási ellenőrzőlista");
  const help=document.createElement("p");help.className="muted";
  help.textContent=tr(
    "An employee email alone does not grant Calendar access. In Google Calendar, each employee must share the exact calendar ID with klavierhauswork@gmail.com. Choose 'See all event details' to read events; use 'Make changes to events' only if two-way updates are required. Save the calendar ID, enable the connection and select Verify.",
    "Egy alkalmazott e-mail-címének megadása önmagában nem ad naptárhozzáférést. A Google Naptárban a pontos naptárt meg kell osztani a klavierhauswork@gmail.com fiókkal. Olvasáshoz „Összes eseményrészlet megtekintése”, kétirányú módosításhoz „Események módosítása” jogosultság szükséges. Mentsd a naptárazonosítót, engedélyezd a kapcsolatot, majd válaszd az Ellenőrzést."
  );
  panel.append(title,help);
  const list=document.createElement("div");list.className="team-list";panel.appendChild(list);
  shell.appendChild(panel);
  let rows;
  try{rows=await api("/api/google-calendar/staff-status",{memoryCacheMs:0});}
  catch(error){const problem=document.createElement("p");problem.textContent=humanError(error);list.appendChild(problem);return;}
  if(!Array.isArray(rows))rows=[];
  for(const employee of rows){
    const wrap=document.createElement("div");wrap.className="team-row";wrap.style.cssText="align-items:flex-end;flex-wrap:wrap;gap:12px";
    const employeeLabel=document.createElement("div");employeeLabel.className="team-person";
    const labelText=document.createElement("span");const name=document.createElement("strong"),email=document.createElement("small");
    name.textContent=employee.name||employee.user_id;email.textContent=employee.user_email||employee.calendar_email||"";
    labelText.append(name,email);employeeLabel.appendChild(labelText);
    const idField=document.createElement("label");idField.className="field";idField.style.flex="1 1 240px";
    const idCaption=document.createElement("span");idCaption.textContent=tr("Google calendar ID","Google-naptárazonosító");
    const idInput=document.createElement("input");idInput.type="text";idInput.value=employee.calendar_id||employee.calendar_email||"";idInput.maxLength=320;
    idField.append(idCaption,idInput);
    const toggleLabel=document.createElement("label");toggleLabel.className="field";
    const toggle=document.createElement("input");toggle.type="checkbox";toggle.checked=Boolean(employee.enabled);
    const toggleName=document.createElement("span");toggleName.textContent=tr("Sync enabled","Szinkron engedélyezve");
    toggleLabel.append(toggle,toggleName);
    const writeLabel=document.createElement("label");writeLabel.className="field";
    const writeToggle=document.createElement("input");writeToggle.type="checkbox";
    writeToggle.checked=Boolean(employee.write_enabled);
    const writeCaption=document.createElement("span");writeCaption.textContent=tr("Allow ERP to edit this employee's Google calendar (requires Google write permission)","ERP-visszaírás engedélyezése ebbe a munkatársi Google-naptárba (Google írási jogosultság szükséges)");
    writeLabel.append(writeToggle,writeCaption);
    const stateBox=document.createElement("div");stateBox.className="field";
    const stateName=document.createElement("strong");stateName.textContent=employee.sync_status||"PENDING";
    const stateError=document.createElement("small");stateError.textContent=employee.last_error||tr("No sync error reported","Nincs jelzett szinkronhiba");
    const checked=document.createElement("small");checked.textContent=employee.last_checked_at?
      tr("Last checked: ","Utolsó ellenőrzés: ")+employee.last_checked_at:"";
    stateBox.append(stateName,stateError,checked);
    const save=document.createElement("button");save.type="button";save.className="secondary-button";
    save.textContent=tr("Save","Mentés");
    const verify=document.createElement("button");verify.type="button";verify.className="secondary-button";
    verify.textContent=tr("Verify access","Hozzáférés ellenőrzése");
    save.addEventListener("click",async()=>{
      save.disabled=true;
      try{
        await api("/api/google-calendar/staff/"+encodeURIComponent(employee.user_id),{
          method:"PUT",body:JSON.stringify({calendar_id:idInput.value.trim(),enabled:toggle.checked,write_enabled:writeToggle.checked})
        });
        toast(tr("Employee calendar settings saved.","Munkatársi naptárbeállítások mentve."),"success");
        await renderStaffCalendarAdminPanel();
      }catch(error){save.disabled=false;toast(humanError(error),"error");}
    });
    verify.addEventListener("click",async()=>{
      verify.disabled=true;
      try{
        const result=await api("/api/google-calendar/staff/"+encodeURIComponent(employee.user_id)+"/verify",{method:"POST",body:"{}"});
        toast(result.error?
          tr("Google access missing: ","Hiányzó Google-hozzáférés: ")+result.error:
          tr("Calendar access verified.","Naptárhozzáférés ellenőrizve."),result.error?"error":"success");
        await renderStaffCalendarAdminPanel();
      }catch(error){verify.disabled=false;toast(humanError(error),"error");}
    });
    wrap.append(employeeLabel,idField,toggleLabel,writeLabel,stateBox,save,verify);list.appendChild(wrap);
  }
}

async function renderGoogleCalendarWritePanel() {
  const shell=document.querySelector(".system-integrations-v6-shell");if(!shell)return;
  shell.querySelector("#googleCalendarWritePanel")?.remove();
  const panel=document.createElement("section");panel.id="googleCalendarWritePanel";panel.className="panel";
  panel.style.marginTop="16px";
  const heading=document.createElement("h2");heading.textContent=tr("ERP ↔ Google Calendar · two-way synchronization","ERP ↔ Google Naptár · kétirányú szinkron");
  const help=document.createElement("p");help.className="muted";
  help.textContent=tr("The central read-only Google connection stays separate. The master write calendar is not assumed: enter the exact Google calendar ID and connect using the Klavierhaus Work Google account. Google changes are version checked and conflicts remain for manual review. Sync starts only after the administrator enables it.",
    "A meglévő, kizárólag olvasó Google-kapcsolat külön marad. A központi írható naptár nincs előre kitalálva: add meg a pontos Google-naptárazonosítót, és csatlakoztasd a Klavierhaus Work Google-fiókkal. A Google-változtatások verzióellenőrzéssel történnek; ütközés esetén kézi felülvizsgálat szükséges. Az írás csak adminisztrátori engedélyezés után indul.");
  panel.append(heading,help);shell.appendChild(panel);
  let status;
  try{status=await api("/api/google-calendar/write-status",{memoryCacheMs:0});}
  catch(error){const p=document.createElement("p");p.textContent=humanError(error);panel.appendChild(p);return;}
  const state=document.createElement("p");state.textContent=
    tr("Connection: ","Kapcsolat: ")+(status.connected?"CONNECTED":"DISCONNECTED")+
    " · "+tr("Publishing: ","Közzététel: ")+(status.enabled?"ENABLED":"DISABLED");
  panel.appendChild(state);
  const field=document.createElement("label");field.className="field";
  const label=document.createElement("span");label.textContent=tr("Master Google calendar ID (for example a corporate shared calendar, not necessarily the email address)","Központi Google-naptárazonosító (például céges megosztott naptár, nem feltétlenül az e-mail-cím)");
  const input=document.createElement("input");input.type="text";input.maxLength=320;
  input.placeholder=tr("Enter verified calendar ID","Add meg az ellenőrzött naptárazonosítót");
  input.value=status.calendar_id||"";field.append(label,input);panel.appendChild(field);
  const enabledLabel=document.createElement("label");enabledLabel.className="field";
  const enabled=document.createElement("input");enabled.type="checkbox";enabled.checked=Boolean(status.enabled);
  const enableText=document.createElement("span");enableText.textContent=tr("Enable two-way publishing (administrator opt-in)","Kétirányú írás engedélyezése (adminisztrátori döntés)");
  enabledLabel.append(enabled,enableText);panel.appendChild(enabledLabel);
  const actions=document.createElement("div");actions.className="form-actions";panel.appendChild(actions);
  async function action(button,fn){
    button.disabled=true;
    try{await fn();await renderGoogleCalendarWritePanel();}
    catch(error){button.disabled=false;toast(humanError(error),"error");}
  }
  function makeButton(text,fn){const button=document.createElement("button");button.type="button";button.className="secondary-button";button.textContent=text;button.addEventListener("click",()=>action(button,fn));actions.appendChild(button);}
  makeButton(tr("Save configuration","Beállítások mentése"),async()=>{
    await api("/api/google-calendar/write-config",{method:"PUT",body:JSON.stringify({calendar_id:input.value.trim(),enabled:enabled.checked})});
    toast(tr("Google calendar publishing settings saved.","A Google-naptár írási beállításai mentve."),"success");
  });
  makeButton(tr("Connect Google write access","Google írási jogosultság csatlakoztatása"),async()=>{
    const auth=await api("/api/google-calendar/write-auth-url",{memoryCacheMs:0});
    if(auth?.url)window.location.assign(auth.url);
  });
  makeButton(tr("Verify master calendar access","Központi naptár-hozzáférés ellenőrzése"),async()=>{
    const checked=await api("/api/google-calendar/write-verify",{method:"POST",body:JSON.stringify({calendar_id:input.value.trim()})});
    toast(tr("Calendar found: ","Naptár elérhető: ")+(checked.summary||checked.calendar_id),"success");
  });
  makeButton(tr("Run two-way sync","Kétirányú szinkron indítása"),async()=>{
    const result=await api("/api/google-calendar/write-sync",{method:"POST",body:"{}"});
    toast(tr("Synced: ","Szinkronizálva: ")+result.created_or_updated+
      tr(" · errors: "," · hiba: ")+result.failed,result.failed?"error":"success");
  });
  const issues=status.outbound_errors||[];
  if(issues.length){
    const warning=document.createElement("details");warning.open=true;
    const summary=document.createElement("summary");summary.textContent=tr("Calendar conflicts / errors","Naptárütközések / hibák")+" ("+issues.length+")";
    warning.appendChild(summary);
    for(const issue of issues){const line=document.createElement("p");line.className="muted";
      line.textContent=[issue.source_type,issue.source_id,issue.calendar_id,issue.last_error].filter(Boolean).join(" · ");
      warning.appendChild(line);
      if(status.enabled&&status.connected&&["CONFLICT","ERROR"].includes(issue.state)){
        for(const decision of ["ERP","GOOGLE"]){
          const button=document.createElement("button");button.type="button";button.className="secondary-button";
          button.style.margin="4px";
          button.textContent=decision==="ERP"?tr("Keep ERP version","ERP-változat megtartása"):
            tr("Use Google version","Google-változat átvétele");
          button.addEventListener("click",async()=>{
            const prompt=decision==="ERP"?
              tr("Overwrite the Google event with the current ERP data?","Felülírjuk a Google-eseményt az ERP jelenlegi adataival?"):
              tr("Replace the ERP appointment with the current Google event, if scheduling rules allow it?","Átvesszük a Google eseményét az ERP-be, amennyiben az ütemezési szabályok engedik?");
            if(!confirm(prompt))return;
            button.disabled=true;
            try{
              await api("/api/google-calendar/write-conflict/resolve",{method:"POST",
                body:JSON.stringify({source_type:issue.source_type,source_id:issue.source_id,
                  calendar_id:issue.calendar_id,decision})});
              toast(tr("Calendar conflict resolved.","Naptárütközés feloldva."),"success");
              await renderGoogleCalendarWritePanel();
            }catch(error){button.disabled=false;toast(humanError(error),"error");}
          });
          warning.appendChild(button);
        }
      }
    }
    panel.appendChild(warning);
  }
}
