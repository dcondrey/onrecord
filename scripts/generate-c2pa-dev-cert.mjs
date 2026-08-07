#!/usr/bin/env node
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const dir = process.argv[2] ?? 'keys';
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/c2pa-ext.cnf`, 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=1.3.6.1.5.5.7.3.36\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
await writeFile(`${dir}/c2pa-ca.cnf`, '[req]\ndistinguished_name=req_distinguished_name\nx509_extensions=v3_ca\n[req_distinguished_name]\n[v3_ca]\nbasicConstraints=critical,CA:TRUE,pathlen:1\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n');
const args = (file) => ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', file];
await run('openssl', args(`${dir}/c2pa-ca-ec.pem`));
await run('openssl', ['req', '-x509', '-new', '-key', `${dir}/c2pa-ca-ec.pem`, '-out', `${dir}/c2pa-ca.pem`, '-days', '365', '-subj', '/CN=On Record Development C2PA CA', '-config', `${dir}/c2pa-ca.cnf`]);
await run('openssl', args(`${dir}/c2pa-ec.pem`));
await run('openssl', ['pkcs8', '-topk8', '-nocrypt', '-in', `${dir}/c2pa-ec.pem`, '-out', `${dir}/c2pa-key.pem`]);
await run('openssl', ['req', '-new', '-key', `${dir}/c2pa-ec.pem`, '-out', `${dir}/c2pa.csr`, '-subj', '/CN=On Record Development C2PA Signer']);
await run('openssl', ['x509', '-req', '-in', `${dir}/c2pa.csr`, '-CA', `${dir}/c2pa-ca.pem`, '-CAkey', `${dir}/c2pa-ca-ec.pem`, '-CAcreateserial', '-out', `${dir}/c2pa-cert.pem`, '-days', '365', '-sha256', '-extfile', `${dir}/c2pa-ext.cnf`]);
await writeFile(`${dir}/c2pa-chain.pem`, `${await readFile(`${dir}/c2pa-cert.pem`, 'utf8')}${await readFile(`${dir}/c2pa-ca.pem`, 'utf8')}`);
console.log(`wrote ${dir}/c2pa-chain.pem and ${dir}/c2pa-key.pem`);
console.log('These are development credentials and will be untrusted by public C2PA trust lists.');
