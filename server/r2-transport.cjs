'use strict';
const { Agent } = require('node:https');
const { request } = require('node:http');
const { createHmac } = require('node:crypto');
const { endpoint, operationClass } = require('./r2-policy.cjs');
let agent;

exports.r2Transport = config => {
  if (config.endpoint !== endpoint) {
    if (String(config.endpoint).includes('cloudflarestorage.com')) throw new Error('Unexpected R2 endpoint');
    return {};
  }
  if (config.region !== 'auto' || config.bucketName !== 'luxsabers-social-media'
    || config.publicEndpoint !== endpoint || !config.forcePathStyle) throw new Error('Unexpected R2 configuration');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 22 && minor >= 21) || (major === 24 && minor >= 5) || major >= 25)) {
    throw new Error('R2 proxy requires Node 22.21 or 24.5 or newer');
  }
  agent ||= new Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1,
    proxyEnv: { HTTPS_PROXY: 'http://gateway:8082', NO_PROXY: '' } });
  return { maxAttempts: 1, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { httpsAgent: agent, connectionTimeout: 10000, requestTimeout: 60000 } };
};

async function reserveRequest(kind, secretKey) {
  if (kind === 'free') return;
  const body = JSON.stringify({ kind, at: Date.now() });
  const signature = createHmac('sha256', secretKey).update('luxsabers-r2-quota-v1\n').update(body).digest('hex');
  await new Promise((resolve, reject) => {
    const fail = () => reject(new Error('R2 free request allowance unavailable'));
    const req = request({ hostname: 'gateway', port: 8082, path: '/quota', method: 'POST', timeout: 10000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-r2-quota-signature': signature } }, res => {
      let response = '';
      res.on('data', chunk => { response += chunk; if (response.length > 128) { res.destroy(); fail(); } });
      res.on('error', fail);
      res.on('end', () => {
        try { if (res.statusCode === 200 && JSON.parse(response).allowed === true) resolve(); else fail(); }
        catch { fail(); }
      });
    });
    req.on('error', fail);
    req.on('timeout', () => { req.destroy(); fail(); });
    req.end(body);
  });
}

exports.createS3Client = (Client, config, options) => {
  const client = new Client({ ...options, ...exports.r2Transport(config) });
  if (config.endpoint === endpoint) client.middlewareStack.add((next, context) => async args => {
    await reserveRequest(operationClass(context.commandName), config.secretAccessKey);
    return next(args);
  }, { step: 'finalizeRequest', name: 'luxsabersR2FreeAllowance', priority: 'high' });
  return client;
};
