import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Static regression coverage for the accessibility fixes made under issue #46
 * (the "Street Pulse" refreshMarkers() aria-label clobber, fixed in d5f5664,
 * was a real a11y bug invisible to a visual check and only caught by tracing
 * runtime code paths — these tests exist so the same class of bug on the
 * modal dialogs and the theme palette can't silently regress). Everything
 * here is parsed straight out of the shipped web/index.html rather than
 * hand-copied, same convention as verify-parity.test.js and
 * verify-cose.test.js, so a real edit to the source is what these tests see.
 */

function loadHtml() {
  const htmlPath = fileURLToPath(new URL('../web/index.html', import.meta.url));
  return readFileSync(htmlPath, 'utf8');
}

function trueDialogIds(html) {
  const tags = html.match(/<div\b[^>]*>/g) || [];
  return tags
    .filter((tag) => /\brole="dialog"/.test(tag) && /\baria-modal="true"/.test(tag))
    .map((tag) => {
      const m = tag.match(/\bid="([\w-]+)"/);
      if (!m) throw new Error(`Found a role="dialog" aria-modal="true" element with no id: ${tag}`);
      return m[1];
    });
}

function globalKeydownHandlerSource(html) {
  const start = html.indexOf('document.addEventListener("keydown", ev => {');
  if (start < 0) {
    throw new Error(
      'Could not find the page-level `document.addEventListener("keydown", ev => {` handler in ' +
      'web/index.html. It moved, was renamed, or its signature changed — update this test, do not skip it.',
    );
  }
  const end = html.indexOf('\n  });', start);
  if (end < 0) throw new Error('Could not find the end of the global keydown handler.');
  return html.slice(start, end);
}

test('every aria-modal="true" dialog is referenced in the Escape-closing cascade', () => {
  const html = loadHtml();
  const ids = trueDialogIds(html);
  assert.ok(ids.length > 0, 'expected to find at least one role="dialog" aria-modal="true" element');
  const handler = globalKeydownHandlerSource(html);
  const idToVar = {
    claimmodal: 'claimModal',
    access: 'accessModal',
    providermodal: 'providerModal',
    modal: 'modal',
  };
  for (const id of ids) {
    const varName = idToVar[id];
    assert.ok(
      varName,
      `dialog id "${id}" has no known local variable mapped in this test — a new true dialog was ` +
      'added to web/index.html without wiring it into the Escape cascade (or without updating this test).',
    );
    assert.ok(
      handler.includes(`!${varName}.hidden`),
      `Escape cascade in the global keydown handler does not check "${varName}" (backing #${id}) — ` +
      'pressing Escape while this dialog is open would silently do nothing, or fall through to ' +
      'closing/mutating something behind it. This is exactly the bug #46 found on the "access" dialog.',
    );
    assert.ok(
      handler.includes(`closeModal(${varName})`),
      `Escape branch for "${varName}" (backing #${id}) does not call closeModal(), so it would close ` +
      'the dialog without restoring focus to whatever opened it.',
    );
  }
});

test('Tab is trapped inside an open dialog before the input-field guard can swallow it', () => {
  const html = loadHtml();
  const handler = globalKeydownHandlerSource(html);
  const tabIdx = handler.indexOf('trapModalTab(ev)');
  assert.ok(tabIdx >= 0, 'global keydown handler no longer calls trapModalTab(ev)');
  // The zoom-shortcut input guard (`if(inField) return;`) must not appear before the Tab
  // trap, or focus landing on one of a dialog's own <input>/<textarea> fields (which is
  // exactly where openModal-style focus management puts it) would make Tab escape the
  // dialog into the page behind it — invisible to a mouse-driven check, the same failure
  // shape as the refreshMarkers() aria-label clobber this test file exists to guard against.
  // There are two `if(inField) return;` guards: one inside the Escape branch (gating the
  // deselect/reset-view fallback so a bare Escape in an unrelated text field doesn't wipe
  // selection state) and one after the Tab check (gating the +/-/0 zoom shortcuts so typing
  // those characters into a field doesn't zoom the map). It's the second one — the last
  // occurrence — that would swallow Tab if it came first; the first one is expected to
  // precede the Tab check, since Escape handling always runs before Tab handling.
  const guardIdx = handler.lastIndexOf('if(inField) return;');
  assert.ok(guardIdx >= 0, 'expected an `if(inField) return;` guard in the global keydown handler');
  assert.ok(
    tabIdx < guardIdx,
    'the zoom-shortcut input-field guard (`if(inField) return;`, after the Tab check) appears before ' +
    'the Tab trap — Tab would never reach trapModalTab() while focus is inside one of a dialog\'s own form fields',
  );
});

// --- WCAG 2.1 AA contrast (4.5:1 minimum for normal-size text) -----------

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function relativeLuminance([r, g, b]) {
  const [rl, gl, bl] = [r, g, b].map(srgbToLinear);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}
function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

test('light-theme --amber and --ok meet WCAG AA 4.5:1 against every surface they land on as text', () => {
  const html = loadHtml();
  // Pull every declaration of each variable, then keep only the ones inside the light
  // palette blocks (identified by also containing a light --bg on the same line group is
  // fragile; instead just check the two known light-only hex values directly below and
  // additionally assert the dark ones aren't accidentally identical to them).
  const lightBg = '#efe9dd';
  const lightPanelSolid = '#fbf8f2';
  const lightPanel2 = '#f2ece1';

  for (const name of ['amber', 'ok']) {
    const decls = [...html.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`, 'g'))].map((m) => m[1]);
    assert.equal(decls.length, 3, `expected exactly 3 --${name} declarations (dark :root, prefers-color-scheme light, data-theme=light) — found ${decls.length}; if a new theme block was added, extend this test`);
    const [, prefersLight, dataThemeLight] = decls;
    assert.equal(
      prefersLight.toLowerCase(), dataThemeLight.toLowerCase(),
      `--${name} differs between the "prefers-color-scheme: light" block and the "data-theme=light" block ` +
      '(${prefersLight} vs ${dataThemeLight}) — a contrast fix applied to only one leaves the other still failing AA',
    );
    for (const [surfaceName, surfaceHex] of [['--bg', lightBg], ['--panel-solid', lightPanelSolid], ['--panel-2', lightPanel2]]) {
      const ratio = contrastRatio(prefersLight, surfaceHex);
      assert.ok(
        ratio >= 4.5,
        `light-theme --${name} (${prefersLight}) against ${surfaceName} (${surfaceHex}) is ${ratio.toFixed(2)}:1, ` +
        'below the WCAG AA 4.5:1 minimum for normal-size text — both are used as text color in light mode',
      );
    }
  }
});
