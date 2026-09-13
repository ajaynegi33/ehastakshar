import forge from 'node-forge';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateP12() {
  console.log('Generating key pair...');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  
  console.log('Creating certificate...');
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1); // 1 year validity

  const attrs = [
    { name: 'commonName', value: 'Ehastakshar Dev CA' },
    { name: 'countryName', value: 'IN' },
    { shortName: 'ST', value: 'Delhi' },
    { name: 'localityName', value: 'New Delhi' },
    { name: 'organizationName', value: 'Ehastakshar' },
    { shortName: 'OU', value: 'Development' }
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  // Self-sign the certificate
  cert.sign(keys.privateKey);

  console.log('Packaging as PKCS#12 (P12)...');
  // Create a PKCS#12 bundle containing the cert and private key
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey, [cert], 'password', { algorithm: '3des' }
  );

  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  
  const assetsDir = path.join(__dirname, '../src/assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const p12Path = path.join(assetsDir, 'dev-cert.p12');
  fs.writeFileSync(p12Path, Buffer.from(p12Der, 'binary'));

  console.log(`Successfully generated dev certificate at: ${p12Path}`);
  console.log('Password for this certificate is: "password"');
}

try {
  generateP12();
} catch (error) {
  console.error('Failed to generate certificate:', error);
}
