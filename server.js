const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const BYD_HOST = 'my433447.businessbydesign.cloud.sap';
const BYD_PATH = '/sap/bc/srt/scs/sap/queryproductionlotisiin';
const BYD_ACTION = 'http://sap.com/xi/A1S/Global/QueryProductionLotISIIn/FindByElementsRequest';
const BYD_AUTH = 'Basic ' + Buffer.from('_DEV:Welcome123').toString('base64');

function buildEnvelope(count, dateFrom, dateTo) {
  const maxHits = count || 100;

  let dateFilter = '';
  if (dateFrom || dateTo) {
    const from = dateFrom ? `${dateFrom}T00:00:00Z` : '';
    const to   = dateTo   ? `${dateTo}T23:59:59Z`   : '';

    if (from && to) {
      dateFilter = `
      <SelectionByProductionStartDate>
        <InclusionExclusionCode>I</InclusionExclusionCode>
        <IntervalBoundaryTypeCode>3</IntervalBoundaryTypeCode>
        <LowerBoundaryDateTime>${from}</LowerBoundaryDateTime>
        <UpperBoundaryDateTime>${to}</UpperBoundaryDateTime>
      </SelectionByProductionStartDate>`;
    } else if (from) {
      dateFilter = `
      <SelectionByProductionStartDate>
        <InclusionExclusionCode>I</InclusionExclusionCode>
        <IntervalBoundaryTypeCode>1</IntervalBoundaryTypeCode>
        <LowerBoundaryDateTime>${from}</LowerBoundaryDateTime>
      </SelectionByProductionStartDate>`;
    } else if (to) {
      dateFilter = `
      <SelectionByProductionStartDate>
        <InclusionExclusionCode>I</InclusionExclusionCode>
        <IntervalBoundaryTypeCode>2</IntervalBoundaryTypeCode>
        <UpperBoundaryDateTime>${to}</UpperBoundaryDateTime>
      </SelectionByProductionStartDate>`;
    }
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:glob="http://sap.com/xi/SAPGlobal20/Global">
  <soapenv:Header/>
  <soapenv:Body>
    <glob:ProductionLotByElementsQuery_sync>${dateFilter}
      <ProcessingConditions>
        <QueryHitsMaximumNumberValue>${maxHits}</QueryHitsMaximumNumberValue>
        <QueryHitsUnlimitedIndicator>false</QueryHitsUnlimitedIndicator>
      </ProcessingConditions>
    </glob:ProductionLotByElementsQuery_sync>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'Production Task Manager Proxy', byd: BYD_HOST }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/sync') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let count = 100, dateFrom = '', dateTo = '';
    try {
      const parsed = JSON.parse(body);
      count    = parseInt(parsed.count)    || 100;
      dateFrom = parsed.dateFrom || '';
      dateTo   = parsed.dateTo   || '';
    } catch(e) {}

    const envelope = buildEnvelope(count, dateFrom, dateTo);
    console.log(`[${new Date().toISOString()}] → SAP | count:${count} from:${dateFrom||'any'} to:${dateTo||'any'}`);

    const options = {
      hostname: BYD_HOST,
      port: 443,
      path: BYD_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': BYD_ACTION,
        'Authorization': BYD_AUTH,
        'Content-Length': Buffer.byteLength(envelope),
      },
    };

    const bydReq = https.request(options, (bydRes) => {
      let data = '';
      bydRes.on('data', chunk => data += chunk);
      bydRes.on('end', () => {
        console.log(`[${new Date().toISOString()}] ← HTTP ${bydRes.statusCode} (${data.length} bytes)`);
        res.writeHead(bydRes.statusCode, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(data);
      });
    });

    bydReq.on('error', (err) => {
      console.error(`[${new Date().toISOString()}] ✗`, err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    bydReq.write(envelope);
    bydReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`\n  SAP ByD Proxy running on port ${PORT}\n`);
});
