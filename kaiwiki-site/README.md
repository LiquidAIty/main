# 2107 Kaiwiki Rd One-Page Property Site

Premium, mobile-first private-sale website for 2107 Kaiwiki Rd, Hilo, Hawaii.

## Local setup

No install step is required for the static site.

```bash
cd kaiwiki-site
npm run dev
```

## Production build

```bash
cd kaiwiki-site
npm run build
npm run preview
```

## Photo workflow

1. Place professional images in `public/images/originals/`.
2. Place Zillow/reference-only images in `public/images/reference-only/`.
3. Inspect all originals and choose the strongest 12–16.
4. Optimize and copy selected files into `public/images/site/`.
5. Add those selected files to `src/config.js` in the `gallery` array.
6. Update `photo-selection.md` with each chosen file and purpose.

Reference-only images should not be used unless they show a feature missing from the professional photos.

## Forms and recipient routing

The forms are Netlify Forms-ready by default and do not place recipient email addresses in the HTML source. Configure form notification recipients inside the Netlify dashboard.

For Formspree, set `forms.callbackEndpoint` and `forms.offerEndpoint` in `src/config.js` to the generated endpoint URLs. Keep recipient emails configured in the provider dashboard.

## Editable content

Property facts, price label, form names, optional form endpoints, contact display text, and the gallery are configured in `src/config.js`.

## Deployment

### Netlify preview link

This folder includes `netlify.toml`, so a repo connected to Netlify can create a shareable Deploy Preview automatically for every pull request. Use these settings if configuring manually:

- Base directory: `kaiwiki-site`
- Build command: `npm run build`
- Publish directory: `kaiwiki-site/dist`

After the repo is connected, open the Netlify pull-request deploy preview URL and share it. Form notification recipients should be configured in the Netlify dashboard.

### GitHub Pages preview link

This repo also includes `.github/workflows/kaiwiki-site-pages.yml`. If GitHub Pages is enabled for GitHub Actions, pushing changes to `main` or `work` or manually running the workflow publishes the built site from `kaiwiki-site/dist`. The workflow summary exposes the shareable Pages URL after deployment.

### Local network preview

For a same-network preview from your machine:

```bash
cd kaiwiki-site
npm run dev
```

Then open `http://localhost:5173`. To share outside your machine, use Netlify, GitHub Pages, or another static host rather than exposing the local server directly.
