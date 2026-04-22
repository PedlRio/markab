chrome.runtime.onMessage.addListener((e,n,s)=>{switch(e.type){case"GET_VAULT_STATUS":return s({type:"VAULT_STATUS_RESPONSE",payload:{connected:!1,lastSyncedAt:null}}),!0;default:return!1}});
