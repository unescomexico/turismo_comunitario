/* ══════════════════════════════════════════════════════
   CATÁLOGO EXPERIENCIAS TURÍSTICAS · MUNDO MAYA MÉXICO
   main.js — sin emojis, con Google Maps, con fixes UI
   ══════════════════════════════════════════════════════ */
'use strict';

const RUTA_COLOR = {
  'Arqueologia del Sur': '#18A7A8',
  'Ruta Puuc':           '#7B61A8',
  'Sierra Maya':         '#F28C28',
  'Guerra de Castas':    '#C23B7A',
};
// Normalize ruta names from CSV (may have accents)
function normRuta(r) {
  return (r||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace('Arqueolog\xeda','Arqueologia')
    .replace(/^\s+|\s+$/g,'');
}

const ESTADO_COLOR = {
  'Campeche':'#19B9C3','Chiapas':'#F59A23',
  'Quintana Roo':'#E72E87','Tabasco':'#C94B1E','Yucatan':'#8C6BBE','Yucatán':'#8C6BBE',
};

let ALL_DATA = [], MAP = null, markersLayer = null, userMarker = null;
let IMAGE_MANIFEST = {};

const CATEGORY_FALLBACK_IMAGES = [
  ['artesania', 'img/exp_bordado1.jpg'],
  ['gastronomia', 'img/hero_tortillas.jpg'],
  ['cacao', 'img/hero_cacao.jpg'],
  ['meliponicultura', 'img/hero_milpa.jpg'],
  ['arqueologia', 'img/hero_ruinas.jpg'],
  ['naturaleza', 'img/hero_grupo1.jpg'],
  ['agua', 'img/hero_grupo1.jpg'],
  ['senderismo', 'img/hero_hombre.jpg']
];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getExperienceImage(exp) {
  const entry = IMAGE_MANIFEST[exp.id];
  if (typeof entry === 'string') return entry;
  if (entry?.principal) return entry.principal;
  if (Array.isArray(entry?.galeria) && entry.galeria.length) return entry.galeria[0];
  return 'img/placeholder_experiencia.svg';
}

async function loadImageManifest() {
  try {
    const response = await fetch('imagenes/manifest_imagenes.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Manifest no disponible');
    IMAGE_MANIFEST = await response.json();
  } catch (error) {
    IMAGE_MANIFEST = {};
  }
}

// ── CSV PARSER ──
function parseCSV(text) {
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]);
  const rows = [];
  for (let i=1;i<lines.length;i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVRow(lines[i]);
    const obj = {};
    headers.forEach((h,idx)=>{ obj[h.trim()] = vals[idx]!==undefined ? vals[idx].trim() : ''; });
    rows.push(obj);
  }
  return rows;
}
function parseCSVRow(line) {
  const result=[]; let cur=''; let inQ=false;
  for (let i=0;i<line.length;i++) {
    const ch=line[i];
    if (ch==='"') { if (inQ&&line[i+1]==='"'){cur+='"';i++;}else{inQ=!inQ;} }
    else if (ch===','&&!inQ){result.push(cur);cur='';}
    else{cur+=ch;}
  }
  result.push(cur); return result;
}

// ── HAVERSINE ──
function haversine(lat1,lon1,lat2,lon2) {
  const R=6371, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function hasValidCoordinates(exp) {
  const lat = parseFloat(exp?.latitud), lon = parseFloat(exp?.longitud);
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function formatExperienceLocation(exp) {
  return [exp?.localidad, exp?.municipio, exp?.estado]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' · ');
}


// ── OPCIONES DE CONSULTA Y CONTRATACIÓN ──
// El CSV actual ya incluye correo y telefono. Si más adelante se agregan
// columnas como airbnb_url, expedia_url, booking_url, tripadvisor_url o web,
// se mostrarán automáticamente como enlaces externos de contratación.
const BOOKING_LINK_FIELDS = [
  ['airbnb_url','Airbnb'], ['airbnb','Airbnb'], ['link_airbnb','Airbnb'], ['perfil_airbnb','Airbnb'],
  ['expedia_url','Expedia'], ['expedia','Expedia'], ['link_expedia','Expedia'], ['perfil_expedia','Expedia'],
  ['booking_url','Booking'], ['booking','Booking'], ['booking_com','Booking'], ['link_booking','Booking'], ['perfil_booking','Booking'],
  ['tripadvisor_url','Tripadvisor'], ['tripadvisor','Tripadvisor'], ['link_tripadvisor','Tripadvisor'], ['perfil_tripadvisor','Tripadvisor'],
  ['viator_url','Viator'], ['viator','Viator'], ['link_viator','Viator'],
  ['getyourguide_url','GetYourGuide'], ['getyourguide','GetYourGuide'], ['link_getyourguide','GetYourGuide'],
  ['web','Sitio web'], ['sitio_web','Sitio web'], ['pagina_web','Sitio web'], ['website','Sitio web'],
  ['url_contratacion','Contratación'], ['link_contratacion','Contratación'], ['plataforma_contratacion','Contratación']
];


function splitEmails(value) {
  const seen = new Set();
  return (value || '')
    .split(/[;,\s]+/)
    .map(e => e.trim())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    .filter(e => {
      const key = e.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function extractPhones(value) {
  const raw = value || '';
  const matches = raw.match(/\+?\d[\d\s().-]{7,}\d/g) || [];
  const seen = new Set();
  return matches.map(phone => {
    let digits = phone.replace(/\D/g, '');
    if (digits.length === 10) digits = `52${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) digits = `52${digits.slice(1)}`;
    return { label: phone.trim(), digits };
  }).filter(p => {
    if (p.digits.length < 10 || seen.has(p.digits)) return false;
    seen.add(p.digits);
    return true;
  });
}

function externalLinks(exp) {
  const links = [];
  const seen = new Set();
  BOOKING_LINK_FIELDS.forEach(([field,label]) => {
    const value = (exp[field] || '').trim();
    if (!value || value.toLowerCase() === 'no aplica') return;
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ label, url });
  });
  return links;
}


function buildMailtoUrl(exp) {
  const emails = splitEmails(exp.correo);
  if (!emails.length) return '';
  const name = exp.nombre_experiencia || 'experiencia turística';
  const subject = `Consulta sobre ${name}`;
  const body = `Hola,\n\nMe gustaría solicitar información sobre la experiencia "${name}".\n\n¿Podrían compartirme disponibilidad, costos, duración del servicio y opciones de contratación?\n\nGracias.`;
  return `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}


function setEmailFallbackVisibility(experienceId, visible) {
  document.querySelectorAll('.booking-email-fallback').forEach(element => {
    if (element.dataset.experienceId === experienceId) element.hidden = !visible;
  });
}

function openEmailClient(event, experienceId) {
  event?.preventDefault();
  event?.stopPropagation();

  const exp = ALL_DATA.find(item => item.id === experienceId);
  if (!exp) return;

  const mailtoUrl = buildMailtoUrl(exp);
  if (!mailtoUrl) {
    setEmailFallbackVisibility(experienceId, true);
    return;
  }

  setEmailFallbackVisibility(experienceId, false);

  let browserLostFocus = false;
  const markHandled = () => { browserLostFocus = true; };
  const markHidden = () => {
    if (document.hidden) browserLostFocus = true;
  };

  window.addEventListener('blur', markHandled, { once: true });
  document.addEventListener('visibilitychange', markHidden);

  try {
    // Se ejecuta dentro del clic del usuario para que los navegadores permitan
    // abrir el manejador mailto configurado en el dispositivo.
    window.location.href = mailtoUrl;
  } catch (error) {
    console.warn('No fue posible abrir la aplicación de correo.', error);
    setEmailFallbackVisibility(experienceId, true);
  }

  window.setTimeout(() => {
    window.removeEventListener('blur', markHandled);
    document.removeEventListener('visibilitychange', markHidden);

    // Cuando no existe una aplicación predeterminada para mailto, algunos
    // navegadores no muestran ningún mensaje. En ese caso ofrecemos copiarlo.
    if (!browserLostFocus && document.visibilityState === 'visible') {
      setEmailFallbackVisibility(experienceId, true);
    }
  }, 2200);
}

async function copyExperienceEmail(event, experienceId) {
  event?.preventDefault();
  event?.stopPropagation();

  const exp = ALL_DATA.find(item => item.id === experienceId);
  const emailText = exp ? splitEmails(exp.correo).join('; ') : '';
  if (!emailText) return;

  const button = event?.currentTarget;
  let copied = false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(emailText);
      copied = true;
    }
  } catch (error) {
    console.warn('No fue posible usar el portapapeles moderno.', error);
  }

  if (!copied) {
    const textarea = document.createElement('textarea');
    textarea.value = emailText;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
    textarea.remove();
  }

  if (copied && button) {
    const previous = button.textContent;
    button.textContent = 'Correo copiado';
    window.setTimeout(() => { button.textContent = previous; }, 1800);
  } else if (!copied) {
    window.prompt('Selecciona y copia este correo:', emailText);
  }
}

window.openEmailClient = openEmailClient;
window.copyExperienceEmail = copyExperienceEmail;

function buildBookingActions(exp) {
  const emails = splitEmails(exp.correo);
  const phones = extractPhones(exp.telefono);
  const links = externalLinks(exp);
  const actions = [];

  if (emails.length) {
    actions.push(`<button type="button" class="booking-btn booking-btn--email" onclick="openEmailClient(event,'${escapeHtml(exp.id)}')">Solicitar información por correo</button>`);
  }
  if (phones.length) {
    const phone = phones[0];
    const text = encodeURIComponent(`Hola, me gustaría solicitar información sobre la experiencia "${exp.nombre_experiencia || ''}". ¿Podrían compartirme disponibilidad, costos y opciones de contratación?`);
    actions.push(`<a class="booking-btn booking-btn--whatsapp" href="https://wa.me/${phone.digits}?text=${text}" target="_blank" rel="noopener">Enviar WhatsApp</a>`);
  }
  links.forEach(link => {
    actions.push(`<a class="booking-btn booking-btn--external" href="${link.url}" target="_blank" rel="noopener">Contratar en ${link.label}</a>`);
  });

  if (!actions.length) {
    return `<div class="booking-empty">Por ahora no hay opciones de contratación directa registradas para esta experiencia. Revisa los datos de contacto disponibles o consulta al anfitrión.</div>`;
  }
  const emailFallback = emails.length ? `<div class="booking-email-fallback" data-experience-id="${escapeHtml(exp.id)}" hidden><span>No se detectó una aplicación de correo. Puedes copiar la dirección y escribir directamente al anfitrión.</span><strong>${escapeHtml(emails.join('; '))}</strong><button type="button" onclick="copyExperienceEmail(event,'${escapeHtml(exp.id)}')">Copiar correo</button></div>` : '';
  return `<div class="booking-actions-grid">${actions.join('')}</div>${emailFallback}<p class="booking-note">La contratación se realiza directamente con el anfitrión o con el servicio externo indicado. Confirma disponibilidad, costos y condiciones antes de viajar.</p>`;
}

function hasBookingActions(exp) {
  return splitEmails(exp.correo).length > 0 || extractPhones(exp.telefono).length > 0 || externalLinks(exp).length > 0;
}

// ── INIT ──
document.addEventListener('DOMContentLoaded',()=>{
  setupNavTabs();
  setupChat();
  setupStickyHeader();
  setupIntroModal();
  setupAboutScrollytelling();
  loadData().catch(handleMapLoadFailureV5);
  document.getElementById('chat-fab')?.addEventListener('click',openChat);
});

async function loadData() {
  await loadImageManifest();
  const res = await fetch('data.csv', { cache: 'no-store' });
  const text = await res.text();
  const clean = text.charCodeAt(0)===0xFEFF ? text.slice(1) : text;
  ALL_DATA = parseCSV(clean);
  ALL_DATA.forEach(e => { e._ruta = normRuta(e.ruta_maya); });
  initMap();
  setupResponsiveMapV5();
  buildCatalogo();
  buildIndicadores();
}

// ── MAPA ──
function initMap() {
  MAP = L.map('map',{center:[18.5,-90.5],zoom:6,zoomControl:true,attributionControl:false});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© OpenStreetMap contributors', maxZoom:18
  }).addTo(MAP);
  L.control.attribution({prefix:false, position:'bottomright'}).addTo(MAP);
  markersLayer = L.layerGroup().addTo(MAP);
  renderMarkers(ALL_DATA);
  setupMapControls();
}

function makeMarkerIcon(exp) {
  const color = RUTA_COLOR[exp._ruta] || '#888';
  return L.divIcon({
    html:`<div class="maya-marker" style="background:${color}"><div class="maya-marker-inner"></div></div>`,
    className:'', iconSize:[28,28], iconAnchor:[14,28], popupAnchor:[0,-32],
  });
}

function renderMarkers(data) {
  markersLayer.clearLayers();
  data.forEach(exp => {
    const lat=parseFloat(exp.latitud), lon=parseFloat(exp.longitud);
    if (isNaN(lat)||isNaN(lon)) return;
    const color = RUTA_COLOR[exp._ruta]||'#888';
    const marker = L.marker([lat,lon],{icon:makeMarkerIcon(exp)});
    marker.bindPopup(`
      <div class="map-popup">
        <span class="map-popup-ruta" style="color:${color}">${exp.ruta_maya}</span>
        <div class="map-popup-name">${exp.nombre_experiencia}</div>
        <div class="map-popup-loc">${exp.localidad}, ${exp.municipio}, ${exp.estado}</div>
        <button class="map-popup-btn" onclick="openFicha('${exp.id}')">Ver experiencia</button>
      </div>`,{maxWidth:280});
    marker.on('click',()=>openFicha(exp.id,false));
    markersLayer.addLayer(marker);
    exp._marker = marker;
  });
}

function setupMapControls() {
  // Búsqueda
  const input = document.getElementById('map-search-input');
  const results = document.getElementById('map-search-results');
  input.addEventListener('input',()=>{
    const q=input.value.toLowerCase().trim();
    if (!q){results.classList.remove('open');return;}
    const matches=ALL_DATA.filter(e=>
      e.nombre_experiencia.toLowerCase().includes(q)||
      e.localidad.toLowerCase().includes(q)||
      e.municipio.toLowerCase().includes(q)||
      e.estado.toLowerCase().includes(q)
    ).slice(0,8);
    results.innerHTML=matches.map(e=>`
      <div class="map-sr-item" onclick="flyToExp('${e.id}')">
        <strong>${e.nombre_experiencia}</strong>
        <span>${e.localidad}, ${e.estado}</span>
      </div>`).join('')||'<div class="map-sr-item">Sin resultados</div>';
    results.classList.add('open');
  });
  document.addEventListener('click',e=>{ if (!e.target.closest('.map-search-wrap')) results.classList.remove('open'); });

  // Filtros ruta
  document.querySelectorAll('.map-filter-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.map-filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const ruta=btn.dataset.ruta;
      renderMarkers(ruta==='all' ? ALL_DATA : ALL_DATA.filter(e=>e._ruta===ruta));
    });
  });

  // Ubicación
  document.getElementById('btn-locate').addEventListener('click',locateUser);

  // Welcome ruta clicks
  document.querySelectorAll('.wr-item[data-ruta]').forEach(el=>{
    el.addEventListener('click',()=>{
      const ruta=el.dataset.ruta;
      switchView('mapa');
      document.querySelectorAll('.map-filter-btn').forEach(b=>b.classList.toggle('active',b.dataset.ruta===ruta));
      renderMarkers(ALL_DATA.filter(e=>e._ruta===ruta));
    });
  });
}

function flyToExp(id) {
  const exp=ALL_DATA.find(e=>e.id===id); if (!exp) return;
  MAP.flyTo([parseFloat(exp.latitud),parseFloat(exp.longitud)],12,{duration:1.2});
  if (exp._marker) exp._marker.openPopup();
  document.getElementById('map-search-results').classList.remove('open');
  document.getElementById('map-search-input').value=exp.nombre_experiencia;
  openFicha(id,false);
}
window.flyToExp=flyToExp;

function locateUser() {
  if (!navigator.geolocation){alert('Tu navegador no soporta geolocalizacion.');return;}
  navigator.geolocation.getCurrentPosition(pos=>{
    const {latitude:lat,longitude:lon}=pos.coords;
    if (userMarker) MAP.removeLayer(userMarker);
    userMarker=L.marker([lat,lon],{pane:MAP_PANES.user,zIndexOffset:6000,icon:L.divIcon({html:'<div class="user-location-marker"></div>',className:'',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(MAP);
    userMarker.bindPopup('<div style="color:#fff;font-weight:600;font-size:.83rem">Tu ubicacion</div>');
    MAP.flyTo([lat,lon],10,{duration:1.5});
    const nearby=ALL_DATA.map(e=>({...e,dist:haversine(lat,lon,parseFloat(e.latitud),parseFloat(e.longitud))})).sort((a,b)=>a.dist-b.dist).slice(0,5);
    showNearbyBanner(nearby);
  },()=>{alert('No se pudo obtener tu ubicacion. Verifica los permisos.');});
}

function showNearbyBanner(nearby) {
  const wi=document.querySelector('.panel-welcome-inner');
  const ex=wi.querySelector('.nearby-banner'); if(ex) ex.remove();
  const b=document.createElement('div'); b.className='nearby-banner';
  b.innerHTML=`
    <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:1px;color:var(--gris);margin-bottom:8px;font-weight:700;">Experiencias mas cercanas</div>
    ${nearby.map(e=>`<div class="nearby-item" onclick="flyToExp('${e.id}')" style="margin-bottom:5px">
      <div class="nearby-item-left">
        <div class="nearby-item-name">${e.nombre_experiencia}</div>
        <div class="nearby-item-loc">${e.localidad}, ${e.estado}</div>
      </div>
      <div class="nearby-item-dist">${e.dist.toFixed(0)} km</div>
    </div>`).join('')}`;
  wi.appendChild(b);
}

// ── FICHA ──
function openFicha(id, flyTo=true) {
  const exp=ALL_DATA.find(e=>e.id===id); if (!exp) return;
  const color=RUTA_COLOR[exp._ruta]||'#888';
  const tipos=(exp.tipo_actividad||'').split('|').map(t=>t.trim()).filter(Boolean);

  document.getElementById('ficha-ruta-badge').textContent=`Ruta: ${exp.ruta_maya}`;
  document.getElementById('ficha-ruta-badge').style.cssText=
    `background:${color}18;color:${color};border:1px solid ${color}30;padding:2px 9px;border-radius:2px;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;`;
  document.getElementById('ficha-title').textContent=exp.nombre_experiencia;
  document.getElementById('ficha-location').textContent=`${exp.localidad} - ${exp.municipio}, ${exp.estado}`;

  const tagsEl=document.getElementById('ficha-tags');
  tagsEl.innerHTML=tipos.map(t=>`<span class="ficha-tag">${t}</span>`).join('');

  document.getElementById('ficha-desc').innerHTML=(cleanText(exp.descripcion_experiencia)||'Informacion no disponible.') + sourceNoteIfIncomplete(exp.descripcion_experiencia);

  const anf=cleanText(exp.anfitrion)||'';
  document.getElementById('ficha-anf').innerHTML=anf
    ?`<strong style="display:block;margin-bottom:3px;font-size:.62rem;text-transform:uppercase;letter-spacing:.8px;color:var(--gris)">Anfitrion</strong>${anf}${sourceNoteIfIncomplete(exp.anfitrion)}`
    :'<em style="color:var(--gris);font-size:.83rem">Informacion no disponible</em>';

  document.getElementById('ficha-servicios').textContent=exp.servicios_incluidos||'-';
  document.getElementById('ficha-capacidad').textContent=exp.capacidad_grupo||'-';

  const bookingSection=document.getElementById('ficha-booking-section');
  const bookingEl=document.getElementById('ficha-booking');
  if (bookingEl) bookingEl.innerHTML=buildBookingActions(exp);
  if (bookingSection) bookingSection.style.display='';

  // Patrimonio
  const patr=document.getElementById('ficha-patrimonio');
  const items=[];
  if (exp.patrimonio_material&&!exp.patrimonio_material.toLowerCase().includes('aplica'))
    items.push({tipo:'Material',val:exp.patrimonio_material});
  if (exp.patrimonio_inmaterial&&!exp.patrimonio_inmaterial.toLowerCase().includes('aplica'))
    items.push({tipo:'Inmaterial',val:exp.patrimonio_inmaterial});
  if (exp.patrimonio_natural&&!exp.patrimonio_natural.toLowerCase().includes('aplica'))
    items.push({tipo:'Natural',val:exp.patrimonio_natural});
  patr.innerHTML=items.length
    ?items.map(i=>`<div class="patrimonio-item"><div class="patrimonio-text"><strong>${i.tipo}</strong>${cleanText(i.val)}</div></div>`).join('')
    :'<p style="font-size:.82rem;color:var(--gris)">No especificado.</p>';

  // Impacto
  const imp=document.getElementById('ficha-impacto');
  const impItems=[];
  if (exp.se_fomenta) impItems.push({l:'Fomenta',v:exp.se_fomenta});
  if (exp.se_promueve) impItems.push({l:'Promueve',v:exp.se_promueve});
  if (exp.personas_involucradas) impItems.push({l:'Comunidad',v:exp.personas_involucradas});
  imp.innerHTML=impItems.map(i=>`<div class="impacto-item"><strong>${i.l}</strong>${cleanText(i.v)}</div>`).join('');
  document.getElementById('ficha-impacto-section').style.display=impItems.length?'':'none';

  // Cercanas
  const lat=parseFloat(exp.latitud),lon=parseFloat(exp.longitud);
  const nearby=ALL_DATA.filter(e=>e.id!==exp.id&&(e.estado===exp.estado||e._ruta===exp._ruta))
    .map(e=>({...e,dist:haversine(lat,lon,parseFloat(e.latitud),parseFloat(e.longitud))}))
    .sort((a,b)=>a.dist-b.dist).slice(0,4);
  document.getElementById('nearby-list').innerHTML=nearby.map(e=>`
    <div class="nearby-item" onclick="openFicha('${e.id}')">
      <div class="nearby-item-left">
        <div class="nearby-item-name">${e.nombre_experiencia}</div>
        <div class="nearby-item-loc">${e.localidad}, ${e.estado}</div>
      </div>
      <div class="nearby-item-dist">${e.dist.toFixed(0)} km</div>
    </div>`).join('');

  // Como llegar — Google Maps link
  const mapsEl=document.getElementById('ficha-maps-link');
  if (!isNaN(lat)&&!isNaN(lon)) {
    const query=encodeURIComponent(`${exp.nombre_experiencia}, ${exp.localidad}, ${exp.estado}, Mexico`);
    mapsEl.innerHTML=`
      <a class="maps-link-btn" href="https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=" target="_blank" rel="noopener">
        Ver en Google Maps
      </a>
      <p style="font-size:.72rem;color:var(--gris);margin-top:8px;line-height:1.5">
        La ubicacion es referencial a nivel localidad. Confirma la direccion exacta con el anfitrion antes de tu visita.
      </p>`;
  } else {
    mapsEl.innerHTML='<p style="font-size:.82rem;color:var(--gris)">Contacta al anfitrion para obtener indicaciones.</p>';
  }

  // Contacto
  const contact=document.getElementById('ficha-contact');
  const rows=[];
  if (exp.telefono) rows.push(`<div class="contact-row"><span class="contact-label">Tel.</span><span class="contact-val">${exp.telefono}</span></div>`);
  if (exp.correo) {
    const emails=exp.correo.split(';').map(e=>e.trim()).filter(Boolean);
    rows.push(`<div class="contact-row"><span class="contact-label">Correo</span><span class="contact-val">${emails.map(e=>`<a href="mailto:${e}">${e}</a>`).join('<br>')}</span></div>`);
  }
  if (exp.facebook) rows.push(`<div class="contact-row"><span class="contact-label">Facebook</span><span class="contact-val">${exp.facebook}</span></div>`);
  if (exp.instagram) rows.push(`<div class="contact-row"><span class="contact-label">Instagram</span><span class="contact-val">${exp.instagram}</span></div>`);
  contact.innerHTML=rows.join('')||'<p style="font-size:.82rem;color:var(--gris)">Sin datos de contacto.</p>';

  document.getElementById('panel-welcome').style.display='none';
  document.getElementById('panel-ficha').style.display='flex';
  document.getElementById('panel-ficha').style.flexDirection='column';

  if (flyTo&&!isNaN(lat)&&!isNaN(lon)) {
    MAP.flyTo([lat,lon],11,{duration:1.0});
    if (exp._marker) exp._marker.openPopup();
  }
}
window.openFicha=openFicha;

document.getElementById('ficha-back')?.addEventListener('click', closeFichaV6);

// ── CATALOGO ──
function buildCatalogo() {
  renderCatGrid(ALL_DATA);
  document.getElementById('cat-search').addEventListener('input',filterCatalogo);
  document.getElementById('cat-estado').addEventListener('change',filterCatalogo);
  document.getElementById('cat-ruta').addEventListener('change',filterCatalogo);
  document.getElementById('cat-tipo').addEventListener('change',filterCatalogo);
  document.getElementById('cat-drawer-overlay').addEventListener('click',closeCatDrawer);
  document.getElementById('cat-drawer-close').addEventListener('click',closeCatDrawer);
}

function filterCatalogo() {
  const q=document.getElementById('cat-search').value.toLowerCase().trim();
  const estado=document.getElementById('cat-estado').value;
  const ruta=document.getElementById('cat-ruta').value;
  const tipo=document.getElementById('cat-tipo').value;
  const result=ALL_DATA.filter(e=>{
    if (q&&!e.nombre_experiencia.toLowerCase().includes(q)&&
           !e.localidad.toLowerCase().includes(q)&&
           !e.municipio.toLowerCase().includes(q)&&
           !e.estado.toLowerCase().includes(q)&&
           !(e.descripcion_experiencia||'').toLowerCase().includes(q)&&
           !(e.descripcion_corta||'').toLowerCase().includes(q)&&
           !(e.anfitrion||'').toLowerCase().includes(q)) return false;
    if (estado&&e.estado!==estado&&normStr(e.estado)!==normStr(estado)) return false;
    if (ruta&&e._ruta!==normRuta(ruta)) return false;
    if (tipo&&!normStr(e.tipo_actividad).toLowerCase().includes(normStr(tipo).toLowerCase().split('/')[0].trim())) return false;
    return true;
  });
  renderCatGrid(result);
  document.getElementById('cat-count').textContent=`${result.length} experiencia${result.length!==1?'s':''}`;
}

function normStr(s){ return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

function renderCatGrid(data) {
  const grid=document.getElementById('catalogo-grid');
  if (!data.length){
    grid.innerHTML='<div class="cat-empty"><p>Sin resultados para estos filtros</p></div>';
    return;
  }
  grid.innerHTML=data.map(exp=>{
    const color=EXPERIENCE_MARKER_COLOR_V4 || '#08745A';
    const tipos=(exp.tipo_actividad||'').split('|').map(t=>t.trim()).filter(Boolean);
    const image=getExperienceImage(exp);
    const shortDescription=exp.descripcion_corta || exp.servicios_incluidos || exp.descripcion || exp.descripcion_experiencia || '';
    return `
      <article class="cat-card" style="--route-color:${color}" onclick="openCatDrawer('${escapeHtml(exp.id)}')" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openCatDrawer('${escapeHtml(exp.id)}')}">
        <div class="cat-card-media" style="background-image:linear-gradient(180deg,rgba(5,30,21,.04),rgba(5,30,21,.78)),url(&quot;${escapeHtml(image)}&quot;)">
          <span class="cat-card-state">${escapeHtml(exp.estado)}</span>
        </div>
        <div class="cat-card-body">
          <h3 class="cat-card-name">${escapeHtml(exp.nombre_experiencia)}</h3>
          <div class="cat-card-loc">${escapeHtml(formatExperienceLocation(exp))}</div>
          <p class="cat-card-description">${escapeHtml(shortDescription)}</p>
          <div class="cat-card-tags">${tipos.slice(0,2).map(t=>`<span class="cat-card-tag">${escapeHtml(t)}</span>`).join('')}</div>
          <div class="cat-card-footer">
            <span class="cat-card-booking">${hasBookingActions(exp)?'Consulta disponible':'Conoce la experiencia'}</span>
            <span class="cat-card-cta">Ver ficha</span>
          </div>
        </div>
      </article>`;
  }).join('');
}
function openCatDrawer(id) {
  const exp=ALL_DATA.find(e=>e.id===id); if (!exp) return;
  const color=RUTA_COLOR[exp._ruta]||'#888';
  const tipos=(exp.tipo_actividad||'').split('|').map(t=>t.trim()).filter(Boolean);
  const lat=parseFloat(exp.latitud),lon=parseFloat(exp.longitud);
  let mapsHtml='';
  if (!isNaN(lat)&&!isNaN(lon)){
    const query=encodeURIComponent(`${exp.nombre_experiencia}, ${exp.localidad}, ${exp.estado}, Mexico`);
    mapsHtml=`<a class="maps-link-btn" href="https://www.google.com/maps/search/?api=1&query=${query}" target="_blank" rel="noopener">Ver en Google Maps</a>
    <p style="font-size:.72rem;color:var(--gris);margin-top:8px;line-height:1.5">Ubicación referencial a nivel localidad. Confirma con el anfitrión.</p>`;
  }
  const rows=[];
  if (exp.telefono) rows.push(`<div class="contact-row"><span class="contact-label">Tel.</span><span class="contact-val">${exp.telefono}</span></div>`);
  if (exp.correo){const emails=exp.correo.split(';').map(e=>e.trim()).filter(Boolean);rows.push(`<div class="contact-row"><span class="contact-label">Correo</span><span class="contact-val">${emails.map(e=>`<a href="mailto:${e}">${e}</a>`).join('<br>')}</span></div>`);}
  if (exp.facebook) rows.push(`<div class="contact-row"><span class="contact-label">Facebook</span><span class="contact-val">${exp.facebook}</span></div>`);
  if (exp.instagram) rows.push(`<div class="contact-row"><span class="contact-label">Instagram</span><span class="contact-val">${exp.instagram}</span></div>`);
  const bookingHtml = buildBookingActions(exp);
  const experienceImage = getExperienceImage(exp);

  document.getElementById('cat-drawer-content').innerHTML=`
    <div class="cat-drawer-hero" style="background-image:linear-gradient(180deg,rgba(5,30,21,.05),rgba(5,30,21,.68)),url(&quot;${escapeHtml(experienceImage)}&quot;)"></div>
    <div class="ficha-header" style="padding:52px 24px 16px;border-bottom:1px solid var(--borde);">
      <h2 class="ficha-title">${exp.nombre_experiencia}</h2>
      <p class="ficha-location">${exp.localidad} - ${exp.municipio}, ${exp.estado}</p>
      <div class="ficha-tags">${tipos.map(t=>`<span class="ficha-tag">${t}</span>`).join('')}</div>
    </div>
    <div class="ficha-body" style="padding:16px 24px 40px;overflow:visible;">
      <section class="ficha-section">
        <h3 class="ficha-section-title">La experiencia</h3>
        <p class="ficha-desc">${cleanText(exp.descripcion || exp.descripcion_experiencia)||'Información no disponible.'}${sourceNoteIfIncomplete(exp.descripcion || exp.descripcion_experiencia)}</p>
      </section>
      ${cleanText(exp.anfitrion)?`<section class="ficha-section"><h3 class="ficha-section-title">Anfitrión</h3><div class="ficha-anf">${cleanText(exp.anfitrion)}${sourceNoteIfIncomplete(exp.anfitrion)}</div></section>`:''}
      <section class="ficha-section ficha-meta-grid">
        <div class="ficha-meta-item"><span class="ficha-meta-label">Servicios</span><span class="ficha-meta-value">${exp.servicios_incluidos||'-'}</span></div>
        <div class="ficha-meta-item"><span class="ficha-meta-label">Capacidad</span><span class="ficha-meta-value">${exp.capacidad_grupo||'-'}</span></div>
      </section>
      <section class="ficha-section ficha-booking-section">
        <h3 class="ficha-section-title">Consulta y contratación</h3>
        <div class="booking-actions">${bookingHtml}</div>
      </section>
      <section class="ficha-section ficha-como-llegar">
        <h3 class="ficha-section-title">Cómo llegar</h3>
        ${mapsHtml||'<p style="font-size:.82rem;color:var(--gris)">Contacta al anfitrión para indicaciones.</p>'}
      </section>
      ${rows.length?`<section class="ficha-section ficha-contact"><h3 class="ficha-section-title">Contacto</h3><div class="contact-grid">${rows.join('')}</div></section>`:''}
      <div style="margin-top:20px;padding:12px;background:var(--papel);border-radius:var(--r-md);display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:.82rem;color:var(--gris)">Ver en el mapa interactivo</span>
        <button onclick="switchView('mapa');setTimeout(()=>flyToExp('${exp.id}'),250)" 
          style="padding:7px 14px;background:var(--cafe-oscuro);color:var(--crema);border:none;border-bottom:2px solid var(--ocre);border-radius:var(--r-md);font-size:.78rem;font-weight:600;cursor:pointer;font-family:var(--font-body)">
          Ver en mapa
        </button>
      </div>
    </div>`;
  document.getElementById('cat-drawer').classList.add('open');
}
window.openCatDrawer=openCatDrawer;
function closeCatDrawer(){ document.getElementById('cat-drawer').classList.remove('open'); }

// ── INDICADORES ──
function buildIndicadores() {
  if (!ALL_DATA.length || typeof Chart === 'undefined') return;

  const CATEGORY_CONFIG_V8 = [
    { label: 'Historia y arqueología', color: '#18A7A8', metric: 'about-metric-historia' },
    { label: 'Naturaleza', color: '#1F6B4A', metric: 'about-metric-naturaleza' },
    { label: 'Senderismo', color: '#7A9A3B', metric: 'about-metric-senderismo' },
    { label: 'Artesanía', color: '#7B61A8', metric: 'about-metric-artesania' },
    { label: 'Gastronomía', color: '#A85C35', metric: 'about-metric-gastronomia' },
    { label: 'Meliponicultura', color: '#D39B16', metric: 'about-metric-meliponicultura' },
  ];
  const CATEGORY_BY_LABEL_V8 = Object.fromEntries(CATEGORY_CONFIG_V8.map(item => [item.label, item]));
  const unique = values => [...new Set(values.filter(Boolean))];
  const states = unique(ALL_DATA.map(exp => exp.estado)).sort((a,b) => a.localeCompare(b, 'es'));
  const categoriesFor = exp => exp._tipos || (exp.tipo_actividad || '').split('|').map(item => item.trim()).filter(Boolean);
  const categoryCount = (data, category) => data.filter(exp => categoriesFor(exp).includes(category)).length;
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };

  setText('about-metric-experiencias', ALL_DATA.length);
  CATEGORY_CONFIG_V8.forEach(item => setText(item.metric, categoryCount(ALL_DATA, item.label)));

  const categorySelect = document.getElementById('dashboard-category-filter');
  const stateSelect = document.getElementById('dashboard-state-filter');
  const chips = document.getElementById('dashboard-category-chips');
  const reset = document.getElementById('dashboard-reset');
  const prev = document.getElementById('dashboard-prev');
  const next = document.getElementById('dashboard-next');
  if (!categorySelect || !stateSelect || !chips) return;

  categorySelect.innerHTML = '<option value="">Todas las categorías</option>' + CATEGORY_CONFIG_V8
    .map(item => `<option value="${escapeHtml(item.label)}">${escapeHtml(item.label)}</option>`).join('');
  stateSelect.innerHTML = '<option value="">Todos los estados</option>' + states
    .map(state => `<option value="${escapeHtml(state)}">${escapeHtml(state)}</option>`).join('');
  chips.innerHTML = [
    `<button type="button" class="dashboard-category-chip is-active" data-category=""><span>Todas</span><strong>${ALL_DATA.length}</strong></button>`,
    ...CATEGORY_CONFIG_V8.map(item => `<button type="button" class="dashboard-category-chip" data-category="${escapeHtml(item.label)}" style="--category-color:${item.color}"><span>${escapeHtml(item.label)}</span><strong>${categoryCount(ALL_DATA, item.label)}</strong></button>`)
  ].join('');

  let selectedCategory = '';
  let selectedState = '';
  let previewIndex = Math.floor(Math.random() * ALL_DATA.length);
  let currentPreviewData = ALL_DATA.slice();
  let stateChart = null;
  let categoryChart = null;
  let heritageChart = null;

  const destroyExistingChart = id => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const chart = Chart.getChart(canvas);
    if (chart) chart.destroy();
  };
  ['chart-estado','chart-tipo','chart-patrimonio'].forEach(destroyExistingChart);

  const getFilteredData = () => ALL_DATA.filter(exp => {
    if (selectedCategory && !categoriesFor(exp).includes(selectedCategory)) return false;
    if (selectedState && normStr(exp.estado).toLowerCase() !== normStr(selectedState).toLowerCase()) return false;
    return true;
  });

  const updateActiveControls = () => {
    categorySelect.value = selectedCategory;
    stateSelect.value = selectedState;
    document.querySelectorAll('.dashboard-category-chip').forEach(button => {
      button.classList.toggle('is-active', button.dataset.category === selectedCategory);
    });
    document.querySelectorAll('.about-metric-card').forEach(button => {
      button.classList.toggle('is-active', (button.dataset.dashboardCategory || '') === selectedCategory);
    });
  };

  const renderPreview = data => {
    const container = document.getElementById('dashboard-experience-preview');
    const position = document.getElementById('dashboard-position');
    const heading = document.getElementById('dashboard-experience-heading');
    if (!container || !position) return;

    currentPreviewData = data;
    if (!data.length) {
      previewIndex = 0;
      position.textContent = '0 / 0';
      if (heading) heading.textContent = 'Sin experiencias en esta selección';
      container.innerHTML = `<div class="dashboard-empty"><strong>No hay resultados</strong><p>Prueba otra combinación de categoría y estado.</p></div>`;
      return;
    }

    previewIndex = ((previewIndex % data.length) + data.length) % data.length;
    const exp = data[previewIndex];
    const image = getExperienceImage(exp);
    const types = categoriesFor(exp);
    const description = cleanText(exp.descripcion_corta || exp.descripcion || exp.descripcion_experiencia || '');
    position.textContent = `${previewIndex + 1} / ${data.length}`;
    if (heading) heading.textContent = exp.nombre_experiencia || 'Experiencia destacada';
    container.innerHTML = `
      <div class="dashboard-preview-image">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(exp.nombre_experiencia)}" loading="lazy">
        <span>${escapeHtml(exp.estado)}</span>
      </div>
      <div class="dashboard-preview-copy">
        <p class="dashboard-preview-location">${escapeHtml(exp.localidad)} · ${escapeHtml(exp.municipio)}</p>
        <h4>${escapeHtml(exp.nombre_experiencia)}</h4>
        <div class="dashboard-preview-tags">${types.map(type => `<span>${escapeHtml(type)}</span>`).join('')}</div>
        <p>${escapeHtml(description)}</p>
        <div class="dashboard-preview-actions">
          <button type="button" onclick="openDashboardExperienceV8('${escapeHtml(exp.id)}')">Ver ficha completa</button>
          ${hasValidCoordinates(exp) ? `<button type="button" class="is-secondary" onclick="switchView('mapa');setTimeout(()=>flyToExp('${escapeHtml(exp.id)}'),220)">Ver en el mapa</button>` : ''}
        </div>
      </div>`;
  };

  const updateCharts = () => {
    const filtered = getFilteredData();
    const selectionTitle = document.getElementById('dashboard-selection-title');
    const selectionSummary = document.getElementById('dashboard-selection-summary');
    const titleParts = [selectedCategory, selectedState].filter(Boolean);
    if (selectionTitle) selectionTitle.textContent = titleParts.length ? titleParts.join(' · ') : 'Todas las experiencias';
    if (selectionSummary) {
      const stateCount = unique(filtered.map(exp => exp.estado)).length;
      selectionSummary.textContent = `${filtered.length} experiencia${filtered.length === 1 ? '' : 's'} en ${stateCount} estado${stateCount === 1 ? '' : 's'}`;
    }

    updateActiveControls();

    const stateBase = selectedCategory
      ? ALL_DATA.filter(exp => categoriesFor(exp).includes(selectedCategory))
      : ALL_DATA;
    const stateCounts = states.map(state => stateBase.filter(exp => normStr(exp.estado).toLowerCase() === normStr(state).toLowerCase()).length);
    const stateColors = states.map(state => normStr(state).toLowerCase() === normStr(selectedState).toLowerCase() ? '#D39B16' : '#1F6B4A');
    if (stateChart) stateChart.destroy();
    stateChart = new Chart(document.getElementById('chart-estado'), {
      type: 'bar',
      data: { labels: states, datasets: [{ data: stateCounts, backgroundColor: stateColors, borderRadius: 8, borderSkipped: false }] },
      options: {
        ...chartOpts(),
        onClick: (_event, elements) => {
          if (!elements.length) return;
          const state = states[elements[0].index];
          selectedState = selectedState === state ? '' : state;
          previewIndex = 0;
          updateCharts();
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw} experiencias · clic para filtrar` } } },
      },
    });

    const categoryBase = selectedState
      ? ALL_DATA.filter(exp => normStr(exp.estado).toLowerCase() === normStr(selectedState).toLowerCase())
      : ALL_DATA;
    const categoryValues = CATEGORY_CONFIG_V8.map(item => categoryCount(categoryBase, item.label));
    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(document.getElementById('chart-tipo'), {
      type: 'doughnut',
      data: {
        labels: CATEGORY_CONFIG_V8.map(item => item.label),
        datasets: [{
          data: categoryValues,
          backgroundColor: CATEGORY_CONFIG_V8.map(item => item.color),
          borderWidth: CATEGORY_CONFIG_V8.map(item => item.label === selectedCategory ? 5 : 2),
          borderColor: CATEGORY_CONFIG_V8.map(item => item.label === selectedCategory ? '#183D31' : '#FFFFFF'),
          hoverOffset: 10,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        onClick: (_event, elements) => {
          if (!elements.length) return;
          const category = CATEGORY_CONFIG_V8[elements[0].index].label;
          selectedCategory = selectedCategory === category ? '' : category;
          previewIndex = 0;
          updateCharts();
        },
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: "'DM Sans'", size: 11 }, padding: 12, boxWidth: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} experiencias · clic para filtrar` } },
        },
      },
    });

    const heritage = [
      ['Material', filtered.filter(exp => hasPatrimonio(exp.patrimonio_material)).length, '#0B5FA5'],
      ['Inmaterial', filtered.filter(exp => hasPatrimonio(exp.patrimonio_inmaterial)).length, '#D39B16'],
      ['Natural', filtered.filter(exp => hasPatrimonio(exp.patrimonio_natural)).length, '#1F6B4A'],
    ];
    if (heritageChart) heritageChart.destroy();
    heritageChart = new Chart(document.getElementById('chart-patrimonio'), {
      type: 'polarArea',
      data: {
        labels: heritage.map(item => item[0]),
        datasets: [{ data: heritage.map(item => item[1]), backgroundColor: heritage.map(item => `${item[2]}CC`), borderColor: '#FFFFFF', borderWidth: 2 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { r: { ticks: { display: false }, grid: { color: 'rgba(31,26,22,.08)' } } },
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: "'DM Sans'", size: 11 }, padding: 12, boxWidth: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} experiencias` } },
        },
      },
    });

    renderPreview(filtered);
  };

  categorySelect.addEventListener('change', () => {
    selectedCategory = categorySelect.value;
    previewIndex = 0;
    updateCharts();
  });
  stateSelect.addEventListener('change', () => {
    selectedState = stateSelect.value;
    previewIndex = 0;
    updateCharts();
  });
  chips.addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    selectedCategory = button.dataset.category || '';
    previewIndex = 0;
    updateCharts();
  });
  reset?.addEventListener('click', () => {
    selectedCategory = '';
    selectedState = '';
    previewIndex = Math.floor(Math.random() * ALL_DATA.length);
    updateCharts();
  });
  prev?.addEventListener('click', () => {
    if (!currentPreviewData.length) return;
    previewIndex = (previewIndex - 1 + currentPreviewData.length) % currentPreviewData.length;
    renderPreview(currentPreviewData);
  });
  next?.addEventListener('click', () => {
    if (!currentPreviewData.length) return;
    previewIndex = (previewIndex + 1) % currentPreviewData.length;
    renderPreview(currentPreviewData);
  });

  document.querySelectorAll('.about-metric-card').forEach(button => {
    button.addEventListener('click', () => {
      selectedCategory = button.dataset.dashboardCategory || '';
      previewIndex = 0;
      updateCharts();
      document.getElementById('about-dashboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  updateCharts();
}

function openDashboardExperienceV8(expId) {
  switchView('catalogo');
  window.setTimeout(() => openCatDrawer(expId), 180);
}
window.openDashboardExperienceV8 = openDashboardExperienceV8;

function hasPatrimonio(value){
  const v=(value||'').toLowerCase().trim();
  return Boolean(v && !v.includes('no aplica') && v !== 'na' && v !== 'n/a');
}
function chartOpts(){
  return{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>` ${ctx.raw} experiencias`}}},scales:{x:{grid:{color:'rgba(31,26,22,.06)'},ticks:{font:{family:"'DM Sans'",size:11}}},y:{grid:{color:'rgba(31,26,22,.06)'},ticks:{font:{family:"'DM Sans'",size:11}}}}};
}
function groupCount(data,field){const m={};data.forEach(e=>{const v=e[field];m[v]=(m[v]||0)+1;});return Object.fromEntries(Object.entries(m).sort((a,b)=>b[1]-a[1]));}

// ── NAV ──
function setupNavTabs() {
  document.querySelectorAll('.nav-tab').forEach(tab=>{
    tab.addEventListener('click',()=>switchView(tab.dataset.view));
  });
}
function switchView(id) {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>{
    const active=t.dataset.view===id;
    t.classList.toggle('active',active);
    t.setAttribute('aria-selected',active?'true':'false');
  });
  document.getElementById(`view-${id}`)?.classList.add('active');
  document.getElementById('site-chrome')?.classList.toggle('is-about-view', id === 'descubre');
  window.scrollTo({top:0,behavior:'auto'});
  updateStickyHeaderState();
  if (id==='mapa'&&MAP) scheduleMapResizeV5(80);
  if (id==='catalogo') window.requestAnimationFrame(() => syncCatalogFiltersMobileV7());
}
window.switchView=switchView;

function openCatalogCategory(category) {
  switchView('catalogo');
  window.setTimeout(()=>{
    const select=document.getElementById('cat-tipo');
    if (select) select.value=category;
    filterCatalogo();
  },120);
}
window.openCatalogCategory=openCatalogCategory;


function setupIntroModal() {
  const modal=document.getElementById('intro-modal');
  const openBtn=document.getElementById('open-intro');
  const closeBtn=document.getElementById('intro-close');
  const backdrop=document.getElementById('intro-backdrop');
  const mapBtn=document.getElementById('intro-explore-map');
  const catalogBtn=document.getElementById('intro-explore-catalog');

  const open=()=>{
    modal?.classList.add('open');
    modal?.setAttribute('aria-hidden','false');
    document.body.classList.add('intro-is-open');
    window.setTimeout(()=>closeBtn?.focus(),80);
  };
  const close=()=>{
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden','true');
    document.body.classList.remove('intro-is-open');
  };

  openBtn?.addEventListener('click',open);
  closeBtn?.addEventListener('click',close);
  backdrop?.addEventListener('click',close);
  mapBtn?.addEventListener('click',()=>{close();switchView('mapa');});
  catalogBtn?.addEventListener('click',()=>{close();switchView('catalogo');});
  document.addEventListener('keydown',event=>{
    if (event.key==='Escape'&&modal?.classList.contains('open')) close();
  });

  window.setTimeout(open,120);
}

function setupAboutScrollytelling() {
  const steps=[...document.querySelectorAll('.story-step')];
  const visual=document.getElementById('story-visual');
  const index=document.getElementById('story-visual-index');
  const kicker=document.getElementById('story-visual-kicker');
  const title=document.getElementById('story-visual-title');
  if (!steps.length||!visual) return;

  const activate=step=>{
    steps.forEach(item=>item.classList.toggle('is-active',item===step));
    visual.style.backgroundImage=`url("${step.dataset.storyImage}")`;
    if(index) index.textContent=step.dataset.storyIndex||'';
    if(kicker) kicker.textContent=step.dataset.storyKicker||'';
    if(title) title.textContent=step.dataset.storyTitle||'';
  };

  if (!('IntersectionObserver' in window)) return;
  const observer=new IntersectionObserver(entries=>{
    const visible=entries
      .filter(entry=>entry.isIntersecting)
      .sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
    if(visible) activate(visible.target);
  },{rootMargin:'-28% 0px -48% 0px',threshold:[0,.2,.45,.7]});
  steps.forEach(step=>observer.observe(step));
}


let stickyHeaderFrame = 0;
let stickyHeaderMode = null;

function setupStickyHeader() {
  const chrome = document.getElementById('site-chrome');
  if (!chrome) return;

  const scheduleUpdate = () => {
    if (stickyHeaderFrame) return;
    stickyHeaderFrame = window.requestAnimationFrame(() => {
      stickyHeaderFrame = 0;
      updateStickyHeaderState();
    });
  };

  updateStickyHeaderState(true);
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);

  // La altura cambia durante la transición entre los modos amplio y compacto.
  // ResizeObserver actualiza el offset sin forzar mediciones en cada evento scroll.
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => syncChromeOffset(chrome));
    observer.observe(chrome);
  }
}

function syncChromeOffset(chrome) {
  const height = Math.ceil(chrome.getBoundingClientRect().height);
  const value = `${height}px`;
  const root = document.documentElement;
  if (root.style.getPropertyValue('--chrome-offset') !== value) {
    root.style.setProperty('--chrome-offset', value);
    root.style.setProperty('--chrome-offset-mobile', value);
  }
}

function updateStickyHeaderState(force = false) {
  const chrome = document.getElementById('site-chrome');
  if (!chrome) return;

  const isHome = document.getElementById('view-descubre')?.classList.contains('active');
  const currentCompact = chrome.classList.contains('is-compact');
  const scrollY = Math.max(0, window.scrollY);

  // Dos umbrales distintos evitan que el cambio de altura del propio header
  // lo haga alternar rápidamente entre ambos estados al bajar la página.
  const shouldCompact = !isHome || (currentCompact ? scrollY > 12 : scrollY > 82);
  const nextMode = shouldCompact ? 'compact' : 'expanded';
  const changed = force || stickyHeaderMode !== nextMode;

  if (changed) {
    chrome.classList.toggle('is-expanded', !shouldCompact);
    chrome.classList.toggle('is-compact', shouldCompact);
    stickyHeaderMode = nextMode;
    window.requestAnimationFrame(() => syncChromeOffset(chrome));
    if (MAP) window.setTimeout(() => MAP.invalidateSize(), 260);
  } else {
    syncChromeOffset(chrome);
  }
}

// ── CHAT ──
const FLOWS = {
  start:{bot:'Hola. Soy el asistente del catálogo de experiencias. ¿Qué tipo de experiencia te gustaría vivir?',suggestions:[{l:'Naturaleza',n:'agua'},{l:'Gastronomía',n:'gasto'},{l:'Artesanía',n:'artesania'},{l:'Meliponicultura',n:'mel'},{l:'Explorar por estado',n:'estado'},{l:'Cerca de mi',n:'ubic'}]},
  agua:{bot:'El catálogo incluye cenotes, lagunas, humedales y senderos en espacios naturales. ¿Dónde te gustaría explorar?',suggestions:[{l:'Quintana Roo - cenotes y canales',n:'agua_qr'},{l:'Tabasco - manaties y pantanos',n:'agua_tab'},{l:'Campeche - cenotes',n:'agua_camp'},{l:'Volver',n:'start'}]},
  agua_qr:{bot:'En Quintana Roo destacan estas experiencias acuaticas:',exps:['MMM-019','MMM-016'],suggestions:[{l:'Inicio',n:'start'}]},
  agua_tab:{bot:'Los Pantanos de Centla son uno de los humedales mas biodiversos de Mexico:',exps:['MMM-026','MMM-025','MMM-030'],suggestions:[{l:'Inicio',n:'start'}]},
  agua_camp:{bot:'En Campeche, los cenotes de Miguel Colorado ofrecen una experiencia lejos del turismo masivo:',exps:['MMM-002'],suggestions:[{l:'Inicio',n:'start'}]},
  gasto:{bot:'El catálogo incluye experiencias gastronómicas y de cacao. ¿En qué estado te gustaría explorar?',suggestions:[{l:'Tabasco - cacao',n:'gasto_tab'},{l:'Yucatan - cocina maya',n:'gasto_yuc'},{l:'Campeche - pan y miel',n:'gasto_camp'},{l:'Volver',n:'start'}]},
  gasto_tab:{bot:'Tabasco es el paraiso del cacao. Estas experiencias van desde la planta hasta la tableta:',exps:['MMM-023','MMM-028','MMM-031'],suggestions:[{l:'Inicio',n:'start'}]},
  gasto_yuc:{bot:'En Yucatán puedes encontrar talleres con cocineras tradicionales:',exps:['MMM-033','MMM-037'],suggestions:[{l:'Inicio',n:'start'}]},
  gasto_camp:{bot:'En Campeche encontrarás el pan de difuntos de Pomuch y experiencias vinculadas con la apicultura:',exps:['MMM-009','MMM-008'],suggestions:[{l:'Inicio',n:'start'}]},
  artesania:{bot:'Las comunidades conservan técnicas artesanales y oficios tradicionales. ¿Qué te interesa?',suggestions:[{l:'Bordado textil - Quintana Roo',n:'art_qr'},{l:'Barro y ceramica - Yucatan',n:'art_yuc'},{l:'Artesanias de selva - Campeche',n:'art_camp'},{l:'Volver',n:'start'}]},
  art_qr:{bot:'El bordado de Quintana Roo permite aprender directamente de las artesanas:',exps:['MMM-018'],suggestions:[{l:'Inicio',n:'start'}]},
  art_yuc:{bot:'En Uayma, Yucatan, un maestro artesano trabaja en barro con tecnicas ancestrales:',exps:['MMM-034'],suggestions:[{l:'Inicio',n:'start'},{l:'Sombreros jipijapa',n:'art_yuc2'}]},
  art_yuc2:{bot:'Los sombreros jipijapa de Halecho son reconocidos mundialmente:',exps:['MMM-038'],suggestions:[{l:'Inicio',n:'start'}]},
  art_camp:{bot:'El corredor artesanal de Calakmul reune artesanas de comunidades tzeltal y chol:',exps:['MMM-003','MMM-006'],suggestions:[{l:'Inicio',n:'start'}]},
  mel:{bot:'Estas experiencias te acercan a la meliponicultura y a los saberes comunitarios asociados:',exps:['MMM-008','MMM-011','MMM-039'],suggestions:[{l:'Inicio',n:'start'}]},
  estado:{bot:'Elige el estado que quieres explorar:',suggestions:[{l:'Campeche',n:'est_camp'},{l:'Chiapas',n:'est_chis'},{l:'Quintana Roo',n:'est_qr'},{l:'Tabasco',n:'est_tab'},{l:'Yucatan',n:'est_yuc'},{l:'Volver',n:'start'}]},
  est_camp:{bot:'Campeche reúne experiencias de naturaleza, arqueología, gastronomía y saberes comunitarios, desde la selva de Calakmul hasta Tankuché.',suggestions:[{l:'Filtrar en catalogo',a:'filter_campeche'},{l:'Ver en mapa',a:'map_campeche'},{l:'Inicio',n:'start'}]},
  est_chis:{bot:'Chiapas reúne experiencias comunitarias en distintos territorios del estado, incluyendo Lacanjá Chansayab y Nahá-Metzabok.',exps:['MMM-012','MMM-013','MMM-014','MMM-015'],suggestions:[{l:'Inicio',n:'start'}]},
  est_qr:{bot:'Quintana Roo reúne experiencias comunitarias en la zona de Felipe Carrillo Puerto y otros territorios del estado:',exps:['MMM-016','MMM-017','MMM-018','MMM-019','MMM-020','MMM-021'],suggestions:[{l:'Inicio',n:'start'}]},
  est_tab:{bot:'Tabasco tiene 10 experiencias en la Sierra Maya, entre Comalcalco, Centla y el cacao:',suggestions:[{l:'Cacao y gastronomia',n:'gasto_tab'},{l:'Fauna y naturaleza',n:'agua_tab'},{l:'Inicio',n:'start'}]},
  est_yuc:{bot:'Yucatán reúne experiencias de naturaleza, gastronomía, artesanía y meliponicultura:',suggestions:[{l:'Cocina y cacao',n:'gasto_yuc'},{l:'Meliponicultura',n:'mel'},{l:'Artesanias',n:'art_yuc'},{l:'Inicio',n:'start'}]},
  ubic:{bot:'Haz clic en el boton de ubicacion en el mapa para activar la geolocalizacion. Las experiencias se ordenaran por distancia a tu posicion.',suggestions:[{l:'Ir al mapa',a:'go_map_locate'},{l:'Volver',n:'start'}]},
};

let chatStarted=false;
function setupChat() {
  document.getElementById('btn-open-chat')?.addEventListener('click',openChat);
  document.getElementById('chat-close').addEventListener('click',closeChat);
  document.getElementById('chat-backdrop').addEventListener('click',closeChat);
  document.getElementById('chat-send').addEventListener('click',handleChatInput);
  document.getElementById('chat-input').addEventListener('keydown',e=>{if(e.key==='Enter')handleChatInput();});
}
function openChat() {
  document.getElementById('chat-modal').classList.add('open');
  if (!chatStarted){chatStarted=true;chatNode('start');}
}
function closeChat(){ document.getElementById('chat-modal').classList.remove('open'); }

function chatNode(nodeId) {
  const node=FLOWS[nodeId]; if (!node) return;
  botMsg(node.bot);
  if (node.exps&&ALL_DATA.length){
    const exps=node.exps.map(id=>ALL_DATA.find(e=>e.id===id)).filter(Boolean);
    if (exps.length){
      const links=exps.map(e=>`<span class="chat-exp-link" onclick="openExpFromChat('${e.id}')">${e.nombre_experiencia}</span>`).join('');
      const msgs=document.getElementById('chat-messages');
      const last=msgs.querySelector('.chat-msg--bot:last-child .chat-bubble');
      if (last) last.insertAdjacentHTML('beforeend',links);
    }
  }
  renderSugs(node.suggestions||[]);
}

function botMsg(text) {
  const msgs=document.getElementById('chat-messages');
  msgs.insertAdjacentHTML('beforeend',`<div class="chat-msg chat-msg--bot"><div class="chat-bubble">${text}</div></div>`);
  msgs.scrollTop=msgs.scrollHeight;
}
function userMsg(text) {
  const msgs=document.getElementById('chat-messages');
  msgs.insertAdjacentHTML('beforeend',`<div class="chat-msg chat-msg--user"><div class="chat-bubble">${text}</div></div>`);
  msgs.scrollTop=msgs.scrollHeight;
}
function renderSugs(sugs) {
  const el=document.getElementById('chat-suggestions');
  el.innerHTML=sugs.map(s=>`<button class="chat-sug" data-next="${s.n||''}" data-action="${s.a||''}">${s.l}</button>`).join('');
  el.querySelectorAll('.chat-sug').forEach(btn=>{
    btn.addEventListener('click',()=>{
      userMsg(btn.textContent.trim());
      const a=btn.dataset.action,n=btn.dataset.next;
      if (a) handleChatAction(a); else if (n) chatNode(n);
    });
  });
}
function handleChatInput() {
  const input=document.getElementById('chat-input');
  const text=input.value.trim(); if (!text) return;
  input.value=''; userMsg(text);
  const q=text.toLowerCase();
  const found=ALL_DATA.filter(e=>
    e.nombre_experiencia.toLowerCase().includes(q)||
    e.estado.toLowerCase().includes(q)||
    e.localidad.toLowerCase().includes(q)||
    e.tipo_actividad.toLowerCase().includes(q)
  ).slice(0,4);
  if (found.length){
    const links=found.map(e=>`<span class="chat-exp-link" onclick="openExpFromChat('${e.id}')">${e.nombre_experiencia}</span>`).join('');
    document.getElementById('chat-messages').insertAdjacentHTML('beforeend',
      `<div class="chat-msg chat-msg--bot"><div class="chat-bubble">Encontre ${found.length} experiencia${found.length>1?'s':''} relacionada${found.length>1?'s':''} con "${text}":${links}</div></div>`);
    document.getElementById('chat-messages').scrollTop=9999;
  } else {
    botMsg(`No encontre resultados para "${text}". Intenta con el nombre del estado o tipo de actividad.`);
    renderSugs(FLOWS['start'].suggestions);
  }
}
function handleChatAction(a){
  if (a==='go_map_locate'){closeChat();switchView('mapa');setTimeout(locateUser,400);}
  else if (a==='filter_campeche'){closeChat();switchView('catalogo');setTimeout(()=>{document.getElementById('cat-estado').value='Campeche';filterCatalogo();},200);}
  else if (a==='map_campeche'){closeChat();switchView('mapa');setTimeout(()=>MAP.flyTo([19.5,-90.4],8,{duration:1.5}),300);}
}
function openExpFromChat(id){closeChat();switchView('mapa');setTimeout(()=>openFicha(id,true),250);}
window.openExpFromChat=openExpFromChat;

// ── UTILS ──
function cleanText(s){
  if(!s) return '';
  return String(s)
    .replace(/­/g,'')
    .replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])-\s+([a-záéíóúüñ])/g,'$1$2')
    .replace(/\s+/g,' ')
    .trim();
}
function looksIncompleteText(s){
  const t=cleanText(s);
  if(!t) return false;
  const last=t.slice(-1);
  if(/[.!?…)]/.test(last)) return false;
  const lastWord=(t.split(/\s+/).pop()||'').toLowerCase();
  const commonEndings=['de','del','la','el','los','las','un','una','y','o','con','por','para','en','al','a','que','como','entre','sobre','natu','recorri','patrimonio cultu'];
  return t.length>120 && (commonEndings.includes(lastWord) || !/[.!?…)]$/.test(t));
}
function sourceNoteIfIncomplete(s){
  return looksIncompleteText(s) ? '<div class="text-source-note">El texto disponible en la fuente de datos parece estar incompleto. La ficha se ajusta al contenido registrado, pero conviene completar este campo en el CSV.</div>' : '';
}
function trunc(s,max){
  const t=cleanText(s);
  return t.length>max?t.slice(0,max)+'...':t;
}

/* ══════════════════════════════════════════════════════
   AMPLIACIÓN NACIONAL · FILTROS, CONTEXTO Y GALERÍAS
   Esta sección redefine las funciones principales sin alterar
   los componentes de navegación, contacto, introducción y chat.
   ══════════════════════════════════════════════════════ */

let SERVICES_GEOJSON = { type: 'FeatureCollection', features: [] };
let SERVICES_BY_EXPERIENCE = {};
let INFRA_GEOJSON = { type: 'FeatureCollection', features: [] };
let INFRA_BY_EXPERIENCE = {};
let servicesLayer = null;
let infrastructureLayer = null;
let CURRENT_MAP_DATA = [];
let GALLERY_STATE = {};
let LIGHTBOX_STATE = { images: [], index: 0, title: '' };
let imageLightboxReady = false;
let catalogControlsReady = false;
let mapControlsReady = false;
let SELECTED_EXPERIENCE_ID = null;
let USER_NEARBY_DATA = [];

const MAP_PANES = {
  infrastructure: 'contextInfrastructurePane',
  services: 'contextServicesPane',
  experiences: 'experiencePane',
  selected: 'selectedExperiencePane',
  user: 'userLocationPane',
};

const SERVICE_LABELS = {
  alojamiento: 'Alojamiento',
  alimentos: 'Alimentos',
  salud: 'Salud',
  combustible: 'Combustible',
  transporte: 'Transporte local',
  abasto: 'Abasto',
  servicios_financieros: 'Servicios financieros',
  atractivos: 'Atractivos cercanos',
};

const INFRA_LABELS = {
  aeropuerto: 'Aeropuerto',
  terminal_autobuses: 'Terminal de autobuses',
  estacion_ferrocarril: 'Estación ferroviaria',
  puerto_embarcadero: 'Puerto o embarcadero',
};

const CONTEXT_COLORS = {
  alojamiento: '#7B61A8', alimentos: '#C95F2A', salud: '#C23B58',
  combustible: '#806B23', transporte: '#276A85', abasto: '#6F8F3E',
  servicios_financieros: '#4C5C8A', atractivos: '#1F6B4A',
  aeropuerto: '#155FA0', terminal_autobuses: '#C95F2A',
  estacion_ferrocarril: '#5C4B3D', puerto_embarcadero: '#168FA0',
};

function routeColor(route) {
  const normalized = normRuta(route);
  if (RUTA_COLOR[normalized]) return RUTA_COLOR[normalized];
  const palette = ['#1F6B4A','#0B5FA5','#7A4A2A','#C23B7A','#7B61A8','#C95F2A','#486B85','#7A7F35'];
  let hash = 0;
  for (const char of normalized) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

async function fetchJsonSafe(path, fallback) {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`No fue posible cargar ${path}`, error);
    return fallback;
  }
}

function getExperienceImages(exp) {
  const entry = IMAGE_MANIFEST[exp.id];
  let images = [];
  if (typeof entry === 'string') images = [entry];
  else if (Array.isArray(entry?.galeria)) images = entry.galeria;
  else if (entry?.principal) images = [entry.principal];

  // Solo se aceptan fotografías cuyo nombre inicia con el ID de la experiencia.
  images = [...new Set(images.filter(path => {
    const filename = decodeURIComponent(String(path).split('/').pop() || '');
    return filename.toUpperCase().startsWith(`${String(exp.id).toUpperCase()}_`);
  }))];

  if (images.length) {
    const principal = entry?.principal;
    if (principal && images.includes(principal)) {
      images = [principal, ...images.filter(path => path !== principal)];
    }
    return images;
  }

  return [getExperienceImage(exp)];
}

function getExperienceImage(exp) {
  const entry = IMAGE_MANIFEST[exp.id];
  if (entry?.principal) {
    const filename = decodeURIComponent(String(entry.principal).split('/').pop() || '');
    if (filename.toUpperCase().startsWith(`${String(exp.id).toUpperCase()}_`)) return entry.principal;
  }
  return 'img/placeholder_experiencia.svg';
}

function renderExperienceGallery(exp, galleryId) {
  const images = getExperienceImages(exp);
  GALLERY_STATE[galleryId] = { images, index: 0, title: exp.nombre_experiencia };
  const thumbs = images.length > 1 ? `
    <div class="experience-gallery-thumbs" role="list" aria-label="Fotografías de ${escapeHtml(exp.nombre_experiencia)}">
      ${images.map((src, index) => `
        <button class="experience-gallery-thumb ${index === 0 ? 'is-active' : ''}" type="button"
          onclick="setGalleryImage('${galleryId}',${index})" aria-label="Ver fotografía ${index + 1}">
          <img src="${escapeHtml(src)}" alt="" loading="lazy">
        </button>`).join('')}
    </div>` : '';

  return `
    <div class="experience-gallery" id="${galleryId}">
      <button class="experience-gallery-main" type="button" onclick="openImageLightbox('${galleryId}')" aria-label="Ampliar fotografía">
        <img src="${escapeHtml(images[0])}" alt="${escapeHtml(exp.nombre_experiencia)}" loading="eager">
        ${images.length > 1 ? `<span class="experience-gallery-count">1 / ${images.length}</span>` : ''}
        <span class="experience-gallery-expand">Ampliar</span>
      </button>
      ${thumbs}
    </div>`;
}

function setGalleryImage(galleryId, index) {
  const state = GALLERY_STATE[galleryId];
  const container = document.getElementById(galleryId);
  if (!state || !container || !state.images[index]) return;
  state.index = index;
  const main = container.querySelector('.experience-gallery-main img');
  const count = container.querySelector('.experience-gallery-count');
  if (main) main.src = state.images[index];
  if (count) count.textContent = `${index + 1} / ${state.images.length}`;
  container.querySelectorAll('.experience-gallery-thumb').forEach((button, buttonIndex) => {
    button.classList.toggle('is-active', buttonIndex === index);
  });
}
window.setGalleryImage = setGalleryImage;

function setupImageLightbox() {
  if (imageLightboxReady) return;
  imageLightboxReady = true;
  document.getElementById('image-lightbox-close')?.addEventListener('click', closeImageLightbox);
  document.getElementById('image-lightbox-prev')?.addEventListener('click', () => stepImageLightbox(-1));
  document.getElementById('image-lightbox-next')?.addEventListener('click', () => stepImageLightbox(1));
  document.getElementById('image-lightbox')?.addEventListener('click', event => {
    if (event.target.id === 'image-lightbox') closeImageLightbox();
  });
  document.addEventListener('keydown', event => {
    const open = document.getElementById('image-lightbox')?.classList.contains('open');
    if (!open) return;
    if (event.key === 'Escape') closeImageLightbox();
    if (event.key === 'ArrowLeft') stepImageLightbox(-1);
    if (event.key === 'ArrowRight') stepImageLightbox(1);
  });
}

function openImageLightbox(galleryId) {
  const state = GALLERY_STATE[galleryId];
  if (!state) return;
  LIGHTBOX_STATE = { images: state.images, index: state.index, title: state.title };
  updateImageLightbox();
  const lightbox = document.getElementById('image-lightbox');
  lightbox?.classList.add('open');
  lightbox?.setAttribute('aria-hidden', 'false');
}
window.openImageLightbox = openImageLightbox;

function updateImageLightbox() {
  const image = document.getElementById('image-lightbox-img');
  const caption = document.getElementById('image-lightbox-caption');
  if (image) image.src = LIGHTBOX_STATE.images[LIGHTBOX_STATE.index] || '';
  if (caption) caption.textContent = `${LIGHTBOX_STATE.title} · ${LIGHTBOX_STATE.index + 1} de ${LIGHTBOX_STATE.images.length}`;
  const hidden = LIGHTBOX_STATE.images.length < 2;
  document.getElementById('image-lightbox-prev')?.classList.toggle('is-hidden', hidden);
  document.getElementById('image-lightbox-next')?.classList.toggle('is-hidden', hidden);
}

function stepImageLightbox(delta) {
  const total = LIGHTBOX_STATE.images.length;
  if (!total) return;
  LIGHTBOX_STATE.index = (LIGHTBOX_STATE.index + delta + total) % total;
  updateImageLightbox();
}
function closeImageLightbox() {
  const lightbox = document.getElementById('image-lightbox');
  lightbox?.classList.remove('open');
  lightbox?.setAttribute('aria-hidden', 'true');
}

function populateSelect(selectId, values, firstLabel) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${firstLabel}</option>` + values
    .filter(Boolean)
    .sort((a,b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
    .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function uniqueValues(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function populateDynamicFilters() {
  const states = uniqueValues(ALL_DATA.map(exp => exp.estado));
  const types = uniqueValues(ALL_DATA.flatMap(exp => (exp.tipo_actividad || '').split('|').map(type => type.trim())));
  const municipalities = uniqueValues(ALL_DATA.map(exp => exp.municipio));

  populateSelect('map-estado', states, 'Todos');
  populateSelect('map-tipo', types, 'Todos');
  populateSelect('cat-estado', states, 'Todos los estados');
  populateSelect('cat-tipo', types, 'Todos los tipos');
  populateSelect('cat-municipio', municipalities, 'Todos los municipios');
}

async function loadData() {
  await loadImageManifest();
  const [dataResponse, servicesGeo, servicesByExperience, infraGeo, infraByExperience] = await Promise.all([
    fetch('data/data.csv', { cache: 'no-store' }),
    fetchJsonSafe('data/servicios_contexto.geojson', { type: 'FeatureCollection', features: [] }),
    fetchJsonSafe('data/servicios_contexto_por_experiencia.json', {}),
    fetchJsonSafe('data/infraestructura_transporte.geojson', { type: 'FeatureCollection', features: [] }),
    fetchJsonSafe('data/infraestructura_por_experiencia.json', {}),
  ]);
  if (!dataResponse.ok) throw new Error(`No fue posible cargar data/data.csv (${dataResponse.status})`);
  const text = await dataResponse.text();
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  ALL_DATA = parseCSV(clean);
  ALL_DATA.forEach(exp => {
    exp._ruta = normRuta(exp.ruta_maya);
    exp._tipos = (exp.tipo_actividad || '').split('|').map(type => type.trim()).filter(Boolean);
  });
  SERVICES_GEOJSON = servicesGeo;
  SERVICES_BY_EXPERIENCE = servicesByExperience;
  INFRA_GEOJSON = infraGeo;
  INFRA_BY_EXPERIENCE = infraByExperience;

  populateDynamicFilters();
  setupImageLightbox();
  initMap();
  setupResponsiveMapV5();
  buildCatalogo();
  buildIndicadores();
}

function initMap() {
  const mobileMap = window.matchMedia('(max-width: 760px)').matches;
  MAP = L.map('map', {
    center: [23.5, -102],
    zoom: 5,
    zoomControl: true,
    attributionControl: false,
    zoomAnimation: !mobileMap,
    fadeAnimation: !mobileMap,
    markerZoomAnimation: !mobileMap,
  });

  // Mapa base: OpenStreetMap (los mosaicos estándar no ofrecen variante @2x).
  const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  L.tileLayer(tileUrl, {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18,
    updateWhenIdle: mobileMap,
    keepBuffer: mobileMap ? 1 : 2,
  }).addTo(MAP);
  L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(MAP);

  // Jerarquía visual explícita: la información de contexto queda debajo y
  // las experiencias permanecen siempre por encima de cualquier otra capa.
  const paneDefinitions = [
    [MAP_PANES.infrastructure, 410],
    [MAP_PANES.services, 430],
    [MAP_PANES.experiences, 640],
    [MAP_PANES.selected, 670],
    [MAP_PANES.user, 680],
  ];
  paneDefinitions.forEach(([name, zIndex]) => {
    const pane = MAP.getPane(name) || MAP.createPane(name);
    pane.style.zIndex = String(zIndex);
  });

  markersLayer = L.layerGroup().addTo(MAP);
  servicesLayer = L.layerGroup().addTo(MAP);
  infrastructureLayer = L.layerGroup().addTo(MAP);
  CURRENT_MAP_DATA = ALL_DATA;
  renderMarkers(ALL_DATA);
  setupMapControls();
  const valid = ALL_DATA.filter(exp => Number.isFinite(parseFloat(exp.latitud)) && Number.isFinite(parseFloat(exp.longitud)));
  if (valid.length) {
    MAP.fitBounds(valid.map(exp => [parseFloat(exp.latitud), parseFloat(exp.longitud)]), { padding: [35,35], maxZoom: 7 });
  }
  updateExplorePanel(ALL_DATA);
}

function makeMarkerIcon(exp, selected = false) {
  const color = EXPERIENCE_MARKER_COLOR_V4 || '#08745A';
  return L.divIcon({
    html: `<div class="maya-marker ${selected ? 'is-selected' : ''}" style="--experience-color:${color};background:${color}" aria-hidden="true"><div class="maya-marker-inner"></div></div>`,
    className: 'experience-marker-wrapper', iconSize: [38,42], iconAnchor: [19,40], popupAnchor: [0,-42],
  });
}

function renderMarkers(data) {
  CURRENT_MAP_DATA = data;
  markersLayer.clearLayers();
  ALL_DATA.forEach(exp => { exp._marker = null; });
  data.forEach(exp => {
    const lat = parseFloat(exp.latitud), lon = parseFloat(exp.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const color = EXPERIENCE_MARKER_COLOR_V4 || '#08745A';
    const selected = exp.id === SELECTED_EXPERIENCE_ID;
    const marker = L.marker([lat, lon], {
      icon: makeMarkerIcon(exp, selected),
      pane: selected ? MAP_PANES.selected : MAP_PANES.experiences,
      zIndexOffset: selected ? 5000 : 1500,
      riseOnHover: true,
      riseOffset: 2500,
      title: exp.nombre_experiencia || 'Experiencia turística',
      keyboard: true,
    });
    marker.bindPopup(`
      <div class="map-popup map-popup--experience">
        <span class="map-popup-ruta">${escapeHtml((exp._tipos || [])[0] || exp.estado || 'Experiencia')}</span>
        <div class="map-popup-name">${escapeHtml(exp.nombre_experiencia)}</div>
        <div class="map-popup-loc">${escapeHtml(exp.localidad)}, ${escapeHtml(exp.municipio)}, ${escapeHtml(exp.estado)}</div>
        <button class="map-popup-btn" onclick="openFicha('${escapeHtml(exp.id)}')">Ver experiencia</button>
      </div>`, { maxWidth: 300 });
    marker.on('click', () => {
      setSelectedExperienceMarker(exp.id);
      openFicha(exp.id, false);
    });
    markersLayer.addLayer(marker);
    exp._marker = marker;
  });
  setSelectedExperienceMarker(SELECTED_EXPERIENCE_ID, { openPopup: false });
}

function experienceMatchesMapFilters(exp) {
  const state = document.getElementById('map-estado')?.value || '';
  const type = document.getElementById('map-tipo')?.value || '';
  const heritage = document.getElementById('map-patrimonio')?.value || '';
  if (state && normStr(exp.estado).toLowerCase() !== normStr(state).toLowerCase()) return false;
  if (type && !(exp._tipos || []).some(item => normStr(item).toLowerCase() === normStr(type).toLowerCase())) return false;
  if (heritage === 'material' && !hasPatrimonio(exp.patrimonio_material)) return false;
  if (heritage === 'inmaterial' && !hasPatrimonio(exp.patrimonio_inmaterial)) return false;
  if (heritage === 'natural' && !hasPatrimonio(exp.patrimonio_natural)) return false;
  return true;
}

function applyMapFilters(options = {}) {
  USER_NEARBY_DATA = [];
  const result = ALL_DATA.filter(experienceMatchesMapFilters);
  renderMarkers(result);
  if (options.fit && result.length) {
    MAP.fitBounds(result.map(exp => [parseFloat(exp.latitud), parseFloat(exp.longitud)]), { padding: [45,45], maxZoom: 10 });
  }
  refreshContextLayers();
  updateExplorePanel(result);
}

function resetMapFilters(options = {}) {
  ['map-estado','map-tipo','map-patrimonio'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = '';
  });
  applyMapFilters({ fit: options.fit !== false });
}

function setupMapControls() {
  if (mapControlsReady) return;
  mapControlsReady = true;
  const input = document.getElementById('map-search-input');
  const results = document.getElementById('map-search-results');
  input?.addEventListener('input', () => {
    const query = normStr(input.value).toLowerCase().trim();
    if (!query) { results.classList.remove('open'); return; }
    const matches = ALL_DATA.filter(exp => normStr([
      exp.nombre_experiencia, exp.localidad, exp.municipio, exp.estado,
      exp.tipo_actividad,
    ].join(' ')).toLowerCase().includes(query)).slice(0, 8);
    results.innerHTML = matches.map(exp => `
      <div class="map-sr-item" onclick="flyToExp('${escapeHtml(exp.id)}')">
        <strong>${escapeHtml(exp.nombre_experiencia)}</strong>
        <span>${escapeHtml(exp.localidad)}, ${escapeHtml(exp.estado)}</span>
      </div>`).join('') || '<div class="map-sr-item">Sin resultados</div>';
    results.classList.add('open');
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.map-search-wrap')) results?.classList.remove('open');
  });

  ['map-estado','map-tipo','map-patrimonio'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => applyMapFilters({ fit: true }));
  });
  document.getElementById('map-reset-filters')?.addEventListener('click', () => resetMapFilters({ fit: true }));
  document.getElementById('map-filter-panel-toggle')?.addEventListener('click', () => {
    const panel = document.getElementById('map-filter-panel');
    const button = document.getElementById('map-filter-panel-toggle');
    const collapsed = panel?.classList.toggle('is-collapsed');
    button?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  document.getElementById('map-show-services')?.addEventListener('change', event => {
    document.getElementById('map-service-category').disabled = !event.target.checked;
    refreshContextLayers();
  });
  document.getElementById('map-show-infrastructure')?.addEventListener('change', event => {
    document.getElementById('map-infrastructure-category').disabled = !event.target.checked;
    refreshContextLayers();
  });
  document.getElementById('map-service-category')?.addEventListener('change', refreshContextLayers);
  document.getElementById('map-infrastructure-category')?.addEventListener('change', refreshContextLayers);
  MAP.on('moveend zoomend', () => {
    refreshContextLayers();
    updateExplorePanel(CURRENT_MAP_DATA);
  });
  document.getElementById('btn-locate')?.addEventListener('click', locateUser);
  applyMapFilters();
}


function getActiveMapFilterLabels() {
  const definitions = [
    ['map-estado', 'Estado'],
    ['map-tipo', 'Tipo'],
    ['map-patrimonio', 'Patrimonio'],
  ];
  return definitions.map(([id, label]) => {
    const element = document.getElementById(id);
    const value = element?.value || '';
    if (!value) return null;
    const text = element.options?.[element.selectedIndex]?.text || value;
    return { label, value: text };
  }).filter(Boolean);
}

function rankExperiencesForPanel(data) {
  const center = MAP?.getCenter();
  return [...data].filter(exp => Number.isFinite(parseFloat(exp.latitud)) && Number.isFinite(parseFloat(exp.longitud)))
    .map(exp => ({
      ...exp,
      _panelDistance: center ? haversine(center.lat, center.lng, parseFloat(exp.latitud), parseFloat(exp.longitud)) : 0,
    }))
    .sort((a, b) => a._panelDistance - b._panelDistance || String(a.nombre_experiencia).localeCompare(String(b.nombre_experiencia), 'es'));
}

function panelExperienceCard(exp) {
  const image = getExperienceImages(exp)[0];
  const types = (exp._tipos || []).slice(0, 2);
  const description = trunc(exp.descripcion_corta || exp.descripcion || exp.descripcion_experiencia || exp.servicios_incluidos || '', 170);
  const color = EXPERIENCE_MARKER_COLOR_V4 || '#08745A';
  return `<article class="explore-featured-card" style="--route-color:${color}">
    <button type="button" class="explore-featured-action" onclick="flyToExp('${escapeHtml(exp.id)}')" aria-label="Ver ${escapeHtml(exp.nombre_experiencia)} en el mapa">
      <div class="explore-featured-image-wrap">
        <img class="explore-featured-image" src="${escapeHtml(image)}" alt="${escapeHtml(exp.nombre_experiencia)}" loading="lazy">
        <span class="explore-featured-route">${escapeHtml(exp.estado || (exp._tipos || [])[0] || 'Experiencia')}</span>
      </div>
      <div class="explore-featured-content">
        <h4>${escapeHtml(exp.nombre_experiencia)}</h4>
        <p class="explore-featured-location">${escapeHtml([exp.localidad, exp.municipio, exp.estado].filter(Boolean).join(' · '))}</p>
        ${description ? `<p class="explore-featured-description">${escapeHtml(description)}</p>` : ''}
        <div class="explore-featured-footer">
          <span class="explore-mini-tags">${types.map(type => `<i>${escapeHtml(type)}</i>`).join('')}</span>
          <strong>Ver experiencia</strong>
        </div>
      </div>
    </button>
  </article>`;
}

function panelResultItem(exp, index, distanceLabel = '') {
  const image = getExperienceImages(exp)[0];
  return `<button class="explore-result-item" type="button" onclick="flyToExp('${escapeHtml(exp.id)}')">
    <img src="${escapeHtml(image)}" alt="" loading="lazy">
    <span class="explore-result-copy">
      <small>${escapeHtml(exp.estado || `Experiencia ${index + 1}`)}</small>
      <strong>${escapeHtml(exp.nombre_experiencia)}</strong>
      <em>${escapeHtml([exp.localidad, exp.estado].filter(Boolean).join(', '))}</em>
    </span>
    ${distanceLabel ? `<b>${escapeHtml(distanceLabel)}</b>` : '<b aria-hidden="true">›</b>'}
  </button>`;
}

function updateExplorePanel(data = CURRENT_MAP_DATA) {
  const panel = document.getElementById('panel-welcome');
  if (!panel) return;
  const experiences = Array.isArray(data) ? data : [];
  const activeFilters = getActiveMapFilterLabels();
  const ranked = rankExperiencesForPanel(experiences);
  const states = uniqueValues(experiences.map(exp => exp.estado));
  const municipalities = uniqueValues(experiences.map(exp => exp.municipio));

  const countElement = document.getElementById('explore-visible-count');
  const stateElement = document.getElementById('explore-state-count');
  const municipalityElement = document.getElementById('explore-municipality-count');
  if (countElement) countElement.textContent = String(experiences.length);
  if (stateElement) stateElement.textContent = String(states.length);
  if (municipalityElement) municipalityElement.textContent = String(municipalities.length);

  const kicker = document.getElementById('explore-kicker');
  const title = document.getElementById('explore-title');
  const description = document.getElementById('explore-description');
  if (USER_NEARBY_DATA.length) {
    if (kicker) kicker.textContent = 'Tu ubicación';
    if (title) title.innerHTML = 'Experiencias<br><em>más cercanas</em>';
    if (description) description.textContent = 'Estas son las experiencias más próximas a la ubicación compartida por tu dispositivo.';
  } else if (activeFilters.length) {
    if (kicker) kicker.textContent = 'Resultados del mapa';
    if (title) title.innerHTML = `${experiences.length} experiencia${experiences.length === 1 ? '' : 's'}<br><em>para explorar</em>`;
    if (description) description.textContent = experiences.length ? 'El panel resume las coincidencias actuales. Selecciona una experiencia para consultar su ficha completa.' : 'No hay experiencias que coincidan con esta combinación de filtros.';
  } else {
    if (kicker) kicker.textContent = 'Explora el territorio';
    if (title) title.innerHTML = 'Experiencias<br><em>que conectan</em>';
    if (description) description.textContent = 'Las experiencias son el elemento principal del mapa. Los servicios y la conectividad aparecen únicamente como contexto para planificar la visita.';
  }

  const chips = document.getElementById('explore-active-filters');
  if (chips) {
    chips.hidden = !activeFilters.length;
    chips.innerHTML = activeFilters.map(filter => `<span><small>${escapeHtml(filter.label)}</small>${escapeHtml(filter.value)}</span>`).join('');
  }

  const featuredSection = document.getElementById('explore-featured-section');
  const featured = document.getElementById('explore-featured');
  const featuredHeading = document.getElementById('explore-featured-heading');
  const featuredPosition = document.getElementById('explore-featured-position');
  const resultsList = document.getElementById('explore-results-list');
  const resultsHeading = document.getElementById('explore-results-heading');
  const resultsCount = document.getElementById('explore-results-count');
  const nearbySlot = document.getElementById('explore-nearby-slot');
  if (nearbySlot) nearbySlot.innerHTML = '';

  if (!ranked.length) {
    if (featuredSection) featuredSection.hidden = true;
    if (resultsHeading) resultsHeading.textContent = 'Sin resultados';
    if (resultsCount) resultsCount.textContent = '';
    if (resultsList) resultsList.innerHTML = '<div class="explore-empty"><strong>No encontramos experiencias</strong><p>Prueba con una selección menos específica o limpia los filtros del mapa.</p><button type="button" onclick="resetMapFilters({fit:true})">Limpiar filtros</button></div>';
    return;
  }

  if (featuredSection) featuredSection.hidden = false;
  const featuredExperience = ranked[0];
  if (featuredHeading) featuredHeading.textContent = USER_NEARBY_DATA.length ? 'La más cercana' : activeFilters.length ? 'Primera coincidencia' : 'Experiencia destacada';
  if (featuredPosition) featuredPosition.textContent = featuredExperience._panelDistance > 0.1 ? `${featuredExperience._panelDistance.toFixed(0)} km del centro del mapa` : '';
  if (featured) featured.innerHTML = panelExperienceCard(featuredExperience);

  const remaining = ranked.slice(1, 5);
  if (resultsHeading) resultsHeading.textContent = USER_NEARBY_DATA.length ? 'Otras experiencias cercanas' : 'Más experiencias visibles';
  if (resultsCount) resultsCount.textContent = `${Math.max(0, ranked.length - 1)} más`;
  if (resultsList) {
    resultsList.innerHTML = remaining.length
      ? remaining.map((exp, index) => panelResultItem(exp, index)).join('')
      : '<p class="explore-single-result">Esta es la única experiencia visible con los filtros actuales.</p>';
  }
}

function setSelectedExperienceMarker(id, options = {}) {
  SELECTED_EXPERIENCE_ID = id || null;
  ALL_DATA.forEach(exp => {
    const marker = exp._marker;
    if (!marker) return;
    const selected = exp.id === SELECTED_EXPERIENCE_ID;
    marker.options.pane = selected ? MAP_PANES.selected : MAP_PANES.experiences;
    marker.setZIndexOffset(selected ? 5000 : 1500);
    marker.setIcon(makeMarkerIcon(exp, selected));
    if (selected && options.openPopup) marker.openPopup();
  });
}

function showNearbyBanner(nearby) {
  USER_NEARBY_DATA = Array.isArray(nearby) ? nearby : [];
  const ranked = USER_NEARBY_DATA.map(exp => ({ ...exp, _panelDistance: exp.dist || 0 }));
  updateExplorePanel(ranked);
  const list = document.getElementById('explore-results-list');
  if (list && ranked.length > 1) {
    list.innerHTML = ranked.slice(1, 5).map((exp, index) => panelResultItem(exp, index, `${Number(exp.dist || 0).toFixed(0)} km`)).join('');
  }
  const featuredPosition = document.getElementById('explore-featured-position');
  if (featuredPosition && ranked[0]) featuredPosition.textContent = `${Number(ranked[0].dist || 0).toFixed(0)} km de ti`;
}

function contextMarkerIcon(category, kind) {
  const labels = {
    aeropuerto: 'A', terminal_autobuses: 'B', estacion_ferrocarril: 'T', puerto_embarcadero: 'P',
    alojamiento: 'H', alimentos: 'R', salud: '+', combustible: 'G', transporte: 'M',
    abasto: 'S', servicios_financieros: '$', atractivos: 'I',
  };
  const color = CONTEXT_COLORS[category] || '#57636A';
  return L.divIcon({
    html: `<div class="context-marker context-marker--${kind}" style="--context-color:${color}">${labels[category] || '•'}</div>`,
    className: '', iconSize: [25,25], iconAnchor: [12,12], popupAnchor: [0,-14],
  });
}

function featureInVisibleArea(feature) {
  if (!MAP || !feature?.geometry?.coordinates) return false;
  const [lon, lat] = feature.geometry.coordinates;
  return MAP.getBounds().pad(0.15).contains([lat, lon]);
}

function refreshContextLayers() {
  if (!MAP || !servicesLayer || !infrastructureLayer) return;
  servicesLayer.clearLayers();
  infrastructureLayer.clearLayers();
  const showServices = document.getElementById('map-show-services')?.checked;
  const showInfrastructure = document.getElementById('map-show-infrastructure')?.checked;
  const serviceCategory = document.getElementById('map-service-category')?.value || '';
  const infraCategory = document.getElementById('map-infrastructure-category')?.value || '';
  let shownServices = 0, shownInfra = 0;

  if (showServices) {
    SERVICES_GEOJSON.features
      .filter(feature => featureInVisibleArea(feature))
      .filter(feature => !serviceCategory || (feature.properties.categorias || []).includes(serviceCategory) || feature.properties.categoria === serviceCategory)
      .slice(0, 500)
      .forEach(feature => {
        const [lon, lat] = feature.geometry.coordinates;
        const category = serviceCategory || feature.properties.categoria || 'atractivos';
        const marker = L.marker([lat, lon], { icon: contextMarkerIcon(category, 'service'), pane: MAP_PANES.services, zIndexOffset: 0, riseOnHover: true, riseOffset: 120 });
        marker.bindPopup(`<div class="context-popup"><span>${escapeHtml(SERVICE_LABELS[category] || 'Servicio')}</span><strong>${escapeHtml(feature.properties.nombre)}</strong><p>${escapeHtml(feature.properties.clase_actividad || '')}</p><small>${escapeHtml(feature.properties.direccion || '')}</small></div>`);
        servicesLayer.addLayer(marker); shownServices++;
      });
  }

  if (showInfrastructure) {
    INFRA_GEOJSON.features
      .filter(feature => featureInVisibleArea(feature))
      .filter(feature => !infraCategory || feature.properties.categoria === infraCategory)
      .slice(0, 500)
      .forEach(feature => {
        const [lon, lat] = feature.geometry.coordinates;
        const category = feature.properties.categoria;
        const marker = L.marker([lat, lon], { icon: contextMarkerIcon(category, 'infrastructure'), pane: MAP_PANES.infrastructure, zIndexOffset: 0, riseOnHover: true, riseOffset: 120 });
        marker.bindPopup(`<div class="context-popup"><span>${escapeHtml(INFRA_LABELS[category] || feature.properties.categoria_label)}</span><strong>${escapeHtml(feature.properties.nombre)}</strong><p>${escapeHtml(feature.properties.subcategoria || '')}</p><small>Fuente: Red Nacional de Caminos 2025, INEGI</small></div>`);
        infrastructureLayer.addLayer(marker); shownInfra++;
      });
  }

  const note = document.getElementById('map-context-note');
  if (note) {
    if (!showServices && !showInfrastructure) note.textContent = 'Activa una capa y acércate al territorio para consultar el contexto.';
    else note.textContent = `${shownServices} servicios y ${shownInfra} puntos de conectividad visibles en esta zona.`;
  }
}

function flyToExp(id) {
  const exp = ALL_DATA.find(item => item.id === id);
  if (!exp || !MAP) return;
  if (!CURRENT_MAP_DATA.some(item => item.id === id)) resetMapFilters({ fit: false });
  const lat = parseFloat(exp.latitud), lon = parseFloat(exp.longitud);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    openFicha(id, false);
    document.getElementById('map-search-results')?.classList.remove('open');
    return;
  }
  MAP.flyTo([lat, lon], 12, { duration: 1.2 });
  window.setTimeout(() => exp._marker?.openPopup(), 500);
  document.getElementById('map-search-results')?.classList.remove('open');
  const input = document.getElementById('map-search-input');
  if (input) input.value = exp.nombre_experiencia;
  openFicha(id, false);
}
window.flyToExp = flyToExp;

function focusContextPoint(kind, category, lat, lon) {
  switchView('mapa');
  window.setTimeout(() => {
    if (kind === 'service') {
      const checkbox = document.getElementById('map-show-services');
      if (checkbox) checkbox.checked = true;
      const select = document.getElementById('map-service-category');
      if (select) { select.disabled = false; select.value = category || ''; }
    } else {
      const checkbox = document.getElementById('map-show-infrastructure');
      if (checkbox) checkbox.checked = true;
      const select = document.getElementById('map-infrastructure-category');
      if (select) { select.disabled = false; select.value = category || ''; }
    }
    MAP.flyTo([Number(lat), Number(lon)], 13, { duration: 1.1 });
    window.setTimeout(refreshContextLayers, 500);
  }, 180);
}
window.focusContextPoint = focusContextPoint;

function renderPlanning(exp) {
  const serviceGroups = SERVICES_BY_EXPERIENCE[exp.id] || {};
  const infraGroups = INFRA_BY_EXPERIENCE[exp.id] || {};
  const serviceOrder = ['alojamiento','alimentos','salud','combustible','transporte','abasto','servicios_financieros','atractivos'];
  const infraOrder = ['aeropuerto','terminal_autobuses','estacion_ferrocarril','puerto_embarcadero'];

  const serviceHtml = serviceOrder
    .filter(category => Array.isArray(serviceGroups[category]) && serviceGroups[category].length)
    .map(category => {
      const items = serviceGroups[category].slice(0,3);
      return `<div class="planning-group">
        <h4>${escapeHtml(SERVICE_LABELS[category])}</h4>
        ${items.map(item => `<button class="planning-item" type="button" onclick="focusContextPoint('service','${category}',${item.latitud},${item.longitud})">
          <span><strong>${escapeHtml(item.nombre)}</strong><small>${escapeHtml(item.clase_actividad || item.direccion || '')}</small></span>
          <b>${item.distancia_m < 1000 ? `${item.distancia_m} m` : `${(item.distancia_m/1000).toFixed(1)} km`}</b>
        </button>`).join('')}
      </div>`;
    }).join('');

  const infraHtml = infraOrder
    .filter(category => Array.isArray(infraGroups[category]) && infraGroups[category].length)
    .map(category => {
      const item = infraGroups[category][0];
      return `<button class="planning-infra-item" type="button" onclick="focusContextPoint('infrastructure','${category}',${item.latitud},${item.longitud})">
        <span class="planning-infra-code">${category === 'aeropuerto' ? 'AER' : category === 'terminal_autobuses' ? 'BUS' : category === 'estacion_ferrocarril' ? 'TREN' : 'MAR'}</span>
        <span><small>${escapeHtml(INFRA_LABELS[category])}</small><strong>${escapeHtml(item.nombre)}</strong></span>
        <b>${item.distancia_km.toFixed(1)} km</b>
      </button>`;
    }).join('');

  if (!serviceHtml && !infraHtml) return '<p class="planning-empty">No hay información de contexto disponible para esta experiencia.</p>';
  return `
    ${infraHtml ? `<div class="planning-block"><h3>Conectividad más cercana</h3><div class="planning-infra-list">${infraHtml}</div></div>` : ''}
    ${serviceHtml ? `<div class="planning-block"><h3>Servicios registrados a menos de 5 km</h3>${serviceHtml}<p class="planning-source">Fuente: DENUE, INEGI. La ausencia de resultados no implica que no existan servicios locales.</p></div>` : `<p class="planning-empty">DENUE no registra servicios dentro de 5 km. Confirma opciones locales con el anfitrión.</p>`}
  `;
}

function openFicha(id, flyTo = true) {
  const exp = ALL_DATA.find(item => item.id === id);
  if (!exp) return;
  setSelectedExperienceMarker(id, { openPopup: false });
  const color = EXPERIENCE_MARKER_COLOR_V4 || '#08745A';
  const tipos = exp._tipos || [];
  document.getElementById('ficha-title').textContent = exp.nombre_experiencia;
  document.getElementById('ficha-location').textContent = formatExperienceLocation(exp);
  document.getElementById('ficha-tags').innerHTML = tipos.map(type => `<span class="ficha-tag">${escapeHtml(type)}</span>`).join('');
  document.getElementById('ficha-gallery').innerHTML = renderExperienceGallery(exp, `side-gallery-${exp.id}`);
  document.getElementById('ficha-desc').innerHTML = (cleanText(exp.descripcion || exp.descripcion_experiencia) || 'Información no disponible.') + sourceNoteIfIncomplete(exp.descripcion || exp.descripcion_experiencia);
  const host = cleanText(exp.anfitrion) || '';
  document.getElementById('ficha-anf').innerHTML = host ? `${host}${sourceNoteIfIncomplete(exp.anfitrion)}` : '<em>Información no disponible</em>';
  document.getElementById('ficha-servicios').textContent = exp.servicios_incluidos || '-';
  document.getElementById('ficha-capacidad').textContent = exp.capacidad_grupo || '-';
  document.getElementById('ficha-booking').innerHTML = buildBookingActions(exp);

  const heritage = [];
  if (hasPatrimonio(exp.patrimonio_material)) heritage.push({ type: 'Material', value: exp.patrimonio_material });
  if (hasPatrimonio(exp.patrimonio_inmaterial)) heritage.push({ type: 'Inmaterial', value: exp.patrimonio_inmaterial });
  if (hasPatrimonio(exp.patrimonio_natural)) heritage.push({ type: 'Natural', value: exp.patrimonio_natural });
  document.getElementById('ficha-patrimonio').innerHTML = heritage.length ? heritage.map(item => `<div class="patrimonio-item"><div class="patrimonio-text"><strong>${item.type}</strong>${escapeHtml(cleanText(item.value))}</div></div>`).join('') : '<p>No especificado.</p>';

  const impacts = [];
  if (exp.se_fomenta) impacts.push({ label: 'Fomenta', value: exp.se_fomenta });
  if (exp.se_promueve) impacts.push({ label: 'Promueve', value: exp.se_promueve });
  if (exp.personas_involucradas) impacts.push({ label: 'Comunidad', value: exp.personas_involucradas });
  document.getElementById('ficha-impacto').innerHTML = impacts.map(item => `<div class="impacto-item"><strong>${item.label}</strong>${escapeHtml(cleanText(item.value))}</div>`).join('');
  document.getElementById('ficha-impacto-section').style.display = impacts.length ? '' : 'none';
  document.getElementById('ficha-planifica').innerHTML = renderPlanning(exp);

  const lat = parseFloat(exp.latitud), lon = parseFloat(exp.longitud);
  let nearby = [];
  if (hasValidCoordinates(exp)) {
    nearby = ALL_DATA.filter(item => item.id !== exp.id && hasValidCoordinates(item))
      .map(item => ({ ...item, dist: haversine(lat, lon, parseFloat(item.latitud), parseFloat(item.longitud)) }))
      .sort((a,b) => a.dist - b.dist).slice(0,4);
  } else {
    nearby = ALL_DATA.filter(item => item.id !== exp.id && normStr(item.estado).toLowerCase() === normStr(exp.estado).toLowerCase())
      .slice(0,4).map(item => ({ ...item, dist: null }));
  }
  document.getElementById('nearby-list').innerHTML = nearby.map(item => `<div class="nearby-item" onclick="openFicha('${escapeHtml(item.id)}')"><div class="nearby-item-left"><div class="nearby-item-name">${escapeHtml(item.nombre_experiencia)}</div><div class="nearby-item-loc">${escapeHtml([item.localidad,item.estado].filter(Boolean).join(', '))}</div></div>${Number.isFinite(item.dist) ? `<div class="nearby-item-dist">${item.dist.toFixed(0)} km</div>` : ''}</div>`).join('');

  const maps = document.getElementById('ficha-maps-link');
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    maps.innerHTML = `<a class="maps-link-btn" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank" rel="noopener">Cómo llegar en Google Maps</a><p class="maps-reference-note">Ubicación referencial. Confirma el punto de encuentro con el anfitrión.</p>`;
  } else maps.innerHTML = '<p>Contacta al anfitrión para obtener indicaciones.</p>';

  const contactRows = [];
  if (exp.telefono) contactRows.push(`<div class="contact-row"><span class="contact-label">Tel.</span><span class="contact-val">${escapeHtml(exp.telefono)}</span></div>`);
  if (exp.correo) contactRows.push(`<div class="contact-row"><span class="contact-label">Correo</span><span class="contact-val">${splitEmails(exp.correo).map(email => `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`).join('<br>')}</span></div>`);
  if (exp.facebook) contactRows.push(`<div class="contact-row"><span class="contact-label">Facebook</span><span class="contact-val">${escapeHtml(exp.facebook)}</span></div>`);
  if (exp.instagram) contactRows.push(`<div class="contact-row"><span class="contact-label">Instagram</span><span class="contact-val">${escapeHtml(exp.instagram)}</span></div>`);
  document.getElementById('ficha-contact').innerHTML = contactRows.join('') || '<p>Sin datos de contacto.</p>';

  document.getElementById('panel-welcome').style.display = 'none';
  const panel = document.getElementById('panel-ficha');
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.setAttribute('aria-hidden', 'false');
  document.getElementById('ficha-body').scrollTop = 0;
  openFichaPresentationV6();

  if (flyTo && Number.isFinite(lat) && Number.isFinite(lon)) {
    MAP.flyTo([lat, lon], 11, { duration: 1 });
    if (!isMobileFichaV6()) {
      window.setTimeout(() => exp._marker?.openPopup(), 500);
    }
  }
}
window.openFicha = openFicha;

function buildCatalogo() {
  renderCatGrid(ALL_DATA);
  const count = document.getElementById('cat-count');
  if (count) count.textContent = `${ALL_DATA.length} experiencias`;
  updateCatalogMobileFilterStatusV7(ALL_DATA.length);
  if (catalogControlsReady) return;
  catalogControlsReady = true;
  document.getElementById('cat-search')?.addEventListener('input', filterCatalogo);
  ['cat-estado','cat-municipio','cat-tipo'].forEach(id => document.getElementById(id)?.addEventListener('change', () => {
    if (id === 'cat-estado') updateCatalogMunicipalities();
    filterCatalogo();
  }));
  document.getElementById('cat-clear-filters')?.addEventListener('click', () => {
    document.getElementById('cat-search').value = '';
    ['cat-estado','cat-municipio','cat-tipo'].forEach(id => document.getElementById(id).value = '');
    updateCatalogMunicipalities();
    filterCatalogo();
  });
  document.getElementById('cat-drawer-overlay')?.addEventListener('click', closeCatDrawer);
  document.getElementById('cat-drawer-close')?.addEventListener('click', closeCatDrawer);
}

function updateCatalogMunicipalities() {
  const state = document.getElementById('cat-estado')?.value || '';
  const municipalities = uniqueValues(ALL_DATA.filter(exp => !state || normStr(exp.estado).toLowerCase() === normStr(state).toLowerCase()).map(exp => exp.municipio));
  populateSelect('cat-municipio', municipalities, 'Todos los municipios');
}

function filterCatalogo() {
  const query = normStr(document.getElementById('cat-search')?.value || '').toLowerCase().trim();
  const state = document.getElementById('cat-estado')?.value || '';
  const municipality = document.getElementById('cat-municipio')?.value || '';
  const type = document.getElementById('cat-tipo')?.value || '';
  const result = ALL_DATA.filter(exp => {
    if (query && !normStr([exp.nombre_experiencia,exp.localidad,exp.municipio,exp.estado,exp.descripcion,exp.descripcion_corta,exp.anfitrion,exp.tipo_actividad].join(' ')).toLowerCase().includes(query)) return false;
    if (state && normStr(exp.estado).toLowerCase() !== normStr(state).toLowerCase()) return false;
    if (municipality && normStr(exp.municipio).toLowerCase() !== normStr(municipality).toLowerCase()) return false;
    if (type && !(exp._tipos || []).some(item => normStr(item).toLowerCase() === normStr(type).toLowerCase())) return false;
    return true;
  });
  renderCatGrid(result);
  document.getElementById('cat-count').textContent = `${result.length} experiencia${result.length === 1 ? '' : 's'}`;
  updateCatalogMobileFilterStatusV7(result.length);
}

function openCatDrawer(id) {
  const exp = ALL_DATA.find(item => item.id === id);
  if (!exp) return;
  const color = EXPERIENCE_MARKER_COLOR_V4 || '#08745A';
  const tipos = exp._tipos || [];
  const lat = parseFloat(exp.latitud), lon = parseFloat(exp.longitud);
  const contactRows = [];
  if (exp.telefono) contactRows.push(`<div class="contact-row"><span class="contact-label">Tel.</span><span class="contact-val">${escapeHtml(exp.telefono)}</span></div>`);
  if (exp.correo) contactRows.push(`<div class="contact-row"><span class="contact-label">Correo</span><span class="contact-val">${splitEmails(exp.correo).map(email => `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`).join('<br>')}</span></div>`);
  const mapsHtml = Number.isFinite(lat) && Number.isFinite(lon) ? `<a class="maps-link-btn" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank" rel="noopener">Cómo llegar en Google Maps</a>` : '';

  document.getElementById('cat-drawer-content').innerHTML = `
    ${renderExperienceGallery(exp, `drawer-gallery-${exp.id}`)}
    <div class="ficha-header cat-drawer-heading">
      <h2 class="ficha-title">${escapeHtml(exp.nombre_experiencia)}</h2>
      <p class="ficha-location">${escapeHtml(formatExperienceLocation(exp))}</p>
      <div class="ficha-tags">${tipos.map(type => `<span class="ficha-tag">${escapeHtml(type)}</span>`).join('')}</div>
    </div>
    <div class="ficha-body cat-drawer-body">
      <section class="ficha-section"><h3 class="ficha-section-title">La experiencia</h3><p class="ficha-desc">${escapeHtml(cleanText(exp.descripcion || exp.descripcion_experiencia) || 'Información no disponible.')}</p></section>
      ${cleanText(exp.anfitrion) ? `<section class="ficha-section"><h3 class="ficha-section-title">Anfitrión</h3><div class="ficha-anf">${escapeHtml(cleanText(exp.anfitrion))}</div></section>` : ''}
      <section class="ficha-section ficha-meta-grid"><div class="ficha-meta-item"><span class="ficha-meta-label">Servicios</span><span class="ficha-meta-value">${escapeHtml(exp.servicios_incluidos || '-')}</span></div><div class="ficha-meta-item"><span class="ficha-meta-label">Capacidad</span><span class="ficha-meta-value">${escapeHtml(exp.capacidad_grupo || '-')}</span></div></section>
      <section class="ficha-section"><h3 class="ficha-section-title">Planifica tu visita</h3><div class="ficha-planifica">${renderPlanning(exp)}</div></section>
      <section class="ficha-section ficha-booking-section"><h3 class="ficha-section-title">Consulta y contratación</h3><div class="booking-actions">${buildBookingActions(exp)}</div></section>
      <section class="ficha-section ficha-como-llegar"><h3 class="ficha-section-title">Cómo llegar</h3>${mapsHtml || '<p>Contacta al anfitrión para indicaciones.</p>'}</section>
      ${contactRows.length ? `<section class="ficha-section ficha-contact"><h3 class="ficha-section-title">Contacto</h3><div class="contact-grid">${contactRows.join('')}</div></section>` : ''}
      ${hasValidCoordinates(exp) ? `<div class="drawer-map-action"><span>Localiza esta experiencia y su contexto territorial.</span><button onclick="closeCatDrawer();switchView('mapa');setTimeout(()=>flyToExp('${escapeHtml(exp.id)}'),250)">Ver en mapa</button></div>` : `<div class="drawer-map-action"><span>Ubicación pendiente de validación.</span></div>`}
    </div>`;
  document.getElementById('cat-drawer').classList.add('open');
}
window.openCatDrawer = openCatDrawer;
window.closeCatDrawer = closeCatDrawer;

function buildMapLegend() {
  const legend = document.querySelector('.map-legend');
  if (!legend) return;
  legend.innerHTML = `<h4>Rutas o grupos</h4>${routes.map(route => `<div class="legend-item"><span class="legend-dot" style="background:${routeColor(route)}"></span>${escapeHtml(route)}</div>`).join('')}`;
}

function openCatalogCategory(category) {
  switchView('catalogo');
  window.setTimeout(() => {
    const select = document.getElementById('cat-tipo');
    if (select) {
      const match = [...select.options].find(option => normStr(option.value).toLowerCase() === normStr(category).toLowerCase());
      select.value = match?.value || '';
    }
    filterCatalogo();
  }, 120);
}
window.openCatalogCategory = openCatalogCategory;

// Se ejecuta después de que los datos ya fueron cargados por la versión ampliada.
const originalEnhancedLoadData = loadData;
loadData = async function enhancedLoadData() {
  await originalEnhancedLoadData();
  buildMapLegend();
};


/* ══════════════════════════════════════════════════════
   AJUSTES DE EXPLORACIÓN · AGOSTO 2026
   - Marcadores de experiencias con un solo color.
   - Filtros múltiples mediante casillas.
   - Leyendas dinámicas para servicios y conectividad.
   - Experiencia aleatoria y carrusel en el panel lateral.
   ══════════════════════════════════════════════════════ */

const EXPERIENCE_MARKER_COLOR_V4 = '#08745A';
const MAP_FILTER_CONFIG_V4 = {
  estado: { container: 'map-estado-options', summary: 'map-estado-summary', empty: 'Todos' },
  tipo: { container: 'map-tipo-options', summary: 'map-tipo-summary', empty: 'Todos' },
  patrimonio: { container: 'map-patrimonio-options', summary: 'map-patrimonio-summary', empty: 'Todos' },
};
const CONTEXT_SYMBOLS_V4 = {
  aeropuerto: 'A',
  terminal_autobuses: 'B',
  estacion_ferrocarril: 'T',
  puerto_embarcadero: 'P',
  alojamiento: 'H',
  alimentos: 'R',
  salud: '+',
  combustible: 'G',
  transporte: 'M',
  abasto: 'S',
  servicios_financieros: '$',
  atractivos: 'I',
};
const SERVICE_ORDER_V4 = [
  'alojamiento', 'alimentos', 'salud', 'combustible',
  'transporte', 'abasto', 'servicios_financieros', 'atractivos',
];
const INFRA_ORDER_V4 = [
  'aeropuerto', 'terminal_autobuses', 'estacion_ferrocarril', 'puerto_embarcadero',
];
const PANEL_CAROUSEL_DELAY_V4 = 8000;
let PANEL_CAROUSEL_V4 = { signature: '', items: [], index: 0, timer: null };

function getCheckedMapValuesV4(group) {
  return [...document.querySelectorAll(`input.map-filter-checkbox[data-filter-group="${group}"]:checked`)]
    .map(input => input.value);
}

function populateCheckboxFilterV4(group, values) {
  const config = MAP_FILTER_CONFIG_V4[group];
  const container = document.getElementById(config?.container);
  if (!container) return;

  const previous = new Set(getCheckedMapValuesV4(group));
  const options = values
    .map(item => typeof item === 'string' ? { value: item, label: item } : item)
    .filter(item => item?.value)
    .sort((a, b) => String(a.label).localeCompare(String(b.label), 'es', { sensitivity: 'base' }));

  container.innerHTML = options.map((item, index) => {
    const id = `map-filter-${group}-${index}`;
    return `<label class="map-check-option" for="${id}">
      <input class="map-filter-checkbox" type="checkbox" id="${id}"
        data-filter-group="${group}" value="${escapeHtml(item.value)}"
        ${previous.has(item.value) ? 'checked' : ''}>
      <span>${escapeHtml(item.label)}</span>
    </label>`;
  }).join('');
}

function updateMapFilterSummariesV4() {
  Object.entries(MAP_FILTER_CONFIG_V4).forEach(([group, config]) => {
    const selected = [...document.querySelectorAll(`input.map-filter-checkbox[data-filter-group="${group}"]:checked`)];
    const summary = document.getElementById(config.summary);
    if (!summary) return;

    if (!selected.length) {
      summary.textContent = config.empty;
      summary.removeAttribute('title');
      return;
    }

    const labels = selected.map(input =>
      input.closest('label')?.querySelector('span')?.textContent || input.value
    );
    summary.textContent = labels.length === 1 ? labels[0] : `${labels[0]} +${labels.length - 1}`;
    summary.title = labels.join(', ');
  });
}

function populateDynamicFilters() {
  const states = uniqueValues(ALL_DATA.map(exp => exp.estado));
  const types = uniqueValues(
    ALL_DATA.flatMap(exp => (exp.tipo_actividad || '').split('|').map(type => type.trim()))
  );
  const municipalities = uniqueValues(ALL_DATA.map(exp => exp.municipio));

  populateCheckboxFilterV4('estado', states);
  populateCheckboxFilterV4('tipo', types);
  populateCheckboxFilterV4('patrimonio', [
    { value: 'material', label: 'Material' },
    { value: 'inmaterial', label: 'Inmaterial' },
    { value: 'natural', label: 'Natural' },
  ]);
  updateMapFilterSummariesV4();

  populateSelect('cat-estado', states, 'Todos los estados');
  populateSelect('cat-tipo', types, 'Todos los tipos');
  populateSelect('cat-municipio', municipalities, 'Todos los municipios');
}

function makeMarkerIcon(exp, selected = false) {
  return L.divIcon({
    html: `<div class="maya-marker ${selected ? 'is-selected' : ''}"
      style="--experience-color:${EXPERIENCE_MARKER_COLOR_V4};background:${EXPERIENCE_MARKER_COLOR_V4}"
      aria-hidden="true"><div class="maya-marker-inner"></div></div>`,
    className: 'experience-marker-wrapper',
    iconSize: [38, 42],
    iconAnchor: [19, 40],
    popupAnchor: [0, -42],
  });
}

function renderMarkers(data) {
  CURRENT_MAP_DATA = data;
  markersLayer.clearLayers();
  ALL_DATA.forEach(exp => { exp._marker = null; });

  data.forEach(exp => {
    const lat = parseFloat(exp.latitud);
    const lon = parseFloat(exp.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const selected = exp.id === SELECTED_EXPERIENCE_ID;
    const marker = L.marker([lat, lon], {
      icon: makeMarkerIcon(exp, selected),
      pane: selected ? MAP_PANES.selected : MAP_PANES.experiences,
      zIndexOffset: selected ? 5000 : 1500,
      riseOnHover: true,
      riseOffset: 2500,
      title: exp.nombre_experiencia || 'Experiencia turística',
      keyboard: true,
    });

    marker.bindPopup(`
      <div class="map-popup map-popup--experience">
        <span class="map-popup-ruta">${escapeHtml((exp._tipos || [])[0] || exp.estado || 'Experiencia')}</span>
        <div class="map-popup-name">${escapeHtml(exp.nombre_experiencia)}</div>
        <div class="map-popup-loc">${escapeHtml(exp.localidad)}, ${escapeHtml(exp.municipio)}, ${escapeHtml(exp.estado)}</div>
        <button class="map-popup-btn" onclick="openFicha('${escapeHtml(exp.id)}')">Ver experiencia</button>
      </div>`,
      { maxWidth: 300 }
    );

    marker.on('click', () => {
      setSelectedExperienceMarker(exp.id);
      openFicha(exp.id, false);
    });

    markersLayer.addLayer(marker);
    exp._marker = marker;
  });

  setSelectedExperienceMarker(SELECTED_EXPERIENCE_ID, { openPopup: false });
}

function experienceMatchesMapFilters(exp) {
  const states = getCheckedMapValuesV4('estado');
  const types = getCheckedMapValuesV4('tipo');
  const heritage = getCheckedMapValuesV4('patrimonio');

  if (states.length && !states.some(value =>
    normStr(exp.estado).toLowerCase() === normStr(value).toLowerCase()
  )) return false;

  if (types.length && !types.some(value =>
    (exp._tipos || []).some(item =>
      normStr(item).toLowerCase() === normStr(value).toLowerCase()
    )
  )) return false;

  if (heritage.length) {
    const heritageMatches = heritage.some(value => {
      if (value === 'material') return hasPatrimonio(exp.patrimonio_material);
      if (value === 'inmaterial') return hasPatrimonio(exp.patrimonio_inmaterial);
      if (value === 'natural') return hasPatrimonio(exp.patrimonio_natural);
      return false;
    });
    if (!heritageMatches) return false;
  }

  return true;
}

function applyMapFilters(options = {}) {
  USER_NEARBY_DATA = [];
  const result = ALL_DATA.filter(experienceMatchesMapFilters);
  renderMarkers(result);

  const mapped = result.filter(hasValidCoordinates);

  if (options.fit && mapped.length) {
    MAP.fitBounds(
      mapped.map(exp => [parseFloat(exp.latitud), parseFloat(exp.longitud)]),
      { padding: [45, 45], maxZoom: 10 }
    );
  }

  refreshContextLayers();
  updateExplorePanel(result);
}

function resetMapFilters(options = {}) {
  document.querySelectorAll('input.map-filter-checkbox').forEach(input => {
    input.checked = false;
  });
  document.querySelectorAll('.map-check-filter[open]').forEach(details => {
    details.removeAttribute('open');
  });
  updateMapFilterSummariesV4();
  applyMapFilters({ fit: options.fit !== false });
}

function setupMapControls() {
  if (mapControlsReady) return;
  mapControlsReady = true;

  const input = document.getElementById('map-search-input');
  const results = document.getElementById('map-search-results');

  input?.addEventListener('input', () => {
    const query = normStr(input.value).toLowerCase().trim();
    if (!query) {
      results?.classList.remove('open');
      return;
    }

    const matches = ALL_DATA.filter(exp => normStr([
      exp.nombre_experiencia, exp.localidad, exp.municipio, exp.estado,
      exp.tipo_actividad,
    ].join(' ')).toLowerCase().includes(query)).slice(0, 8);

    if (results) {
      results.innerHTML = matches.map(exp => `
        <div class="map-sr-item" onclick="flyToExp('${escapeHtml(exp.id)}')">
          <strong>${escapeHtml(exp.nombre_experiencia)}</strong>
          <span>${escapeHtml(exp.localidad)}, ${escapeHtml(exp.estado)}</span>
        </div>`).join('') || '<div class="map-sr-item">Sin resultados</div>';
      results.classList.add('open');
    }
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.map-search-wrap')) results?.classList.remove('open');
  });

  document.querySelectorAll('input.map-filter-checkbox').forEach(inputElement => {
    inputElement.addEventListener('change', () => {
      updateMapFilterSummariesV4();
      applyMapFilters({ fit: true });
    });
  });

  document.querySelectorAll('.map-check-filter').forEach(details => {
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      document.querySelectorAll('.map-check-filter[open]').forEach(other => {
        if (other !== details) other.removeAttribute('open');
      });
    });
  });

  document.getElementById('map-reset-filters')?.addEventListener('click', () => {
    resetMapFilters({ fit: true });
  });

  document.getElementById('map-filter-panel-toggle')?.addEventListener('click', () => {
    const panel = document.getElementById('map-filter-panel');
    const button = document.getElementById('map-filter-panel-toggle');
    const collapsed = panel?.classList.toggle('is-collapsed');
    button?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  document.getElementById('map-show-services')?.addEventListener('change', event => {
    const select = document.getElementById('map-service-category');
    if (select) select.disabled = !event.target.checked;
    refreshContextLayers();
  });

  document.getElementById('map-show-infrastructure')?.addEventListener('change', event => {
    const select = document.getElementById('map-infrastructure-category');
    if (select) select.disabled = !event.target.checked;
    refreshContextLayers();
  });

  document.getElementById('map-service-category')?.addEventListener('change', refreshContextLayers);
  document.getElementById('map-infrastructure-category')?.addEventListener('change', refreshContextLayers);

  MAP.on('moveend zoomend', () => {
    refreshContextLayers();
    updateExplorePanel(CURRENT_MAP_DATA);
  });

  document.getElementById('btn-locate')?.addEventListener('click', locateUser);

  document.getElementById('explore-carousel-prev')?.addEventListener('click', () => {
    stepExploreCarouselV4(-1);
  });
  document.getElementById('explore-carousel-next')?.addEventListener('click', () => {
    stepExploreCarouselV4(1);
  });

  const explorePanel = document.getElementById('panel-welcome');
  explorePanel?.addEventListener('mouseenter', stopExploreCarouselTimerV4);
  explorePanel?.addEventListener('mouseleave', restartExploreCarouselTimerV4);
  explorePanel?.addEventListener('focusin', stopExploreCarouselTimerV4);
  explorePanel?.addEventListener('focusout', restartExploreCarouselTimerV4);

  document.querySelector('.nav-tab[data-view="mapa"]')?.addEventListener('click', () => {
    window.setTimeout(restartExploreCarouselTimerV4, 250);
  });

  applyMapFilters();
}

function getActiveMapFilterLabels() {
  const definitions = [
    ['estado', 'Estado'],
    ['tipo', 'Tipo'],
    ['patrimonio', 'Patrimonio'],
  ];

  return definitions.map(([group, label]) => {
    const selected = [...document.querySelectorAll(
      `input.map-filter-checkbox[data-filter-group="${group}"]:checked`
    )];
    if (!selected.length) return null;

    const values = selected.map(input =>
      input.closest('label')?.querySelector('span')?.textContent || input.value
    );

    return {
      label,
      value: values.length <= 2
        ? values.join(', ')
        : `${values.slice(0, 2).join(', ')} +${values.length - 2}`,
    };
  }).filter(Boolean);
}

function shuffleExperiencesV4(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function getPanelCarouselItemsV4(experiences) {
  const valid = [...experiences].filter(exp =>
    exp?.id &&
    Number.isFinite(parseFloat(exp.latitud)) &&
    Number.isFinite(parseFloat(exp.longitud))
  );

  const nearbyMode = USER_NEARBY_DATA.length > 0;
  const filterSignature = getActiveMapFilterLabels()
    .map(item => `${item.label}:${item.value}`)
    .join('|');
  const ids = valid.map(exp => exp.id).sort().join('|');
  const signature = `${nearbyMode ? 'nearby' : 'browse'}|${filterSignature}|${ids}`;

  if (PANEL_CAROUSEL_V4.signature !== signature) {
    PANEL_CAROUSEL_V4.signature = signature;
    PANEL_CAROUSEL_V4.items = nearbyMode
      ? valid.sort((a, b) =>
          Number(a.dist ?? a._panelDistance ?? 0) -
          Number(b.dist ?? b._panelDistance ?? 0)
        )
      : shuffleExperiencesV4(valid);
    PANEL_CAROUSEL_V4.index = 0;
  } else {
    const currentById = new Map(valid.map(exp => [exp.id, exp]));
    PANEL_CAROUSEL_V4.items = PANEL_CAROUSEL_V4.items
      .map(exp => currentById.get(exp.id))
      .filter(Boolean);

    valid.forEach(exp => {
      if (!PANEL_CAROUSEL_V4.items.some(item => item.id === exp.id)) {
        PANEL_CAROUSEL_V4.items.push(exp);
      }
    });

    if (PANEL_CAROUSEL_V4.index >= PANEL_CAROUSEL_V4.items.length) {
      PANEL_CAROUSEL_V4.index = 0;
    }
  }

  return PANEL_CAROUSEL_V4.items;
}

function stopExploreCarouselTimerV4() {
  if (PANEL_CAROUSEL_V4.timer) {
    window.clearTimeout(PANEL_CAROUSEL_V4.timer);
    PANEL_CAROUSEL_V4.timer = null;
  }
}

function restartExploreCarouselTimerV4() {
  stopExploreCarouselTimerV4();
  const mapViewActive = document.getElementById('view-mapa')?.classList.contains('active');
  const panelVisible = document.getElementById('panel-welcome')?.style.display !== 'none';

  if (
    !mapViewActive ||
    !panelVisible ||
    SELECTED_EXPERIENCE_ID ||
    document.hidden ||
    PANEL_CAROUSEL_V4.items.length < 2
  ) return;

  PANEL_CAROUSEL_V4.timer = window.setTimeout(() => {
    stepExploreCarouselV4(1, { automatic: true });
  }, PANEL_CAROUSEL_DELAY_V4);
}

function stepExploreCarouselV4(delta, options = {}) {
  if (PANEL_CAROUSEL_V4.items.length < 2) return;
  PANEL_CAROUSEL_V4.index =
    (PANEL_CAROUSEL_V4.index + delta + PANEL_CAROUSEL_V4.items.length) %
    PANEL_CAROUSEL_V4.items.length;

  updateExplorePanel(USER_NEARBY_DATA.length ? USER_NEARBY_DATA : CURRENT_MAP_DATA);
  if (!options.automatic) restartExploreCarouselTimerV4();
}

function updateExplorePanel(data = CURRENT_MAP_DATA) {
  const panel = document.getElementById('panel-welcome');
  if (!panel) return;

  const experiences = Array.isArray(data) ? data : [];
  const activeFilters = getActiveMapFilterLabels();
  const carouselItems = getPanelCarouselItemsV4(experiences);
  const states = uniqueValues(experiences.map(exp => exp.estado));
  const municipalities = uniqueValues(experiences.map(exp => exp.municipio));

  const countElement = document.getElementById('explore-visible-count');
  const stateElement = document.getElementById('explore-state-count');
  const municipalityElement = document.getElementById('explore-municipality-count');
  if (countElement) countElement.textContent = String(experiences.length);
  if (stateElement) stateElement.textContent = String(states.length);
  if (municipalityElement) municipalityElement.textContent = String(municipalities.length);

  const kicker = document.getElementById('explore-kicker');
  const title = document.getElementById('explore-title');
  const description = document.getElementById('explore-description');

  if (USER_NEARBY_DATA.length) {
    if (kicker) kicker.textContent = 'Tu ubicación';
    if (title) title.innerHTML = 'Experiencias<br><em>más cercanas</em>';
    if (description) {
      description.textContent = 'Recorre las experiencias más próximas a la ubicación compartida por tu dispositivo.';
    }
  } else if (activeFilters.length) {
    if (kicker) kicker.textContent = 'Resultados del mapa';
    if (title) {
      title.innerHTML = `${experiences.length} experiencia${experiences.length === 1 ? '' : 's'}<br><em>para explorar</em>`;
    }
    if (description) {
      description.textContent = experiences.length
        ? 'Recorre las coincidencias con las flechas o selecciona un marcador para abrir su ficha.'
        : 'No hay experiencias que coincidan con esta combinación de filtros.';
    }
  } else {
    if (kicker) kicker.textContent = 'Explora el territorio';
    if (title) title.innerHTML = 'Una experiencia<br><em>para descubrir</em>';
    if (description) {
      description.textContent = 'La experiencia destacada cambia en cada visita y avanza como carrusel mientras no abras una ficha específica.';
    }
  }

  const chips = document.getElementById('explore-active-filters');
  if (chips) {
    chips.hidden = !activeFilters.length;
    chips.innerHTML = activeFilters.map(filter =>
      `<span><small>${escapeHtml(filter.label)}</small>${escapeHtml(filter.value)}</span>`
    ).join('');
  }

  const featuredSection = document.getElementById('explore-featured-section');
  const featured = document.getElementById('explore-featured');
  const featuredHeading = document.getElementById('explore-featured-heading');
  const featuredPosition = document.getElementById('explore-featured-position');
  const resultsList = document.getElementById('explore-results-list');
  const resultsHeading = document.getElementById('explore-results-heading');
  const resultsCount = document.getElementById('explore-results-count');
  const controls = document.getElementById('explore-carousel-controls');
  const indicator = document.getElementById('explore-carousel-indicator');
  const nearbySlot = document.getElementById('explore-nearby-slot');
  if (nearbySlot) nearbySlot.innerHTML = '';

  if (!carouselItems.length) {
    stopExploreCarouselTimerV4();
    if (featuredSection) featuredSection.hidden = true;
    if (controls) controls.hidden = true;
    if (resultsHeading) resultsHeading.textContent = 'Sin resultados';
    if (resultsCount) resultsCount.textContent = '';
    if (resultsList) {
      resultsList.innerHTML = `
        <div class="explore-empty">
          <strong>No encontramos experiencias</strong>
          <p>Prueba con una selección menos específica o limpia los filtros del mapa.</p>
          <button type="button" onclick="resetMapFilters({fit:true})">Limpiar filtros</button>
        </div>`;
    }
    return;
  }

  if (featuredSection) featuredSection.hidden = false;
  if (controls) controls.hidden = carouselItems.length < 2;
  if (indicator) {
    indicator.textContent = `${PANEL_CAROUSEL_V4.index + 1} / ${carouselItems.length}`;
  }

  const featuredExperience =
    carouselItems[PANEL_CAROUSEL_V4.index] || carouselItems[0];

  if (featuredHeading) {
    featuredHeading.textContent = USER_NEARBY_DATA.length
      ? 'Experiencia cercana'
      : activeFilters.length
        ? 'Coincidencia destacada'
        : 'Experiencia destacada';
  }

  if (featuredPosition) {
    const distance = Number(
      featuredExperience.dist ?? featuredExperience._panelDistance ?? 0
    );
    featuredPosition.textContent = USER_NEARBY_DATA.length && distance
      ? `${distance.toFixed(0)} km de ti`
      : [featuredExperience.estado, (featuredExperience._tipos || [])[0]].filter(Boolean).join(' · ');
  }

  if (featured) {
    featured.innerHTML = panelExperienceCard(featuredExperience);
  }

  const remaining = [];
  for (
    let offset = 1;
    offset < carouselItems.length && remaining.length < 4;
    offset += 1
  ) {
    remaining.push(
      carouselItems[(PANEL_CAROUSEL_V4.index + offset) % carouselItems.length]
    );
  }

  if (resultsHeading) {
    resultsHeading.textContent = USER_NEARBY_DATA.length
      ? 'Otras experiencias cercanas'
      : 'Más experiencias del carrusel';
  }
  if (resultsCount) {
    resultsCount.textContent = `${Math.max(0, carouselItems.length - 1)} más`;
  }
  if (resultsList) {
    resultsList.innerHTML = remaining.length
      ? remaining.map((exp, index) => {
          const distance = Number(exp.dist ?? exp._panelDistance ?? 0);
          const label = USER_NEARBY_DATA.length && distance
            ? `${distance.toFixed(0)} km`
            : '';
          return panelResultItem(exp, index, label);
        }).join('')
      : '<p class="explore-single-result">Esta es la única experiencia visible con los filtros actuales.</p>';
  }

  restartExploreCarouselTimerV4();
}

function setSelectedExperienceMarker(id, options = {}) {
  SELECTED_EXPERIENCE_ID = id || null;
  if (SELECTED_EXPERIENCE_ID) stopExploreCarouselTimerV4();

  ALL_DATA.forEach(exp => {
    const marker = exp._marker;
    if (!marker) return;

    const selected = exp.id === SELECTED_EXPERIENCE_ID;
    marker.options.pane = selected ? MAP_PANES.selected : MAP_PANES.experiences;
    marker.setZIndexOffset(selected ? 5000 : 1500);
    marker.setIcon(makeMarkerIcon(exp, selected));
    if (selected && options.openPopup) marker.openPopup();
  });
}

function showNearbyBanner(nearby) {
  USER_NEARBY_DATA = Array.isArray(nearby) ? nearby : [];
  PANEL_CAROUSEL_V4.signature = '';
  updateExplorePanel(USER_NEARBY_DATA);
}

function contextMarkerIcon(category, kind) {
  const color = CONTEXT_COLORS[category] || '#57636A';
  return L.divIcon({
    html: `<div class="context-marker context-marker--${kind}"
      style="--context-color:${color}">${CONTEXT_SYMBOLS_V4[category] || '•'}</div>`,
    className: '',
    iconSize: [25, 25],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

function featureServiceCategoriesV4(feature) {
  const properties = feature?.properties || {};
  let categories = properties.categorias;

  if (Array.isArray(categories)) {
    categories = categories;
  } else if (typeof categories === 'string') {
    categories = categories.split(/[|,;]/);
  } else {
    categories = [];
  }

  if (properties.categoria) categories.push(properties.categoria);

  return [...new Set(categories.map(value => String(value || '').trim()).filter(Boolean))];
}

function contextLegendItemV4(category, kind, label) {
  const color = CONTEXT_COLORS[category] || '#57636A';
  return `<div class="context-legend-item">
    <span class="context-legend-symbol context-legend-symbol--${kind}"
      style="--legend-color:${color}">${CONTEXT_SYMBOLS_V4[category] || '•'}</span>
    <span>${escapeHtml(label)}</span>
  </div>`;
}

function updateContextLegendV4() {
  const legend = document.getElementById('map-context-legend');
  if (!legend) return;

  const showServices = document.getElementById('map-show-services')?.checked;
  const showInfrastructure = document.getElementById('map-show-infrastructure')?.checked;
  const serviceCategory = document.getElementById('map-service-category')?.value || '';
  const infraCategory = document.getElementById('map-infrastructure-category')?.value || '';
  const groups = [];

  if (showServices) {
    const categories = serviceCategory ? [serviceCategory] : SERVICE_ORDER_V4;
    groups.push(`
      <section class="context-legend-group context-legend-group--services">
        <h4>Servicios</h4>
        <div class="context-legend-items">
          ${categories.map(category =>
            contextLegendItemV4(category, 'service', SERVICE_LABELS[category] || category)
          ).join('')}
        </div>
      </section>`);
  }

  if (showInfrastructure) {
    const categories = infraCategory ? [infraCategory] : INFRA_ORDER_V4;
    groups.push(`
      <section class="context-legend-group context-legend-group--infrastructure">
        <h4>Conectividad</h4>
        <div class="context-legend-items">
          ${categories.map(category =>
            contextLegendItemV4(category, 'infrastructure', INFRA_LABELS[category] || category)
          ).join('')}
        </div>
      </section>`);
  }

  legend.hidden = groups.length === 0;
  legend.classList.toggle('is-dual', groups.length === 2);
  legend.innerHTML = groups.length
    ? `<div class="context-legend-groups">${groups.join('')}</div>`
    : '';
}

function refreshContextLayers() {
  if (!MAP || !servicesLayer || !infrastructureLayer) return;

  servicesLayer.clearLayers();
  infrastructureLayer.clearLayers();

  const showServices = document.getElementById('map-show-services')?.checked;
  const showInfrastructure = document.getElementById('map-show-infrastructure')?.checked;
  const serviceCategory = document.getElementById('map-service-category')?.value || '';
  const infraCategory = document.getElementById('map-infrastructure-category')?.value || '';
  let shownServices = 0;
  let shownInfra = 0;

  if (showServices) {
    SERVICES_GEOJSON.features
      .filter(feature => featureInVisibleArea(feature))
      .filter(feature => {
        const categories = featureServiceCategoriesV4(feature);
        return !serviceCategory || categories.includes(serviceCategory);
      })
      .slice(0, 500)
      .forEach(feature => {
        const [lon, lat] = feature.geometry.coordinates;
        const categories = featureServiceCategoriesV4(feature);
        const category = serviceCategory || categories[0] || 'atractivos';
        const marker = L.marker([lat, lon], {
          icon: contextMarkerIcon(category, 'service'),
          pane: MAP_PANES.services,
          zIndexOffset: 0,
          riseOnHover: true,
          riseOffset: 120,
        });

        marker.bindPopup(`
          <div class="context-popup">
            <span>${escapeHtml(SERVICE_LABELS[category] || 'Servicio')}</span>
            <strong>${escapeHtml(feature.properties.nombre)}</strong>
            <p>${escapeHtml(feature.properties.clase_actividad || '')}</p>
            <small>${escapeHtml(feature.properties.direccion || '')}</small>
          </div>`);

        servicesLayer.addLayer(marker);
        shownServices += 1;
      });
  }

  if (showInfrastructure) {
    INFRA_GEOJSON.features
      .filter(feature => featureInVisibleArea(feature))
      .filter(feature =>
        !infraCategory || feature.properties.categoria === infraCategory
      )
      .slice(0, 500)
      .forEach(feature => {
        const [lon, lat] = feature.geometry.coordinates;
        const category = feature.properties.categoria;
        const marker = L.marker([lat, lon], {
          icon: contextMarkerIcon(category, 'infrastructure'),
          pane: MAP_PANES.infrastructure,
          zIndexOffset: 0,
          riseOnHover: true,
          riseOffset: 120,
        });

        marker.bindPopup(`
          <div class="context-popup">
            <span>${escapeHtml(INFRA_LABELS[category] || feature.properties.categoria_label)}</span>
            <strong>${escapeHtml(feature.properties.nombre)}</strong>
            <p>${escapeHtml(feature.properties.subcategoria || '')}</p>
            <small>Fuente: Red Nacional de Caminos 2025, INEGI</small>
          </div>`);

        infrastructureLayer.addLayer(marker);
        shownInfra += 1;
      });
  }

  const note = document.getElementById('map-context-note');
  if (note) {
    if (!showServices && !showInfrastructure) {
      note.textContent = 'Activa una capa y acércate al territorio para consultar el contexto.';
    } else if (showServices && showInfrastructure) {
      note.textContent = `${shownServices} servicios y ${shownInfra} puntos de conectividad visibles en esta zona.`;
    } else if (showServices) {
      note.textContent = `${shownServices} servicios visibles en esta zona.`;
    } else {
      note.textContent = `${shownInfra} puntos de conectividad visibles en esta zona.`;
    }
  }

  updateContextLegendV4();
}

function buildMapLegend() {
  updateContextLegendV4();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopExploreCarouselTimerV4();
  else restartExploreCarouselTimerV4();
});


// ══════════════════════════════════════════════════════
// MAPA MÓVIL ESTABLE Y CONTROLES RESPONSIVOS — V5
// ══════════════════════════════════════════════════════
let RESPONSIVE_MAP_READY_V5 = false;
let MAP_RESIZE_FRAME_V5 = 0;
let MOBILE_MAP_MODE_V5 = null;

function isMobileMapV5() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function scheduleMapResizeV5(delay = 0) {
  if (!MAP) return;
  window.setTimeout(() => {
    if (MAP_RESIZE_FRAME_V5) window.cancelAnimationFrame(MAP_RESIZE_FRAME_V5);
    MAP_RESIZE_FRAME_V5 = window.requestAnimationFrame(() => {
      MAP_RESIZE_FRAME_V5 = 0;
      const container = MAP.getContainer?.();
      if (!container || container.offsetWidth < 1 || container.offsetHeight < 1) return;
      MAP.invalidateSize({ pan: false, debounceMoveend: true });
    });
  }, delay);
}

function setFilterPanelStateV5(collapsed) {
  const panel = document.getElementById('map-filter-panel');
  const button = document.getElementById('map-filter-panel-toggle');
  if (!panel) return;

  panel.classList.toggle('is-collapsed', collapsed);
  button?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  document.body.classList.toggle('map-filters-open', isMobileMapV5() && !collapsed);

  if (collapsed) {
    panel.querySelectorAll('.map-check-filter[open]').forEach(details => details.removeAttribute('open'));
  }
  scheduleMapResizeV5(80);
}

function syncMobileMapModeV5({ initial = false } = {}) {
  const mobile = isMobileMapV5();
  const changed = MOBILE_MAP_MODE_V5 !== mobile;
  MOBILE_MAP_MODE_V5 = mobile;

  const panel = document.getElementById('map-filter-panel');
  if (!panel) return;

  if (mobile && (initial || changed)) {
    setFilterPanelStateV5(true);
  } else if (!mobile && changed) {
    document.body.classList.remove('map-filters-open');
    setFilterPanelStateV5(false);
  } else {
    document.body.classList.toggle('map-filters-open', mobile && !panel.classList.contains('is-collapsed'));
  }

  scheduleMapResizeV5(120);
}

function hideMapLoadStatusV5() {
  const status = document.getElementById('map-load-status');
  if (!status) return;
  status.classList.remove('is-error');
  status.classList.add('is-hidden');
  status.setAttribute('aria-hidden', 'true');
}

function handleMapLoadFailureV5(error) {
  console.error('No fue posible inicializar el mapa:', error);
  const status = document.getElementById('map-load-status');
  const message = document.getElementById('map-load-message');
  if (status) {
    status.classList.remove('is-hidden');
    status.classList.add('is-error');
    status.removeAttribute('aria-hidden');
  }
  if (message) {
    message.textContent = 'No fue posible cargar el mapa. Revisa tu conexión y vuelve a intentarlo.';
  }
}

function setupResponsiveMapV5() {
  if (!MAP || RESPONSIVE_MAP_READY_V5) return;
  RESPONSIVE_MAP_READY_V5 = true;

  const panel = document.querySelector('.map-panel');
  const filterToggle = document.getElementById('map-filter-panel-toggle');

  syncMobileMapModeV5({ initial: true });

  filterToggle?.addEventListener('click', () => {
    // El controlador principal cambia la clase primero; aquí sincronizamos
    // el estado global y recalculamos el tamaño real del mapa.
    window.requestAnimationFrame(() => {
      const collapsed = document.getElementById('map-filter-panel')?.classList.contains('is-collapsed');
      document.body.classList.toggle('map-filters-open', isMobileMapV5() && !collapsed);
      scheduleMapResizeV5(80);
    });
  });

  const resizeHandler = () => syncMobileMapModeV5();
  window.addEventListener('resize', resizeHandler, { passive: true });
  window.addEventListener('orientationchange', () => {
    syncMobileMapModeV5();
    scheduleMapResizeV5(250);
  }, { passive: true });
  window.visualViewport?.addEventListener('resize', () => scheduleMapResizeV5(80), { passive: true });

  if ('ResizeObserver' in window && panel) {
    const observer = new ResizeObserver(() => scheduleMapResizeV5());
    observer.observe(panel);
  }

  MAP.whenReady(() => {
    scheduleMapResizeV5();
    window.setTimeout(hideMapLoadStatusV5, 220);
  });

  // Segunda medición después de que fuentes, encabezado y controles terminen
  // de acomodarse, especialmente importante en Safari móvil.
  scheduleMapResizeV5(350);
  scheduleMapResizeV5(900);
}


// ══════════════════════════════════════════════════════
// FICHA MÓVIL COMO MODAL — V6
// ══════════════════════════════════════════════════════
let FICHA_RETURN_FOCUS_V6 = null;
let FICHA_MODAL_READY_V6 = false;

function isMobileFichaV6() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function fichaIsOpenV6() {
  const panel = document.getElementById('panel-ficha');
  return Boolean(panel && panel.style.display !== 'none');
}

function syncFichaPresentationV6() {
  const panel = document.getElementById('panel-ficha');
  const backdrop = document.getElementById('mobile-ficha-backdrop');
  const modalMode = fichaIsOpenV6() && isMobileFichaV6();

  document.body.classList.toggle('mobile-ficha-open', modalMode);

  if (backdrop) {
    backdrop.hidden = !modalMode;
    backdrop.classList.toggle('is-open', modalMode);
    backdrop.setAttribute('aria-hidden', modalMode ? 'false' : 'true');
  }

  if (!panel) return;
  if (modalMode) {
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Ficha de experiencia turística');
    MAP?.closePopup();
  } else {
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
    panel.removeAttribute('aria-label');
  }
}

function openFichaPresentationV6() {
  if (isMobileFichaV6()) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      FICHA_RETURN_FOCUS_V6 = active;
    }
  }

  syncFichaPresentationV6();

  if (isMobileFichaV6()) {
    window.setTimeout(() => document.getElementById('ficha-back')?.focus(), 40);
  }
}

function closeFichaV6() {
  const panel = document.getElementById('panel-ficha');
  const welcome = document.getElementById('panel-welcome');

  if (panel) {
    panel.style.display = 'none';
    panel.setAttribute('aria-hidden', 'true');
  }
  if (welcome) welcome.style.display = '';

  document.body.classList.remove('mobile-ficha-open');
  const backdrop = document.getElementById('mobile-ficha-backdrop');
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.classList.remove('is-open');
    backdrop.setAttribute('aria-hidden', 'true');
  }

  setSelectedExperienceMarker(null, { openPopup: false });
  MAP?.closePopup();
  updateExplorePanel(CURRENT_MAP_DATA);
  scheduleMapResizeV5(80);

  const returnFocus = FICHA_RETURN_FOCUS_V6;
  FICHA_RETURN_FOCUS_V6 = null;
  if (returnFocus?.isConnected) {
    window.setTimeout(() => returnFocus.focus({ preventScroll: true }), 30);
  }
}
window.closeFichaV6 = closeFichaV6;

function setupFichaModalV6() {
  if (FICHA_MODAL_READY_V6) return;
  FICHA_MODAL_READY_V6 = true;

  document.getElementById('mobile-ficha-backdrop')?.addEventListener('click', closeFichaV6);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && fichaIsOpenV6()) closeFichaV6();
  });

  const sync = () => {
    syncFichaPresentationV6();
    scheduleMapResizeV5(80);
  };
  window.addEventListener('resize', sync, { passive: true });
  window.addEventListener('orientationchange', sync, { passive: true });
}

document.addEventListener('DOMContentLoaded', setupFichaModalV6);


// ══════════════════════════════════════════════════════
// FILTROS DEL CATÁLOGO FIJOS Y PLEGABLES EN MÓVIL — V7
// ══════════════════════════════════════════════════════
let CATALOG_FILTERS_READY_V7 = false;
let CATALOG_FILTERS_MOBILE_V7 = null;

function isMobileCatalogV7() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function catalogActiveFilterCountV7() {
  const search = document.getElementById('cat-search')?.value.trim() || '';
  const selects = ['cat-estado', 'cat-municipio', 'cat-tipo'];
  return (search ? 1 : 0) + selects.reduce((total, id) => {
    return total + (document.getElementById(id)?.value ? 1 : 0);
  }, 0);
}

function updateCatalogMobileFilterStatusV7(resultCount = null) {
  const status = document.getElementById('catalogo-filter-mobile-status');
  if (!status) return;

  const countFromGrid = document.querySelectorAll('#catalogo-grid .cat-card').length;
  const total = Number.isFinite(resultCount) ? resultCount : countFromGrid;
  const active = catalogActiveFilterCountV7();
  const experienceLabel = `${total} experiencia${total === 1 ? '' : 's'}`;
  const filterLabel = active
    ? `${active} filtro${active === 1 ? '' : 's'} activo${active === 1 ? '' : 's'}`
    : 'sin filtros';

  status.textContent = `${experienceLabel} · ${filterLabel}`;
}

function setCatalogFiltersCollapsedV7(collapsed, { focusToggle = false } = {}) {
  const panel = document.getElementById('catalogo-filters');
  const toggle = document.getElementById('catalogo-filter-mobile-toggle');
  const action = document.getElementById('catalogo-filter-mobile-action');
  if (!panel || !toggle) return;

  panel.classList.toggle('is-collapsed', collapsed);
  toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (action) action.textContent = collapsed ? 'Mostrar' : 'Ocultar';

  if (focusToggle) toggle.focus({ preventScroll: true });
}

function syncCatalogFiltersMobileV7({ initial = false } = {}) {
  const mobile = isMobileCatalogV7();
  const changed = CATALOG_FILTERS_MOBILE_V7 !== mobile;
  CATALOG_FILTERS_MOBILE_V7 = mobile;

  if (mobile && (initial || changed)) {
    setCatalogFiltersCollapsedV7(true);
  } else if (!mobile && changed) {
    setCatalogFiltersCollapsedV7(false);
  }

  updateCatalogMobileFilterStatusV7();
}

function setupCatalogFiltersMobileV7() {
  if (CATALOG_FILTERS_READY_V7) return;
  CATALOG_FILTERS_READY_V7 = true;

  const toggle = document.getElementById('catalogo-filter-mobile-toggle');
  toggle?.addEventListener('click', () => {
    const panel = document.getElementById('catalogo-filters');
    if (!panel) return;
    setCatalogFiltersCollapsedV7(!panel.classList.contains('is-collapsed'));
  });

  ['cat-search', 'cat-estado', 'cat-municipio', 'cat-tipo'].forEach(id => {
    const control = document.getElementById(id);
    control?.addEventListener(id === 'cat-search' ? 'input' : 'change', () => {
      window.requestAnimationFrame(() => updateCatalogMobileFilterStatusV7());
    });
  });

  document.getElementById('cat-clear-filters')?.addEventListener('click', () => {
    window.requestAnimationFrame(() => updateCatalogMobileFilterStatusV7(ALL_DATA.length));
  });

  const media = window.matchMedia('(max-width: 760px)');
  const mediaHandler = () => syncCatalogFiltersMobileV7();
  if (typeof media.addEventListener === 'function') media.addEventListener('change', mediaHandler);
  else if (typeof media.addListener === 'function') media.addListener(mediaHandler);

  window.addEventListener('orientationchange', () => {
    window.setTimeout(() => syncCatalogFiltersMobileV7(), 120);
  }, { passive: true });

  syncCatalogFiltersMobileV7({ initial: true });
}

window.syncCatalogFiltersMobileV7 = syncCatalogFiltersMobileV7;
document.addEventListener('DOMContentLoaded', setupCatalogFiltersMobileV7);
