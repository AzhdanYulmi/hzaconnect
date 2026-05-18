import fs from "node:fs";
import path from "node:path";
import { generateKeyPair } from "@hzaconnect/license";

const outDir = path.resolve("apps/license-server/keys");
fs.mkdirSync(outDir, { recursive: true });

const { publicPem, privatePem } = generateKeyPair();
fs.writeFileSync(path.join(outDir, "public.pem"), publicPem);
fs.writeFileSync(path.join(outDir, "private.pem"), privatePem, { mode: 0o600 });

console.log(`Wrote keys to ${outDir}`);
console.log("Set in .env (license server):");
console.log(`  LICENSE_PRIVATE_KEY_PATH=${outDir}/private.pem`);
console.log(`  LICENSE_PUBLIC_KEY_PATH=${outDir}/public.pem`);
console.log("Distribute the public key to every casino's deployment as:");
console.log(`  LICENSE_PUBLIC_KEY_PEM="$(cat ${outDir}/public.pem)"`);
