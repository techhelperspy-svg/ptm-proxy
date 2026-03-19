const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const BYD_HOST = 'my433447.businessbydesign.cloud.sap';
const BYD_PATH = '/sap/bc/srt/scs/sap/queryproductionlotisiin';
const BYD_ACTION = 'http://sap.com/xi/A1S/Global/QueryProductionLotISIIn/FindByElementsRequest';
const BYD_AUTH = 'Basic ' + Buffer.from('_DEV:Welcome123').toString('base64');

const SOAP_ENVELOPE = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:glob="http://sap.com/xi/SAPGlobal20/Global">
  <soapenv:Header/>
  <soapenv:Body>
    <glob:ProductionLotByElementsQuery_sync>
      <ProcessingConditions>
        <QueryHitsMaximumNumberValue>100</QueryHitsMaximumNumberValue>
        <QueryHitsUnlimitedIndicator>false</QueryHitsUnlimitedIndicator>
      </ProcessingConditions>
    </glob:ProductionLotByElementsQuery_sync>
  </soapenv:Body>
</soapenv:Envelope>`;

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'Production Task Manager Proxy', byd: BYD_HOST }));
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/sync') {
    res.writeHead(404); res.end('Not found'); return;
  }

  const options = {
    hostname: BYD_HOST,
    port: 443,
    path: BYD_PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': BYD_ACTION,
      'Authorization': BYD_AUTH,
      'Content-Length': Buffer.byteLength(SOAP_ENVELOPE),
    },
  };

  console.log(`[${new Date().toISOString()}] → SAP ByD request`);

  const bydReq = https.request(options, (bydRes) => {
    let data = '';
    bydRes.on('data', chunk => data += chunk);
    bydRes.on('end', () => {
      console.log(`[${new Date().toISOString()}] ← SAP ByD HTTP ${bydRes.statusCode} (${data.length} bytes)`);
      res.writeHead(bydRes.statusCode, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(data);
    });
  });

  bydReq.on('error', (err) => {
    console.error(`[${new Date().toISOString()}] ✗ Error:`, err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  bydReq.write(SOAP_ENVELOPE);
  bydReq.end();
});

server.listen(PORT, () => {
  console.log(`\n  SAP ByD Proxy running on port ${PORT}\n`);
});
