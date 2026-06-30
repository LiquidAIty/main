import { siteConfig } from './config.js';
import './styles.css';

const { property, forms, contact, gallery } = siteConfig;
const configuredGallery = gallery.length ? gallery : [{ src: '/images/site/og-image.svg', alt: 'Graphic placeholder for 2107 Kaiwiki Rd while professional photos are added.', purpose: 'Temporary Open Graph and hero placeholder' }];

function formAction(endpoint) {
  return endpoint || '/';
}

function input(name, label, type = 'text', required = true, extra = '') {
  return `<label><span>${label}</span><input name="${name}" type="${type}" ${required ? 'required' : ''} ${extra}></label>`;
}

function textarea(name, label, placeholder = '') {
  return `<label class="wide"><span>${label}</span><textarea name="${name}" rows="5" placeholder="${placeholder}" required></textarea></label>`;
}

function inquiryForm() {
  return `<form name="${forms.callbackFormName}" method="POST" data-netlify="true" netlify-honeypot="bot-field" action="${formAction(forms.callbackEndpoint)}" class="card form-card">
    <input type="hidden" name="form-name" value="${forms.callbackFormName}">
    <p class="hidden"><label>Do not fill this out: <input name="bot-field"></label></p>
    <h3>Request a Call Back</h3>
    <div class="form-grid">
      ${input('name', 'Name')}
      ${input('email', 'Email', 'email')}
      ${input('phone', 'Phone', 'tel')}
      <label><span>Intended use</span><select name="intended-use" required><option value="">Select one</option><option>Owner-use / Hawaii base</option><option>Long-term income property</option><option>Hybrid owner-use plus current income</option><option>Still evaluating</option></select></label>
      ${textarea('message', 'Message', 'Share your timing, questions, and whether you would like disclosure details.')}
    </div>
    <button type="submit">Request call back</button>
  </form>`;
}

function offerForm() {
  return `<form name="${forms.offerFormName}" method="POST" data-netlify="true" netlify-honeypot="bot-field" action="${formAction(forms.offerEndpoint)}" class="card form-card accent-card">
    <input type="hidden" name="form-name" value="${forms.offerFormName}">
    <p class="hidden"><label>Do not fill this out: <input name="bot-field"></label></p>
    <h3>Make an Offer</h3>
    <div class="form-grid">
      ${input('name', 'Name')}
      ${input('email', 'Email', 'email')}
      ${input('phone', 'Phone', 'tel')}
      ${input('offer-amount', 'Offer amount', 'text', true, 'inputmode="decimal"')}
      ${input('timing', 'Desired timing')}
      <label><span>Financing / cash status</span><select name="financing-status" required><option value="">Select one</option><option>Cash</option><option>Pre-approved financing</option><option>Financing in progress</option><option>Other / to discuss</option></select></label>
      <label><span>Intended use</span><select name="intended-use" required><option value="">Select one</option><option>Owner-use / Hawaii base</option><option>Long-term income property</option><option>Hybrid owner-use plus current income</option><option>Still evaluating</option></select></label>
      ${textarea('conditions', 'Conditions', 'Inspection, financing, occupancy, diligence, or other offer conditions.')}
      ${textarea('message', 'Message', 'Anything else the seller should understand about your offer?')}
    </div>
    <button type="submit">Submit offer details</button>
  </form>`;
}

const hero = configuredGallery[0];
document.querySelector('#app').innerHTML = `
<header class="hero" id="top">
  <nav><a href="#top" class="brand">Kaiwiki Rd</a><a href="#gallery">Gallery</a><a href="#inquire">Inquire</a><a class="nav-pill" href="#offer">Make an offer</a></nav>
  <div class="hero-media"><img src="${hero.src}" alt="${hero.alt}" fetchpriority="high"></div>
  <div class="hero-copy"><p class="eyebrow">${property.status} · Hilo, Hawaii</p><h1>Large Hilo home with rare ocean views, flexible layout, and current income.</h1><p class="lead">${property.address} pairs a substantial permitted 7-bedroom, 5-bath residence with covered lanais, fresh interior paint, updated appliances, and flexible separate-entry living areas.</p><div class="hero-actions"><a class="button call-button" href="${contact.phoneHref}">Call Nick</a><a class="button" href="#inquire">Request a call back</a><a class="button ghost" href="#offer">Make an offer</a></div></div>
</header>
<main>
<section class="facts"><div class="fact"><strong>${property.priceLabel}</strong><span>Private-sale guidance</span></div><div class="fact"><strong>${property.beds}</strong><span>Main house permitted residence</span></div><div class="fact"><strong>${property.baths}</strong><span>Across the residence</span></div><div class="fact"><strong>${property.income}</strong><span>Current occupants month-to-month</span></div></section>
<section class="split"><div><p class="eyebrow">Lifestyle and views</p><h2>Hilo living with ocean-view moments that are uncommon for the area.</h2></div><p>The buyer story is simple: space, views, covered outdoor living, and a flexible layout. The site is intentionally calm and image-forward so professional photography can carry the experience when added to <code>public/images/site/</code>.</p></section>
<section class="card-grid">${property.facts.map((f) => `<article class="card"><span></span><p>${f}</p></article>`).join('')}</section>
<section class="income"><p class="eyebrow">Flexible living and income</p><h2>Separate-entry living areas support several ownership strategies.</h2><p>The property currently has separate-entry occupied living areas; two include efficiency kitchens. Current rent income is approximately $7,850/month, and current occupants are month-to-month. These spaces are described carefully as flexible separate-entry living areas, not as permitted rental units.</p></section>
<section id="gallery" class="gallery-section"><div class="section-heading"><p class="eyebrow">Photo gallery</p><h2>Selected professional images</h2><p>Professional photos were not present in this workspace, so the gallery is ready for the selected 12–16 images once copied into <code>public/images/site/</code>.</p></div><div class="gallery">${configuredGallery.map((img, i) => `<button class="gallery-item" data-index="${i}"><img loading="lazy" src="${img.src}" alt="${img.alt}"><span>${img.purpose}</span></button>`).join('')}</div></section>
<section class="buyer-fit"><p class="eyebrow">Buyer fit</p><h2>Three ways a serious buyer may underwrite the opportunity.</h2><div class="fit-grid"><article><h3>Owner-user / Hawaii base</h3><p>A large Hilo residence with room for extended stays, visiting family, work-from-Hawaii rhythms, and covered lanai living.</p></article><article><h3>Long-term income-property buyer</h3><p>Current income and month-to-month occupancy may appeal to a buyer evaluating a long-term hold, subject to diligence.</p></article><article><h3>Hybrid owner-use plus current income</h3><p>A buyer may evaluate using part of the property while maintaining income from separate-entry living areas, subject to all approvals and intended use review.</p></article></div></section>
<section id="inquire" class="inquiry"><div><p class="eyebrow">Private sale</p><h2>Serious inquiries only.</h2><p>${contact.callToAction}</p><div class="contact-card"><a class="button call-button" href="${contact.phoneHref}">Call Nick: ${contact.phoneLabel}</a><a class="contact-link" href="${contact.emailHref}">Email Nick: ${contact.emailLabel}</a></div><p class="note">${contact.contactNote}</p></div>${inquiryForm()}</section>
<section id="offer" class="offer">${offerForm()}</section>
<section class="disclosure"><p class="eyebrow">Buyer due diligence</p><h2>Important disclosure</h2><p>Buyer should independently verify permits, bedroom and bath counts, occupancy, tenancy terms, zoning, rental legality, financing suitability, insurance, taxes, condition, square footage, boundaries, and intended use. The separate-entry living areas are not represented here as permitted rental units.</p></section>
</main><footer><strong>${property.address}</strong><span>${contact.displayName} · Private sale</span><span class="footer-contact"><a href="${contact.phoneHref}">Call Nick: ${contact.phoneLabel}</a><a href="${contact.emailHref}">Email Nick: ${contact.emailLabel}</a></span><a href="#top">Back to top</a></footer>
<div class="lightbox" aria-hidden="true"><button aria-label="Close gallery">×</button><img alt=""><p></p></div>`;

const lightbox = document.querySelector('.lightbox');
document.querySelectorAll('.gallery-item').forEach((button) => button.addEventListener('click', () => {
  const img = configuredGallery[Number(button.dataset.index)];
  lightbox.querySelector('img').src = img.src;
  lightbox.querySelector('img').alt = img.alt;
  lightbox.querySelector('p').textContent = img.purpose;
  lightbox.setAttribute('aria-hidden', 'false');
}));
lightbox.querySelector('button').addEventListener('click', () => lightbox.setAttribute('aria-hidden', 'true'));
