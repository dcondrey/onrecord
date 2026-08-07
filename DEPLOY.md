# On Record — build & deploy to writerslogic.com/onrecord/

Everything runs client-side. No build step, no backend, no dependencies.
The page generates its signing key in the browser and makes **zero network
requests** (that claim is enforced by the CSP in `_headers`).

## Files in this folder
- `index.html` ......... the app. **You create this — see step 1.**
- `guide-me.snippet.html`  the self-driving "Guide me" walkthrough (paste in).
- `_headers` ........... Cloudflare Pages security + caching headers.
- `DEPLOY.md` ......... this file.

---

## Step 1 — save your working artifact as index.html
In your Claude artifact, copy the full HTML and save it here as:

    ~/Downloads/onrecord/index.html

(This is your known-good copy. Do not hand-retype it.)

## Step 2 — add the "Guide me" tour
Open `index.html`, and paste the ENTIRE contents of `guide-me.snippet.html`
immediately **before** the closing `</body>` tag. Save.

## Step 3 — soften the ALLEGED figure (defamation safety)
Find this text in `index.html`:

    Placeholder for annual public convention and tourism promotion spend. Not sourced, must not be cited.

Replace it with:

    Illustrative placeholder only. A round figure, not attributed to any real entity, agency, or budget — shown to demonstrate the promise-vs-proof mechanic.

This keeps the promise-vs-proof mechanic while making even a cropped screenshot
impossible to read as an accusation against a real organization.

## Step 4 — smoke test locally
    cd ~/Downloads/onrecord && python3 -m http.server 8080
Open http://localhost:8080/index.html — confirm:
- key chip turns green ("ES256 … sealed")
- click a neighborhood → pin → Story → Their words/AI toggle
- Verify (green) → Tamper (pin turns red, seal breaks) → Restore
- "Guide me" runs the whole arc and ends on the non-response %
- DevTools ▸ Network shows **no requests** after the HTML itself

---

## Step 5 — deploy to Cloudflare

### Option A — Cloudflare Pages, direct upload (fastest, no git)
1. Put `index.html` inside a folder named `onrecord/` at the upload root, and
   put `_headers` at that root:
       dist/
       ├─ _headers
       └─ onrecord/
          └─ index.html
2. `npx wrangler pages deploy dist --project-name=writerslogic`
   (first run will prompt you to log in / create the project)
3. Point the custom domain `writerslogic.com` at the Pages project in the
   Cloudflare dashboard (Workers & Pages ▸ your project ▸ Custom domains).
4. Live at **https://writerslogic.com/onrecord/**

### Option B — existing site already on Cloudflare Pages (git)
1. Copy `onrecord/index.html` into your site repo at `onrecord/index.html`.
2. Merge the `/onrecord/*` block from `_headers` into your repo's root `_headers`
   (create it at the site root if you don't have one).
3. Commit and push — Pages rebuilds and serves /onrecord/ automatically.

### Option C — Cloudflare dashboard drag-and-drop
Workers & Pages ▸ Create ▸ Pages ▸ Upload assets ▸ drag the `dist/` folder
from Option A. Attach the custom domain afterward.

## Notes
- HTTPS is required for WebCrypto — Cloudflare provides it automatically.
- The page is one file; caching is short (5 min) so demo edits show up fast.
- To confirm the "no network" promise on the live URL, open DevTools ▸ Network
  and reload: only `index.html` should appear.
