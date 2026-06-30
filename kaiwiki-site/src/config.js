export const siteConfig = {
  property: {
    address: '2107 Kaiwiki Rd, Hilo, Hawaii',
    priceLabel: '$1.24M target price',
    beds: '7 bedrooms',
    baths: '5 baths',
    income: 'Approximately $7,850/month current rent income',
    status: 'Private sale',
    facts: [
      'Rare ocean views for Hilo',
      'Updated appliances',
      'Fresh interior paint',
      'Covered lanais serving three current occupied areas',
      'Current occupants are month-to-month',
      'Main house is permitted as a 7-bedroom, 5-bath residence',
      'Separate-entry occupied living areas; two include efficiency kitchens'
    ]
  },
  forms: {
    provider: 'netlify',
    callbackFormName: 'kaiwiki-call-back',
    offerFormName: 'kaiwiki-offer',
    // Optional Formspree endpoints can be configured at deploy time without placing recipient emails in page source.
    callbackEndpoint: '',
    offerEndpoint: ''
  },
  contact: {
    displayName: 'Nick',
    phoneLabel: '808-330-9526',
    phoneHref: 'tel:8083309526',
    emailLabel: 'hawaiianduckwon@yahoo.com',
    emailHref: 'mailto:hawaiianduckwon@yahoo.com',
    callToAction: 'Request details, disclosures, and a private conversation with Nick.',
    contactNote: 'Call Nick or email Nick directly, or use the forms below for a call-back request or offer details.'
  },
  gallery: [
    // Add selected optimized images in /public/images/site/ and list them here as { src, alt, purpose }.
  ]
};
