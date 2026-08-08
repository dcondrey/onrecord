#!/usr/bin/env node
/**
 * on-record CLI.
 *
 *   on-record add     raw story (stdin or --file) -> Claude transform -> sign -> append
 *   on-record verify  independent re-check of every signature in a file
 *   on-record seed    write the composite sample set
 *   on-record serve   static server for the local viewer
 *   on-record keys    show the signing key in use
 */

import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';

import {
  isCategory,
  isStatus,
  isZone,
  validateUnsigned,
  ValidationError,
  ZONES,
  CATEGORIES,
  STATUSES,
  type Entry,
  type UnsignedEntry,
} from './schema.js';
import {
  buildManifest,
  keyFingerprint,
  loadOrCreateKeyPair,
  sha256Hex,
  signEntryCose,
} from './sign.js';
import { SYSTEM_PROMPT, modelId, transform } from './transform.js';
import { verifyFile } from './verify.js';
import { ENTRIES_PATH, MANIFESTS_DIR, DATA_DIR, runSeed } from './seed.js';
import { buildDidDocument, didKeyFromPublicJwk, verificationMethodForDid } from './did.js';
import { signC2paAsset } from './c2pa.js';
import { exportRecordBundle } from './export.js';
import { dobIsAmbiguous, normalizeDob, recoveryIdentityTag, recoveryTag } from './recovery.js';

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
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags.set(token.slice(2), next);
          i++;
        } else {
          flags.set(token.slice(2), true);
        }
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function str(args: Args, name: string): string | undefined {
  const v = args.flags.get(name);
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

  const zone = required(args, 'zone', `One of: ${ZONES.join(', ')}`);
  if (!isZone(zone)) die(`unknown zone "${zone}". One of: ${ZONES.join(', ')}`);

  const category = required(args, 'category', `One of: ${CATEGORIES.join(', ')}`);
  if (!isCategory(category)) die(`unknown category "${category}". One of: ${CATEGORIES.join(', ')}`);

  const status = str(args, 'status') ?? 'requested';
  if (!isStatus(status)) die(`unknown status "${status}". One of: ${STATUSES.join(', ')}`);

  const summary = str(args, 'summary')?.trim() || raw.split(/\s+/).slice(0, 10).join(' ');

  const amountRaw = str(args, 'amount');
  let amountUsd: number | undefined;
  if (amountRaw !== undefined) {
    amountUsd = Number(amountRaw);
    if (!Number.isFinite(amountUsd) || amountUsd < 0) die(`--amount must be a non-negative number`);
  }

  const advocateId = required(
    args,
    'advocate',
    'Entries without a named advocate are refused — consent is not optional.',
  );
  const consentMethod = required(
    args,
    'consent-method',
    'Record how consent was given, e.g. --consent-method "verbal, in person, witnessed".',
  );
  const consentAt = str(args, 'consent-at') ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(consentAt))) die(`--consent-at must be an ISO 8601 timestamp`);

  const orgClaimText = str(args, 'org-claim');
  const orgClaimSource = str(args, 'source');
  const recoveryPhrase = str(args, 'recovery-phrase');
  const recoveryPin = str(args, 'recovery-pin');
  const confirmedDob = str(args, 'confirm-dob');
  const identity = {
    first3: str(args, 'first3'), last3: str(args, 'last3'),
    dateOfBirth: str(args, 'dob'), postalCode: str(args, 'zip'),
  };
  const hasIdentity = Object.values(identity).some(Boolean);
  if (hasIdentity && Object.values(identity).some((v) => !v)) die('--first3, --last3, --dob, and --zip must be supplied together');
  if (hasIdentity && recoveryPhrase) die('choose either identity recovery or --recovery-phrase, not both');
  if ((recoveryPhrase && !recoveryPin) || (!recoveryPhrase && !hasIdentity && recoveryPin)) die('--recovery-phrase or the four identity fields must be supplied with --recovery-pin');
  if (hasIdentity && !recoveryPin) die('identity recovery also requires --recovery-pin');
  if (hasIdentity && identity.dateOfBirth && dobIsAmbiguous(identity.dateOfBirth)) {
    if (!confirmedDob || normalizeDob(confirmedDob) !== normalizeDob(identity.dateOfBirth)) {
      die(`DOB "${identity.dateOfBirth}" is ambiguous. Confirm the intended ISO date with --confirm-dob YYYY-MM-DD.`);
    }
  }

  const ask: UnsignedEntry['ask'] = { category, summary };
  if (amountUsd !== undefined) ask.amountUsd = amountUsd;

  const id = str(args, 'id') ?? `or_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  // Shape the story before validating: an entry is not writable until it has
  // both halves, and we want the AI failure to surface before we touch disk.
  if (!bool(args, 'json')) {
    process.stderr.write(c.dim(`calling ${modelId()} to shape the story...\n`));
  }
  const result = await transform({ raw, ask, zone });

  const unsigned: UnsignedEntry = {
    id,
    zone,
    ask,
    story: { raw, shaped: result.shaped },
    consent: { advocateId, method: consentMethod, timestampISO: consentAt },
    ...(recoveryPhrase && recoveryPin ? { recovery: { scheme: 'claim-card/v1' as const, verifierTag: await recoveryTag(recoveryPhrase, recoveryPin, id) } } : {}),
    ...(hasIdentity && recoveryPin ? { recovery: { scheme: 'claim-card/identity-v1' as const, verifierTag: await recoveryIdentityTag(identity as { first3: string; last3: string; dateOfBirth: string; postalCode: string }, recoveryPin, id) } } : {}),
    status,
  };

  try {
    validateUnsigned(unsigned);
  } catch (err) {
    if (err instanceof ValidationError) die(err.message);
    throw err;
  }

  const keys = await loadOrCreateKeyPair();
  const issuer = process.env['ONRECORD_ISSUER_DID']?.trim() || didKeyFromPublicJwk(keys.publicJwk);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, 'did.json'), JSON.stringify(buildDidDocument(issuer, keys.publicJwk), null, 2) + '\n');
  const entry = await signEntryCose(unsigned, keys);

  const manifest = await buildManifest({
    entry,
    aiTransform: {
      applied: true,
      model: result.model,
      promptSha256: await sha256Hex(SYSTEM_PROMPT),
      method: 'Raw advocate text re-rendered by Claude under a no-fabrication system prompt.',
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
    ...(orgClaimText
      ? {
          orgClaim: {
            text: orgClaimText,
            ...(orgClaimSource ? { source: orgClaimSource } : {}),
            alleged: !orgClaimSource,
          },
        }
      : {}),
  });

  await mkdir(MANIFESTS_DIR, { recursive: true });
  const entries = await readEntriesFile(ENTRIES_PATH);
  entries.push(entry);
  await writeFile(ENTRIES_PATH, JSON.stringify(entries, null, 2) + '\n');
  const manifestPath = join(MANIFESTS_DIR, `${entry.id}.json`);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

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
  if (hasIdentity && recoveryPin) {
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

async function cmdServe(args: Args): Promise<void> {
  const port = Number(str(args, 'port') ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) die('--port must be a valid port number');

  const root = resolve(process.cwd());

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/web/index.html';

      // Contain everything under the repo root.
      const target = resolve(join(root, normalize(pathname)));
      if (target !== root && !target.startsWith(root + sep)) {
        res.writeHead(403).end('forbidden');
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

  server.listen(port, () => {
    out();
    out(`  serving ${c.dim(root)}`);
    out(`  viewer  ${c.cyan(`http://localhost:${port}/web/index.html`)}`);
    out(`  data    ${c.dim(`http://localhost:${port}/data/entries.json`)}`);
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
                  ${c.dim('raw story is read from stdin when --file is omitted')}

  ${c.bold('on-record verify')} [<file>] [--json]   ${c.dim(`defaults to ${ENTRIES_PATH}`)}
  ${c.bold('on-record c2pa')} <entry-id> --asset <path> --output <path>  ${c.dim('attach a C2PA manifest to a real asset')}
  ${c.bold('on-record export')} <entry-id> --output <path.zip>         ${c.dim('export an offline-verifiable record bundle')}
  ${c.bold('on-record seed')} [--force] [--ai]      ${c.dim('write the composite sample set')}
  ${c.bold('on-record serve')} [--port <n>]         ${c.dim('serve the local viewer')}
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
