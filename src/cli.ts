#!/usr/bin/env node
/**
 * on-record CLI.
 *
 *   on-record add       raw story (stdin or --file) -> Claude transform -> sign -> append
 *   on-record withdraw  remove an entry from the public record for good, at the requester's word
 *   on-record verify    independent re-check of every signature in a file
 *   on-record seed      write the composite sample set
 *   on-record serve     serves the viewer + data, plus a no-JS /add intake form (127.0.0.1 by default)
 *   on-record keys      show the signing key in use
 */

import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { stat } from 'node:fs/promises';

import {
  ValidationError,
  ZONES,
  CATEGORIES,
  STATUSES,
  type Entry,
} from './schema.js';
import { keyFingerprint, loadOrCreateKeyPair } from './sign.js';
import { modelId } from './transform.js';
import { verifyFile } from './verify.js';
import { ENTRIES_PATH, DATA_DIR, runSeed } from './seed.js';
import { didKeyFromPublicJwk, verificationMethodForDid } from './did.js';
import { signC2paAsset } from './c2pa.js';
import { exportRecordBundle } from './export.js';
import { addEntry, AddEntryError, type AddEntryInput } from './add.js';
import { withdrawEntry, WithdrawError, WITHDRAWN_LOG_PATH } from './withdraw.js';
import { renderIntakeForm, renderIntakeSuccess, parseIntakeFields } from './intake-form.js';
import { enqueueIntake } from './intake-queue.js';
import { readBody } from './http-body.js';
import { handleSmsWebhook, PENDING_REVIEW_PATH } from './gateway/sms.js';

// --- output helpers ---------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env['NO_COLOR'];
const c = {
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
};

function out(line = ''): void {
  process.stdout.write(line + '\n');
}

function die(message: string, code = 1): never {
  process.stderr.write(c.red('error: ') + message + '\n');
  process.exit(code);
}

function rule(label = ''): void {
  const width = Math.min(process.stdout.columns || 80, 80);
  const text = label ? `── ${label} ` : '';
  out(c.dim(text + '─'.repeat(Math.max(0, width - text.length))));
}

function wrap(text: string, width = 74, indent = '  '): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join('\n');
}

// --- arg parsing ------------------------------------------------------------

interface Args {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        flags.set(token.slice(2, eq), token.slice(eq + 1));
      } else {
        const name = token.slice(2);
        const next = argv[i + 1];
        // Boolean-only flags never consume the next token, even if it doesn't
        // look like a flag — otherwise `on-record verify --json somefile.json`
        // silently eats the positional arg as --json's value, leaving
        // cmdVerify to fall back to the default entries.json and reporting a
        // clean verify of the wrong file instead of erroring.
        if (!BOOLEAN_FLAGS.has(name) && next !== undefined && !next.startsWith('--')) {
          flags.set(name, next);
          i++;
        } else {
          flags.set(name, true);
        }
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

const BOOLEAN_FLAGS = new Set(['json', 'force', 'ai']);

function str(args: Args, name: string): string | undefined {
  const v = args.flags.get(name);
  if (v === true) die(`--${name} was given no value (the next token looked like a flag). Pass a value after --${name}.`);
  return typeof v === 'string' ? v : undefined;
}

function bool(args: Args, name: string): boolean {
  return args.flags.has(name);
}

function required(args: Args, name: string, hint: string): string {
  const v = str(args, name);
  if (!v?.trim()) die(`--${name} is required. ${hint}`);
  return v.trim();
}

// --- shared file helpers ----------------------------------------------------

async function readEntriesFile(path: string): Promise<Entry[]> {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!Array.isArray(parsed)) die(`${path} does not contain a JSON array`);
  return parsed as Entry[];
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

// --- command: add -----------------------------------------------------------

async function cmdAdd(args: Args): Promise<void> {
  const file = str(args, 'file');
  const raw = (file ? await readFile(file, 'utf8') : await readStdin()).trim();

  if (!raw) {
    die(
      'no raw story provided. Pipe it on stdin or pass --file <path>.\n' +
        '  example: echo "he lost his ID..." | on-record add --zone "East Village" ...',
    );
  }

  const input: AddEntryInput = {
    raw,
    zone: required(args, 'zone', `One of: ${ZONES.join(', ')}`),
    category: required(args, 'category', `One of: ${CATEGORIES.join(', ')}`),
    status: str(args, 'status'),
    summary: str(args, 'summary'),
    amount: str(args, 'amount'),
    advocateId: required(
      args,
      'advocate',
      'Entries without a named advocate are refused — consent is not optional.',
    ),
    consentMethod: required(
      args,
      'consent-method',
      'Record how consent was given, e.g. --consent-method "verbal, in person, witnessed".',
    ),
    consentAt: str(args, 'consent-at'),
    orgClaimText: str(args, 'org-claim'),
    orgClaimSource: str(args, 'source'),
    recoveryPhrase: str(args, 'recovery-phrase'),
    recoveryPin: str(args, 'recovery-pin'),
    confirmedDob: str(args, 'confirm-dob'),
    first3: str(args, 'first3'),
    last3: str(args, 'last3'),
    dob: str(args, 'dob'),
    zip: str(args, 'zip'),
    id: str(args, 'id'),
  };

  let output;
  try {
    output = await addEntry(input, {
      onStatus: (msg) => {
        if (!bool(args, 'json')) process.stderr.write(c.dim(`${msg}\n`));
      },
    });
  } catch (err) {
    if (err instanceof AddEntryError || err instanceof ValidationError) die(err.message);
    throw err;
  }

  const { entry, manifestPath, transformResult: result, recoveryPhrase, recoveryPin, identity } = output;
  const orgClaimText = input.orgClaimText?.trim() || undefined;
  const orgClaimSource = input.orgClaimSource?.trim() || undefined;
  const entries = await readEntriesFile(ENTRIES_PATH);

  if (bool(args, 'json')) {
    out(JSON.stringify(entry, null, 2));
    return;
  }

  const fp = await keyFingerprint(entry.provenance.pubKey);

  out();
  rule(c.bold('ON RECORD'));
  out(`  ${c.bold(entry.id)}   ${entry.zone}   ${entry.ask.category}   status: ${entry.status}`);
  out(
    `  ask: ${entry.ask.summary}${entry.ask.amountUsd !== undefined ? c.cyan(`  ($${entry.ask.amountUsd})`) : ''}`,
  );
  out();
  rule('RAW (as submitted)');
  out(c.dim(wrap(entry.story.raw)));
  out();
  rule(`SHAPED (${result.model})`);
  out(wrap(entry.story.shaped));
  out();
  rule('CONSENT');
  out(`  advocate ${entry.consent.advocateId} — ${entry.consent.method}`);
  out(c.dim(`  recorded ${entry.consent.timestampISO}`));
  out();
  rule('PROVENANCE');
  out(`  alg          ${entry.provenance.alg}`);
  out(`  contentHash  ${c.cyan(entry.provenance.contentHash)}`);
  const signaturePreview = entry.provenance.coseSign1 ?? entry.provenance.signature ?? '';
  out(`  signature    ${c.cyan(signaturePreview.slice(0, 44))}…`);
  out(`  key          ${fp}  ${c.dim('(SHA-256 of SPKI, first 8 bytes)')}`);
  out(`  signedAt     ${entry.provenance.signedAtISO}`);
  if (recoveryPhrase && recoveryPin) {
    out();
    rule('RECOVERY CARD — print and hand to the requester');
    out(`  record       ${entry.id}`);
    out(`  words        ${recoveryPhrase}`);
    out(`  PIN          ${recoveryPin}`);
    out(c.dim('  The words and PIN are not stored in the record. Possession is the recovery credential.'));
  }
  if (identity && recoveryPin) {
    out();
    rule('RECOVERY CARD — print and hand to the requester');
    out(`  record       ${entry.id}`);
    out(`  name tokens  ${identity.first3} / ${identity.last3}`);
    out(`  date of birth ${identity.dateOfBirth}`);
    out(`  ZIP          ${identity.postalCode}`);
    out(`  PIN          ${recoveryPin}`);
    out(c.dim('  The identity fields and PIN are not stored in the record; only a keyed verifier tag is signed.'));
  }
  if (orgClaimText) {
    out();
    if (orgClaimSource) {
      out(c.green('  org claim signed — source provided.'));
    } else {
      out(
        c.yellow('  org claim marked alleged:true and EXCLUDED from signed assertions') +
          c.dim(' (no --source given)'),
      );
    }
  }
  out();
  out(c.green(`  wrote ${ENTRIES_PATH}`) + c.dim(`  (${entries.length} entries)`));
  out(c.green(`  wrote ${manifestPath}`));
  out();
  out(c.dim(`  tokens: ${result.inputTokens} in / ${result.outputTokens} out`));
  out();
}

// --- command: withdraw -------------------------------------------------------

async function cmdWithdraw(args: Args): Promise<void> {
  const id = args.positional[0];
  if (!id) die('usage: on-record withdraw <entry-id> [--reason <text>]');
  const reason = str(args, 'reason');

  let result;
  try {
    result = await withdrawEntry(id, reason);
  } catch (err) {
    if (err instanceof WithdrawError) die(err.message);
    throw err;
  }

  if (bool(args, 'json')) {
    out(JSON.stringify({ id: result.entry.id, zone: result.entry.zone, category: result.entry.ask.category, logPath: result.logPath }, null, 2));
    return;
  }

  out();
  rule(c.bold('WITHDRAWN'));
  out(`  ${c.bold(result.entry.id)}   ${result.entry.zone}   ${result.entry.ask.category}`);
  out();
  out(c.green(`  removed from ${ENTRIES_PATH}`));
  out(result.manifestDeleted ? c.green(`  deleted ${result.manifestPath}`) : c.dim(`  no manifest found at ${result.manifestPath}`));
  out(c.dim(`  logged in ${result.logPath}  (id/zone/category/timestamp only — never the story text, never committed)`));
  out();
  out(c.dim('  this entry is no longer in the published dataset. It will not appear on the map on the next serve or deploy.'));
  out();
}

// --- command: verify --------------------------------------------------------

async function cmdVerify(args: Args): Promise<void> {
  const path = args.positional[0] ?? ENTRIES_PATH;

  if (!existsSync(path)) {
    die(`${path} not found. Run \`on-record seed\` first, or pass a file path.`);
  }

  const didDocPath = str(args, 'did-doc');
  let trustDocument: import('./did.js').DidTrustDocument | undefined;
  if (didDocPath) {
    if (!existsSync(didDocPath)) die(`${didDocPath} not found`);
    trustDocument = JSON.parse(await readFile(didDocPath, 'utf8')) as import('./did.js').DidTrustDocument;
  }
  const report = await verifyFile(path, { trustDocument });

  if (report.parseError) die(`could not read ${path}: ${report.parseError}`);

  if (bool(args, 'json')) {
    out(JSON.stringify(report, null, 2));
    process.exit(report.failed > 0 ? 1 : 0);
  }

  out();
  rule(c.bold(`VERIFY ${path}`));
  for (const e of report.entries) {
    if (e.ok) {
      out(`  ${c.green('OK  ')} ${e.id.padEnd(16)} ${e.zone.padEnd(14)} ${c.dim(e.result.recomputedHash.slice(0, 24))}`);
    } else {
      out(`  ${c.red('FAIL')} ${e.id.padEnd(16)} ${e.zone.padEnd(14)}`);
      out(c.red(`       ${e.diagnosis ?? 'unknown failure'}`));
      if (e.result.claimedHash && e.result.recomputedHash) {
        out(c.dim(`       recorded:   ${e.result.claimedHash}`));
        out(c.dim(`       recomputed: ${e.result.recomputedHash}`));
      }
    }
  }
  out();

  const statusLine = Object.entries(report.statusCounts)
    .map(([k, v]) => `${k}: ${v}`)
    .join('   ');
  out(`  ${report.total} entries   ${c.green(`${report.verified} verified`)}   ` +
    (report.failed ? c.red(`${report.failed} FAILED`) : c.dim('0 failed')));
  if (statusLine) out(c.dim(`  ${statusLine}`));
  out(c.dim(`  signing keys seen: ${report.keys.join(', ') || 'none'}`));
  out();

  if (report.failed > 0) {
    out(c.red('  seal broken — this file has been modified since it was signed.'));
    out();
    process.exit(1);
  }
  out(c.green('  every entry verifies against its embedded public key.'));
  out();
}

async function cmdC2pa(args: Args): Promise<void> {
  const id = args.positional[0];
  const assetPath = str(args, 'asset');
  const outputPath = str(args, 'output');
  if (!id || !assetPath || !outputPath) die('usage: on-record c2pa <entry-id> --asset <path> --output <path>');
  const entries = await readEntriesFile(ENTRIES_PATH);
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) die(`entry ${id} not found in ${ENTRIES_PATH}`);
  const certificatePath = str(args, 'cert') ?? process.env['ONRECORD_C2PA_CERT'];
  const privateKeyPath = str(args, 'key') ?? process.env['ONRECORD_C2PA_KEY'];
  if (!certificatePath || !privateKeyPath) die('C2PA signing requires --cert/--key or ONRECORD_C2PA_CERT/ONRECORD_C2PA_KEY');
  await signC2paAsset(entry, { assetPath, outputPath, certificatePath, privateKeyPath });
  out(`wrote signed C2PA asset ${outputPath}`);
}

async function cmdExport(args: Args): Promise<void> {
  const id = args.positional[0];
  const output = str(args, 'output');
  if (!id || !output) die('usage: on-record export <entry-id> --output <path.zip>');
  const entries = await readEntriesFile(ENTRIES_PATH);
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) die(`entry ${id} not found in ${ENTRIES_PATH}`);
  const result = await exportRecordBundle(entry, output);
  out(`wrote ${result.zipPath}`);
  out(`wrote ${result.signaturePath}`);
  out(`bundle SHA-256 ${result.contentHash}`);
}

// --- command: seed ----------------------------------------------------------

async function cmdSeed(args: Args): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });

  if (existsSync(ENTRIES_PATH) && !bool(args, 'force')) {
    die(`${ENTRIES_PATH} already exists. Pass --force to overwrite it.`);
  }

  const useAi = bool(args, 'ai');
  if (useAi) process.stderr.write(c.dim(`shaping seed stories with ${modelId()}...\n`));

  const outcome = await runSeed({ useAi });

  out();
  out(c.green(`  wrote ${outcome.entriesPath}`) + c.dim(`  (${outcome.entries.length} composite entries)`));
  out(c.green(`  wrote ${outcome.manifestsDir}/*.json`));
  out();
  out(
    useAi
      ? c.dim('  shaped text produced by Claude; manifests record ai-transform.applied = true')
      : c.dim('  shaped text is pre-composed; manifests record ai-transform.applied = false'),
  );
  out(c.dim('  every seed story is labelled composite in its own text and in its manifest'));
  out();
  out(`  next: ${c.bold('on-record verify')}`);
  out();
}

// --- command: keys ----------------------------------------------------------

async function cmdKeys(): Promise<void> {
  const keys = await loadOrCreateKeyPair();
  const issuer = process.env['ONRECORD_ISSUER_DID']?.trim() || didKeyFromPublicJwk(keys.publicJwk);
  const fp = await keyFingerprint(keys.pubKey);
  out();
  out(`  alg          ECDSA P-256 (SHA-256)`);
  out(`  fingerprint  ${c.cyan(fp)}`);
  out(`  created      ${keys.createdISO}`);
  out(`  public key   ${c.dim('(base64 SPKI — embedded in every entry)')}`);
  out(`  issuer DID   ${issuer}`);
  out(`  method       ${verificationMethodForDid(issuer)}`);
  out();
  out(wrap(keys.pubKey, 74, '    '));
  out();
  out(c.dim('  private key: keys/signing-key.json (mode 0600, gitignored, dev-only)'));
  out();
}

// --- command: serve ---------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Origin (when the browser sends one) must match the Host we were actually
// reached on. A bare <form method=post> submission is not subject to CORS —
// this is the only thing standing between /api/add and a malicious page that
// gets a visitor's browser to POST to it.
function isSameOrigin(req: import('node:http').IncomingMessage): boolean {
  const origin = req.headers['origin'];
  if (typeof origin !== 'string') return true;
  try {
    return new URL(origin).host === req.headers['host'];
  } catch {
    return false;
  }
}

function intakeInputFromFields(fields: Record<string, string>): AddEntryInput {
  return {
    raw: fields['raw'] ?? '',
    zone: fields['zone'] ?? '',
    category: fields['category'] ?? '',
    summary: fields['summary'],
    amount: fields['amount'],
    advocateId: fields['advocate'] ?? '',
    consentMethod: fields['consent_method'] ?? '',
    orgClaimText: fields['org_claim'],
    orgClaimSource: fields['org_source'],
  };
}

// No pending-review gate here, unlike the browser demo's chat-based intake
// flow (web/index.html's submitIntake() sets pendingReview:true). That's not
// an oversight — the two flows have different trust models. The chat demo's
// own consent.method literally says "self-service demo intake chat — no
// advocate present"; that scenario is exactly what warrants holding a record
// for review before it counts anywhere. /api/add and `on-record add` both
// require an advocate ID and a stated consent method, the same requirement
// the CLI has always published immediately under with no review step. Adding
// one here would treat the advocate-mediated path as if it carried the
// self-service path's risk, which it doesn't.
async function handleIntakeSubmit(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
  if (!isSameOrigin(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('forbidden: cross-origin submission');
    return;
  }

  let fields: Record<string, string>;
  try {
    const body = await readBody(req);
    if (!(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
      res.writeHead(415, { 'content-type': 'text/plain; charset=utf-8' }).end('expected application/x-www-form-urlencoded');
      return;
    }
    fields = parseIntakeFields(body);
  } catch (err) {
    res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' }).end(err instanceof Error ? err.message : String(err));
    return;
  }

  // addEntry() does a read-modify-write on entries.json with a multi-second Claude
  // call in between. The form has no JS to disable the button mid-submit, so a
  // double-click must not let two requests read the same array and both append —
  // one entry would silently disappear. Serialize actual submissions through the
  // chain shared with every other intake surface (intake-queue.ts); the CSRF
  // check and body parsing above stay unserialized since they touch no shared
  // state.
  const task = enqueueIntake(() => addEntry(intakeInputFromFields(fields)));

  try {
    const output = await task;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(renderIntakeSuccess(output));
  } catch (err) {
    const message = err instanceof AddEntryError || err instanceof ValidationError
      ? err.message
      : err instanceof Error
        ? `could not publish this entry: ${err.message}`
        : 'could not publish this entry';
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(renderIntakeForm({ error: message, values: fields }));
  }
}

async function cmdServe(args: Args): Promise<void> {
  const port = Number(str(args, 'port') ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) die('--port must be a valid port number');
  const host = str(args, 'host') ?? '127.0.0.1';

  const root = resolve(process.cwd());

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);

      if (req.method === 'POST' && pathname === '/api/add') {
        await handleIntakeSubmit(req, res);
        return;
      }
      if (req.method === 'POST' && pathname === '/api/sms') {
        await handleSmsWebhook(req, res);
        return;
      }
      if (req.method === 'GET' && pathname === '/add') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(renderIntakeForm());
        return;
      }

      if (pathname === '/') pathname = '/web/index.html';

      // Contain everything under the repo root.
      const target = resolve(join(root, normalize(pathname)));
      if (target !== root && !target.startsWith(root + sep)) {
        res.writeHead(403).end('forbidden');
        return;
      }

      // The withdrawal log is internal — id/zone/category/timestamp of entries
      // someone pulled from the public record. Never served, unlike entries.json.
      if (target === resolve(WITHDRAWN_LOG_PATH)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not found: ${pathname}`);
        return;
      }

      // Held-for-review SMS submissions (gateway/sms.ts) are signed but not yet
      // reviewed — the whole point of the queue is that they're not public yet.
      // Never served, same as the withdrawal log above.
      if (target === resolve(PENDING_REVIEW_PATH)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not found: ${pathname}`);
        return;
      }

      try {
        const info = await stat(target);
        if (info.isDirectory()) {
          res.writeHead(302, { location: pathname.replace(/\/?$/, '/') + 'index.html' }).end();
          return;
        }
        res.writeHead(200, {
          'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        createReadStream(target).pipe(res);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not found: ${pathname}`);
      }
    })();
  });

  server.listen(port, host, () => {
    out();
    out(`  serving ${c.dim(root)}`);
    out(`  viewer  ${c.cyan(`http://${host}:${port}/web/index.html`)}`);
    out(`  add     ${c.cyan(`http://${host}:${port}/add`)}`);
    out(`  data    ${c.dim(`http://${host}:${port}/data/entries.json`)}`);
    out();
    out(c.dim('  ctrl-c to stop'));
    out();
  });
}

// --- usage ------------------------------------------------------------------

function usage(): void {
  out(`
${c.bold('on-record')} — signed, provenance-wrapped entries for the On Record map

  ${c.bold('on-record add')} [--file <path>] --zone <zone> --category <cat> --summary <text>
                  [--amount <usd>] --advocate <id> --consent-method <text>
                  [--consent-at <iso>] [--status <status>] [--id <id>]
                  [--org-claim <text>] [--source <text>] [--json]
                  [--recovery-phrase "four or more words" --recovery-pin <4 digits>]
                  [--first3 <3 letters> --last3 <3 letters> --dob <flexible date>
                   --confirm-dob <YYYY-MM-DD> --zip <5 digits> --recovery-pin <4 digits>]
                  ${c.dim('raw story is read from stdin when --file is omitted; --confirm-dob only needed if --dob is ambiguous')}

  ${c.bold('on-record withdraw')} <entry-id> [--reason <text>] [--json]
                  ${c.dim('remove an entry from the public record for good, at the requester\'s word alone')}

  ${c.bold('on-record verify')} [<file>] [--json]   ${c.dim(`defaults to ${ENTRIES_PATH}`)}
  ${c.bold('on-record c2pa')} <entry-id> --asset <path> --output <path>  ${c.dim('attach a C2PA manifest to a real asset')}
  ${c.bold('on-record export')} <entry-id> --output <path.zip>         ${c.dim('export an offline-verifiable record bundle')}
  ${c.bold('on-record seed')} [--force] [--ai]      ${c.dim('write the composite sample set')}
  ${c.bold('on-record serve')} [--port <n>] [--host <addr>]  ${c.dim("serve the viewer + a /add intake form (127.0.0.1 by default)")}
  ${c.bold('on-record keys')}                       ${c.dim('show the signing key')}

  zones       ${ZONES.join(', ')}
  categories  ${CATEGORIES.join(', ')}
  statuses    ${STATUSES.join(', ')}

  env         ANTHROPIC_API_KEY (required for add)
              ONRECORD_MODEL    (default ${modelId()})
`);
}

// --- entry point ------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  switch (command) {
    case 'add':
      await cmdAdd(args);
      break;
    case 'withdraw':
      await cmdWithdraw(args);
      break;
    case 'verify':
      await cmdVerify(args);
      break;
    case 'c2pa':
      await cmdC2pa(args);
      break;
    case 'export':
      await cmdExport(args);
      break;
    case 'seed':
      await cmdSeed(args);
      break;
    case 'keys':
      await cmdKeys();
      break;
    case 'serve':
      await cmdServe(args);
      break;
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      usage();
      break;
    default:
      die(`unknown command "${command}". Run \`on-record help\`.`);
  }
}

main().catch((err: unknown) => {
  if (err instanceof ValidationError) die(err.message);
  die(err instanceof Error ? err.message : String(err));
});
