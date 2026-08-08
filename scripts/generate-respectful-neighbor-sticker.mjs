import { mkdir, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';

const target = 'https://github.com/writerslogic/onrecord/blob/main/docs/respectful-neighbor-tent-placard.md';
const qr = await QRCode.toString(target, { type: 'svg', errorCorrectionLevel: 'H', margin: 1, color: { dark: '#111111', light: '#ffffff' } });
const inner = qr.slice(qr.indexOf('>') + 1, qr.lastIndexOf('</svg>'));
const sticker = `<svg xmlns="http://www.w3.org/2000/svg" width="3.5in" height="2.5in" viewBox="0 0 1050 750" role="img" aria-labelledby="title desc">
<title id="title">Respectful Neighbor Commitment</title><desc id="desc">Living outdoors with dignity, accountability, and respect. Scan for the community standard.</desc>
<rect width="1050" height="750" rx="42" fill="#fffdf7"/><rect x="18" y="18" width="1014" height="714" rx="30" fill="none" stroke="#111" stroke-width="12"/>
<text x="525" y="92" text-anchor="middle" font-family="Arial,sans-serif" font-size="47" font-weight="800" letter-spacing="4">RESPECTFUL NEIGHBOR</text>
<text x="525" y="150" text-anchor="middle" font-family="Arial,sans-serif" font-size="47" font-weight="800" letter-spacing="4">COMMITMENT</text>
<text x="525" y="198" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-style="italic">Living outdoors with dignity, accountability, and respect.</text>
<rect x="350" y="225" width="350" height="350" fill="#fff"/><g transform="translate(350 225)">${inner}</g>
<text x="525" y="620" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="700">SCAN FOR THE SHARED STANDARD</text>
<text x="525" y="660" text-anchor="middle" font-family="Arial,sans-serif" font-size="18">Clean space · clear paths · quiet hours · safe cooperation</text>
<text x="525" y="704" text-anchor="middle" font-family="Arial,sans-serif" font-size="15">Voluntary pledge — not a lease or legal authorization</text></svg>`;
await mkdir('web/forms', { recursive: true });
await writeFile('web/forms/respectful-neighbor-sticker.svg', sticker);
console.log(`wrote web/forms/respectful-neighbor-sticker.svg (QR target: ${target})`);
